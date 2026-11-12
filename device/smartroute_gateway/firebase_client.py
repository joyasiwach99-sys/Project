"""Firebase Auth + Cloud Firestore over plain REST (no Firebase SDK).

The gateway signs in as its *device account* and talks to Firestore with that
account's ID token, so ``firestore.rules`` apply to the hardware exactly as
they apply to people.

* Auth: ``accounts:signInWithPassword``; the ID token (valid ~1 h) is
  refreshed through ``securetoken.googleapis.com/v1/token`` shortly before it
  expires, falling back to a fresh password sign-in if the refresh token is
  rejected.
* Firestore: ``get``, ``runQuery`` (equality filters) and ``commit``. Writes
  are plain REST ``Write`` objects (dicts) so they can be stored verbatim in
  the SQLite outbox and replayed later.

Errors are split into ``TransientError`` (retry later: offline, server busy,
auth temporarily failing) and ``PermanentError`` (will never succeed as sent:
security rules, malformed write, missing document). The outbox relies on that
split to decide between retrying and dead-lettering.
"""
from __future__ import annotations

import base64
import logging
import math
import os
import re
import secrets
import string
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Mapping, Optional, Protocol, Sequence, Tuple

import requests

log = logging.getLogger(__name__)

# SRG_EMULATOR=1 points the gateway at `firebase emulators:start` (auth :9099, firestore :8080)
# so the hardware code can be tested end-to-end against the real security rules.
if os.environ.get("SRG_EMULATOR") == "1":
    FIRESTORE_API = "http://127.0.0.1:8080/v1"
    SIGN_IN_URL = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword"
    REFRESH_URL = "http://127.0.0.1:9099/securetoken.googleapis.com/v1/token"
else:
    FIRESTORE_API = "https://firestore.googleapis.com/v1"
    SIGN_IN_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword"
    REFRESH_URL = "https://securetoken.googleapis.com/v1/token"

Document = Dict[str, Any]
Write = Dict[str, Any]


def database_path(project_id: str) -> str:
    return f"projects/{project_id}/databases/(default)/documents"


# ----------------------------------------------------------------- errors


class FirebaseError(Exception):
    def __init__(self, message: str, status: str = "UNKNOWN", http_status: Optional[int] = None) -> None:
        super().__init__(message)
        self.status = status
        self.http_status = http_status


class TransientError(FirebaseError):
    """Retry later: network down, server busy, token expired mid-flight."""


class PermanentError(FirebaseError):
    """Will never succeed as sent: security rules, malformed write, missing document."""


class AuthError(TransientError):
    """Firebase Auth refused the credentials.

    Deliberately *transient*: queued writes must survive until someone fixes
    the password / account, rather than being dead-lettered.
    """


_TRANSIENT_STATUSES = frozenset(
    {"UNAVAILABLE", "DEADLINE_EXCEEDED", "RESOURCE_EXHAUSTED", "ABORTED", "INTERNAL", "UNKNOWN", "CANCELLED", "UNAUTHENTICATED"}
)
_STATUS_BY_HTTP = {400: "INVALID_ARGUMENT", 401: "UNAUTHENTICATED", 403: "PERMISSION_DENIED", 404: "NOT_FOUND", 409: "ABORTED", 429: "RESOURCE_EXHAUSTED"}


def _error_message(resp: requests.Response) -> Tuple[Optional[str], Optional[str]]:
    """(status, message) from a Google API error body, if it has one."""
    try:
        body = resp.json()
    except ValueError:
        return None, None
    if isinstance(body, list) and body:  # runQuery wraps errors in an array
        body = body[0]
    err = body.get("error") if isinstance(body, dict) else None
    if not isinstance(err, dict):
        return None, None
    return err.get("status"), err.get("message")


def error_from_response(resp: requests.Response) -> FirebaseError:
    status, message = _error_message(resp)
    if not status:
        status = _STATUS_BY_HTTP.get(resp.status_code, "UNAVAILABLE" if resp.status_code >= 500 else "UNKNOWN")
    text = f"{status}: {message or f'HTTP {resp.status_code}'}"
    if status in _TRANSIENT_STATUSES or resp.status_code >= 500:
        return TransientError(text, status, resp.status_code)
    return PermanentError(text, status, resp.status_code)


# ----------------------------------------------------------------- values


def ts(ms: float) -> datetime:
    """Client timestamp from epoch milliseconds (``ts(x)`` in ARCHITECTURE.md)."""
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)


def format_timestamp(dt: datetime) -> str:
    if dt.tzinfo is None:
        raise ValueError("naive datetime; use timezone-aware UTC datetimes")
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


