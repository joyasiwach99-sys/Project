"""Auth token lifecycle and Firestore REST request handling, against a fake HTTP session."""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import pytest
import requests
from support import FakeClock

from smartroute_gateway.firebase_client import (
    REFRESH_URL,
    SIGN_IN_URL,
    AuthError,
    FirebaseAuth,
    FirestoreClient,
    PermanentError,
    TransientError,
    encode_fields,
)


class FakeResponse:
    def __init__(self, status: int, body: Any = None) -> None:
        self.status_code = status
        self._body = body

    def json(self) -> Any:
        if self._body is None:
            raise ValueError("no JSON")
        return self._body


Call = Tuple[str, str, Dict[str, Any]]


class FakeSession:
    """Replays queued responses and records requests."""

    def __init__(self) -> None:
        self.calls: List[Call] = []
        self.responses: List[Any] = []

    def _next(self, method: str, url: str, kwargs: Dict[str, Any]) -> FakeResponse:
        self.calls.append((method, url, kwargs))
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def post(self, url: str, **kwargs: Any) -> FakeResponse:
        return self._next("POST", url, kwargs)

    def request(self, method: str, url: str, **kwargs: Any) -> FakeResponse:
        return self._next(method, url, kwargs)


def sign_in_ok(token: str = "id-1", expires: str = "3600") -> FakeResponse:
    return FakeResponse(200, {"idToken": token, "refreshToken": "refresh-1", "expiresIn": expires, "localId": "uid-device"})


def refresh_ok(token: str) -> FakeResponse:
    return FakeResponse(200, {"id_token": token, "refresh_token": "refresh-2", "expires_in": "3600", "user_id": "uid-device"})


def make_auth(session: FakeSession, clock: Optional[FakeClock] = None) -> FirebaseAuth:
    return FirebaseAuth("api-key", "device-van01@smartroute.demo", "secret", session, clock=clock or FakeClock())  # type: ignore[arg-type]


# -------------------------------------------------------------------- auth


def test_sign_in_then_reuse_token_until_close_to_expiry() -> None:
    session, clock = FakeSession(), FakeClock()
    auth = make_auth(session, clock)
    session.responses = [sign_in_ok("id-1"), refresh_ok("id-2")]

    assert auth.token() == "id-1"
    method, url, kwargs = session.calls[0]
    assert url == SIGN_IN_URL
    assert kwargs["params"] == {"key": "api-key"}
    assert kwargs["json"] == {"email": "device-van01@smartroute.demo", "password": "secret", "returnSecureToken": True}
    assert auth.uid == "uid-device"

    clock.advance(3600 - FirebaseAuth.REFRESH_MARGIN_S - 1)
    assert auth.token() == "id-1"  # still comfortably valid
    assert len(session.calls) == 1

    clock.advance(2)
    assert auth.token() == "id-2"  # refreshed shortly before expiry
    _, url, kwargs = session.calls[1]
    assert url == REFRESH_URL
    assert kwargs["data"] == {"grant_type": "refresh_token", "refresh_token": "refresh-1"}


def test_rejected_refresh_token_falls_back_to_password_sign_in() -> None:
    session, clock = FakeSession(), FakeClock()
    auth = make_auth(session, clock)
    session.responses = [sign_in_ok("id-1"), FakeResponse(400, {"error": {"message": "TOKEN_EXPIRED"}}), sign_in_ok("id-3")]
    auth.token()
    auth.invalidate()
    assert auth.token() == "id-3"
    assert [url for _, url, _ in session.calls] == [SIGN_IN_URL, REFRESH_URL, SIGN_IN_URL]


def test_bad_credentials_raise_a_transient_auth_error() -> None:
    session = FakeSession()
    session.responses = [FakeResponse(400, {"error": {"code": 400, "message": "INVALID_LOGIN_CREDENTIALS"}})]
    with pytest.raises(AuthError, match="INVALID_LOGIN_CREDENTIALS") as err:
        make_auth(session).token()
    assert isinstance(err.value, TransientError)  # queued writes must survive a wrong password