_TIMESTAMP = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$")


def parse_timestamp(text: str) -> datetime:
    """RFC 3339 as returned by Firestore (up to nanoseconds; Python keeps microseconds)."""
    m = _TIMESTAMP.match(text)
    if not m:
        raise ValueError(f"not an RFC 3339 timestamp: {text!r}")
    year, month, day, hour, minute, second, frac, zone = m.groups()
    micros = int((frac or "0").ljust(6, "0")[:6])
    if zone == "Z":
        tz = timezone.utc
    else:
        offset = timedelta(hours=int(zone[1:3]), minutes=int(zone[4:6]))
        tz = timezone(offset if zone[0] == "+" else -offset)
    local = datetime(int(year), int(month), int(day), int(hour), int(minute), int(second), micros, tzinfo=tz)
    return local.astimezone(timezone.utc)


def encode_value(value: Any) -> Dict[str, Any]:
    """Python value -> Firestore REST ``Value``."""
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):  # before int: bool is an int subclass
        return {"booleanValue": value}
    if isinstance(value, int):
        return {"integerValue": str(value)}  # int64 travels as a JSON string
    if isinstance(value, float):
        if math.isnan(value):
            return {"doubleValue": "NaN"}
        if math.isinf(value):
            return {"doubleValue": "Infinity" if value > 0 else "-Infinity"}
        return {"doubleValue": value}
    if isinstance(value, str):
        return {"stringValue": value}
    if isinstance(value, datetime):
        return {"timestampValue": format_timestamp(value)}
    if isinstance(value, (bytes, bytearray)):
        return {"bytesValue": base64.b64encode(bytes(value)).decode("ascii")}
    if isinstance(value, Mapping):
        return {"mapValue": {"fields": encode_fields(value)}}
    if isinstance(value, (list, tuple)):
        return {"arrayValue": {"values": [encode_value(v) for v in value]}}
    raise TypeError(f"cannot store {type(value).__name__} in Firestore: {value!r}")


def encode_fields(data: Mapping[str, Any]) -> Dict[str, Any]:
    return {str(k): encode_value(v) for k, v in data.items()}


def decode_value(value: Mapping[str, Any]) -> Any:
    """Firestore REST ``Value`` -> Python value."""
    if "nullValue" in value:
        return None
    if "booleanValue" in value:
        return bool(value["booleanValue"])
    if "integerValue" in value:
        return int(value["integerValue"])
    if "doubleValue" in value:
        return float(value["doubleValue"])  # also handles "NaN" / "Infinity" / "-Infinity"
    if "stringValue" in value:
        return value["stringValue"]
    if "timestampValue" in value:
        return parse_timestamp(value["timestampValue"])
    if "mapValue" in value:
        return decode_fields(value["mapValue"].get("fields", {}))
    if "arrayValue" in value:
        return [decode_value(v) for v in value["arrayValue"].get("values", [])]
    if "bytesValue" in value:
        return base64.b64decode(value["bytesValue"])
    if "referenceValue" in value:
        return value["referenceValue"]
    if "geoPointValue" in value:
        gp = value["geoPointValue"]
        return {"latitude": float(gp.get("latitude", 0.0)), "longitude": float(gp.get("longitude", 0.0))}
    raise ValueError(f"unsupported Firestore value: {value!r}")


def decode_fields(fields: Mapping[str, Any]) -> Document:
    return {k: decode_value(v) for k, v in fields.items()}


# ----------------------------------------------------------------- writes

_SIMPLE_FIELD = re.compile(r"^[A-Za-z_][A-Za-z_0-9]*$")


def _checked_path(field_path: str) -> str:
    # Our field names are all plain identifiers; anything else would need
    # backtick quoting in a REST field path, so reject it loudly instead.
    if not all(_SIMPLE_FIELD.match(seg) for seg in field_path.split(".")):
        raise ValueError(f"unsupported field path {field_path!r}")
    return field_path


def server_timestamp(field_path: str) -> Dict[str, Any]:
    """Transform: set ``field_path`` to the server's commit time (``request.time`` in rules)."""
    return {"fieldPath": _checked_path(field_path), "setToServerValue": "REQUEST_TIME"}


def append_missing(field_path: str, values: Sequence[Any]) -> Dict[str, Any]:
    """Transform: append each value to the array unless an equal element is already there."""
    return {"fieldPath": _checked_path(field_path), "appendMissingElements": {"values": [encode_value(v) for v in values]}}


def update_write(doc_name: str, data: Mapping[str, Any], transforms: Sequence[Dict[str, Any]] = (), exists: Optional[bool] = True) -> Write:
    """Patch only the top-level fields in ``data`` (they become the updateMask).

    Like the JS SDK, a field that only receives a transform (e.g. ``updatedAt``)
    is not part of the mask. ``exists=True`` makes the commit fail with
    NOT_FOUND instead of silently creating a partial document.
    """
    write: Write = {
        "update": {"name": doc_name, "fields": encode_fields(data)},
        "updateMask": {"fieldPaths": [_checked_path(k) for k in data]},
    }
    if transforms:
        write["updateTransforms"] = list(transforms)
    if exists is not None:
        write["currentDocument"] = {"exists": exists}
    return write


def create_write(doc_name: str, data: Mapping[str, Any], transforms: Sequence[Dict[str, Any]] = ()) -> Write:
    """Create a new document (fails with ALREADY_EXISTS if the id is taken)."""
    write: Write = {"update": {"name": doc_name, "fields": encode_fields(data)}, "currentDocument": {"exists": False}}
    if transforms:
        write["updateTransforms"] = list(transforms)
    return write


_ID_ALPHABET = string.ascii_letters + string.digits


def new_doc_id() -> str:
    """20-char random id, same shape as Firestore auto-ids. Generated on the
    device so a queued create can be retried without creating duplicates."""
    return "".join(secrets.choice(_ID_ALPHABET) for _ in range(20))


def doc_path(doc_name: str) -> str:
    """``projects/p/databases/(default)/documents/parcels/X`` -> ``parcels/X``."""
    return doc_name.split("/documents/", 1)[-1]


def _short(value: Any) -> str:
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    if isinstance(value, dict):
        return "{" + ", ".join(f"{k}: {_short(v)}" for k, v in value.items()) + "}"
    if isinstance(value, list):
        return "[" + ", ".join(_short(v) for v in value) + "]"
    return repr(value)


def describe_write(write: Write) -> str:
    """One readable line per write, for --dry-run and debug logs."""
    doc = write.get("update", {})
    op = "create" if write.get("currentDocument", {}).get("exists") is False else "update"
    parts = [f"{k}={_short(v)}" for k, v in decode_fields(doc.get("fields", {})).items()]
    for t in write.get("updateTransforms", []):
        if "setToServerValue" in t:
            parts.append(f"{t['fieldPath']}=<server time>")
        elif "appendMissingElements" in t:
            values = [decode_value(v) for v in t["appendMissingElements"].get("values", [])]
            parts.append(f"{t['fieldPath']} += {_short(values)}")
    return f"{op} {doc_path(doc.get('name', '?'))}: " + ", ".join(parts)


def build_query(collection: str, equals: Mapping[str, Any], limit: Optional[int] = None) -> Dict[str, Any]:
    """StructuredQuery with AND-ed equality filters (served by single-field indexes)."""
    filters = [
        {"fieldFilter": {"field": {"fieldPath": _checked_path(f)}, "op": "EQUAL", "value": encode_value(v)}}
        for f, v in equals.items()
    ]
    query: Dict[str, Any] = {"from": [{"collectionId": collection}]}
    if len(filters) == 1:
        query["where"] = filters[0]
    elif filters:
        query["where"] = {"compositeFilter": {"op": "AND", "filters": filters}}
    if limit:
        query["limit"] = limit
    return query


# ------------------------------------------------------------------ store


class DocumentStore(Protocol):
    """What the gateway needs from Firestore (real client or in-memory stand-in)."""

    database: str

    def get_document(self, path: str) -> Optional[Document]: ...

    def run_query(self, collection: str, equals: Mapping[str, Any], limit: Optional[int] = None) -> List[Tuple[str, Document]]: ...

    def commit(self, writes: Sequence[Write]) -> None: ...


# ------------------------------------------------------------------- auth