def test_auth_outage_is_transient() -> None:
    session = FakeSession()
    session.responses = [requests.ConnectionError("no route to host")]
    with pytest.raises(TransientError):
        make_auth(session).token()
    session.responses = [FakeResponse(503)]
    with pytest.raises(TransientError):
        make_auth(session).token()


# --------------------------------------------------------------- firestore


def make_client(session: FakeSession) -> FirestoreClient:
    session.responses.append(sign_in_ok())
    auth = make_auth(session)
    auth.token()
    return FirestoreClient("project-x", auth, session)  # type: ignore[arg-type]


def test_get_document_decodes_fields_and_maps_404_to_none() -> None:
    session = FakeSession()
    client = make_client(session)
    session.responses = [FakeResponse(200, {"name": "x", "fields": encode_fields({"status": "loaded", "n": 3})}), FakeResponse(404, {"error": {"status": "NOT_FOUND"}})]
    assert client.get_document("parcels/P1") == {"status": "loaded", "n": 3}
    assert client.get_document("parcels/nope") is None
    method, url, kwargs = session.calls[1]
    assert (method, url) == ("GET", "https://firestore.googleapis.com/v1/projects/project-x/databases/(default)/documents/parcels/P1")
    assert kwargs["headers"] == {"Authorization": "Bearer id-1"}


def test_run_query_skips_read_time_only_rows() -> None:
    session = FakeSession()
    client = make_client(session)
    base = "projects/project-x/databases/(default)/documents"
    session.responses = [
        FakeResponse(200, [{"document": {"name": f"{base}/parcels/P1", "fields": encode_fields({"epc": "E1"})}, "readTime": "t"}, {"readTime": "t"}])
    ]
    assert client.run_query("parcels", {"epc": "E1"}, limit=1) == [("P1", {"epc": "E1"})]
    _, url, kwargs = session.calls[1]
    assert url.endswith("/documents:runQuery")
    assert kwargs["json"]["structuredQuery"]["limit"] == 1


def test_commit_posts_writes_and_retries_once_after_401() -> None:
    session = FakeSession()
    client = make_client(session)
    session.responses = [FakeResponse(401, {"error": {"status": "UNAUTHENTICATED"}}), refresh_ok("id-2"), FakeResponse(200, {"writeResults": []})]
    client.commit([{"update": {"name": "n", "fields": {}}}])
    commit_calls = [c for c in session.calls if c[1].endswith(":commit")]
    assert len(commit_calls) == 2
    assert commit_calls[1][2]["headers"] == {"Authorization": "Bearer id-2"}
    assert commit_calls[1][2]["json"] == {"writes": [{"update": {"name": "n", "fields": {}}}]}


@pytest.mark.parametrize(
    "response, error_type, status",
    [
        (FakeResponse(403, {"error": {"code": 403, "status": "PERMISSION_DENIED", "message": "Missing or insufficient permissions."}}), PermanentError, "PERMISSION_DENIED"),
        (FakeResponse(400, [{"error": {"status": "FAILED_PRECONDITION", "message": "The query requires an index"}}]), PermanentError, "FAILED_PRECONDITION"),
        (FakeResponse(409, {"error": {"status": "ALREADY_EXISTS"}}), PermanentError, "ALREADY_EXISTS"),
        (FakeResponse(503), TransientError, "UNAVAILABLE"),
        (FakeResponse(429, {"error": {"status": "RESOURCE_EXHAUSTED"}}), TransientError, "RESOURCE_EXHAUSTED"),
        (requests.Timeout("read timed out"), TransientError, "UNAVAILABLE"),
    ],
)
def test_errors_are_classified(response: Any, error_type: type, status: str) -> None:
    session = FakeSession()
    client = make_client(session)
    session.responses = [response]
    with pytest.raises(error_type) as err:
        client.commit([])
    assert err.value.status == status  # type: ignore[attr-defined]