class FirebaseAuth:
    """Email/password sign-in for the device account, with token refresh."""

    #: Refresh this many seconds before the ID token expires.
    REFRESH_MARGIN_S = 300

    def __init__(
        self,
        api_key: str,
        email: str,
        password: str,
        session: requests.Session,
        timeout: float = 15.0,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._api_key = api_key
        self._email = email
        self._password = password
        self._session = session
        self._timeout = timeout
        self._clock = clock
        self._id_token: Optional[str] = None
        self._refresh_token: Optional[str] = None
        self._expires_at = 0.0
        self.uid: Optional[str] = None

    @property
    def email(self) -> str:
        return self._email

    def token(self) -> str:
        """A valid ID token, signing in or refreshing first when needed."""
        if self._id_token and self._clock() < self._expires_at - self.REFRESH_MARGIN_S:
            return self._id_token
        if self._refresh_token:
            try:
                self._refresh()
                return self._require_token()
            except AuthError as err:
                log.warning("token refresh rejected (%s); signing in again", err)
        self._sign_in()
        return self._require_token()

    def invalidate(self) -> None:
        """Force a refresh on the next ``token()`` call (after a 401)."""
        self._expires_at = 0.0

    def _require_token(self) -> str:
        assert self._id_token is not None
        return self._id_token

    def _sign_in(self) -> None:
        data = self._post(SIGN_IN_URL, json={"email": self._email, "password": self._password, "returnSecureToken": True})
        self._store(data.get("idToken"), data.get("refreshToken"), data.get("expiresIn"), data.get("localId"))
        log.info("signed in to Firebase as %s", self._email)

    def _refresh(self) -> None:
        data = self._post(REFRESH_URL, data={"grant_type": "refresh_token", "refresh_token": self._refresh_token})
        self._store(data.get("id_token"), data.get("refresh_token"), data.get("expires_in"), data.get("user_id"))
        log.debug("ID token refreshed")

    def _store(self, id_token: Any, refresh_token: Any, expires_in: Any, uid: Any) -> None:
        if not id_token or not refresh_token:
            raise AuthError("Firebase Auth response had no token", "UNAUTHENTICATED")
        self._id_token = str(id_token)
        self._refresh_token = str(refresh_token)
        self._expires_at = self._clock() + float(expires_in or 3600)
        self.uid = str(uid) if uid else self.uid

    def _post(self, url: str, **kwargs: Any) -> Dict[str, Any]:
        try:
            resp = self._session.post(url, params={"key": self._api_key}, timeout=self._timeout, **kwargs)
        except requests.RequestException as err:
            raise TransientError(f"Firebase Auth unreachable: {err}", "UNAVAILABLE") from err
        if resp.status_code == 200:
            body = resp.json()
            return body if isinstance(body, dict) else {}
        if resp.status_code >= 500 or resp.status_code == 429:
            raise TransientError(f"Firebase Auth unavailable (HTTP {resp.status_code})", "UNAVAILABLE", resp.status_code)
        _, message = _error_message(resp)
        raise AuthError(f"Firebase Auth refused {self._email}: {message or f'HTTP {resp.status_code}'}", "UNAUTHENTICATED", resp.status_code)


# -------------------------------------------------------------- firestore


class FirestoreClient:
    """Minimal Firestore REST client authenticated as the device account."""

    def __init__(self, project_id: str, auth: FirebaseAuth, session: requests.Session, timeout: Tuple[float, float] = (5.0, 20.0)) -> None:
        self.database = database_path(project_id)
        self._base = f"{FIRESTORE_API}/{self.database}"
        self._auth = auth
        self._session = session
        self._timeout = timeout

    def get_document(self, path: str) -> Optional[Document]:
        resp = self._request("GET", f"{self._base}/{path}", allow_404=True)
        if resp.status_code == 404:
            return None
        return decode_fields(resp.json().get("fields", {}))

    def run_query(self, collection: str, equals: Mapping[str, Any], limit: Optional[int] = None) -> List[Tuple[str, Document]]:
        resp = self._request("POST", f"{self._base}:runQuery", json={"structuredQuery": build_query(collection, equals, limit)})
        rows: List[Tuple[str, Document]] = []
        for item in resp.json():
            doc = item.get("document")  # items without one only carry a readTime
            if doc:
                rows.append((doc["name"].rsplit("/", 1)[-1], decode_fields(doc.get("fields", {}))))
        return rows

    def commit(self, writes: Sequence[Write]) -> None:
        self._request("POST", f"{self._base}:commit", json={"writes": list(writes)})

    def _request(self, method: str, url: str, json: Optional[Dict[str, Any]] = None, allow_404: bool = False) -> requests.Response:
        resp = self._send(method, url, json)
        if resp.status_code == 401:
            self._auth.invalidate()  # token revoked/expired early: refresh once and retry
            resp = self._send(method, url, json)
        if resp.status_code == 200 or (allow_404 and resp.status_code == 404):
            return resp
        raise error_from_response(resp)

    def _send(self, method: str, url: str, json: Optional[Dict[str, Any]]) -> requests.Response:
        headers = {"Authorization": f"Bearer {self._auth.token()}"}
        try:
            return self._session.request(method, url, json=json, headers=headers, timeout=self._timeout)
        except requests.RequestException as err:
            raise TransientError(f"Firestore unreachable: {err}", "UNAVAILABLE") from err
