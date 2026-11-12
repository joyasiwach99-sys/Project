"""Firestore REST value encoding/decoding, write builders and the in-memory store's semantics."""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

import pytest
from support import DATABASE

from smartroute_gateway.firebase_client import (
    PermanentError,
    append_missing,
    build_query,
    create_write,
    decode_fields,
    decode_value,
    describe_write,
    encode_fields,
    encode_value,
    new_doc_id,
    parse_timestamp,
    server_timestamp,
    ts,
    update_write,
)
from smartroute_gateway.memstore import InMemoryFirestore, apply_write

NOW = datetime(2026, 1, 2, 3, 4, 5, 678000, tzinfo=timezone.utc)


# ------------------------------------------------------------------ values


@pytest.mark.parametrize(
    "value, encoded",
    [
        (None, {"nullValue": None}),
        (True, {"booleanValue": True}),
        (False, {"booleanValue": False}),
        (0, {"integerValue": "0"}),
        (-42, {"integerValue": "-42"}),
        (2**53 + 1, {"integerValue": "9007199254740993"}),
        (1.5, {"doubleValue": 1.5}),
        ("VAN-01", {"stringValue": "VAN-01"}),
        ("", {"stringValue": ""}),
        (NOW, {"timestampValue": "2026-01-02T03:04:05.678000Z"}),
        (b"\x01\xff", {"bytesValue": "Af8="}),
        ([], {"arrayValue": {"values": []}}),
        ({}, {"mapValue": {"fields": {}}}),
    ],
)
def test_scalar_encoding_round_trips(value: object, encoded: dict) -> None:
    assert encode_value(value) == encoded
    assert decode_value(encoded) == value


def test_bool_is_not_encoded_as_an_integer() -> None:
    assert encode_value(True) == {"booleanValue": True}
    assert decode_value({"booleanValue": True}) is True


def test_special_doubles() -> None:
    assert encode_value(float("inf")) == {"doubleValue": "Infinity"}
    assert encode_value(float("-inf")) == {"doubleValue": "-Infinity"}
    assert encode_value(float("nan")) == {"doubleValue": "NaN"}
    assert math.isnan(decode_value({"doubleValue": "NaN"}))
    assert decode_value({"doubleValue": "-Infinity"}) == float("-inf")
    assert decode_value({"doubleValue": 3}) == 3.0  # whole doubles may arrive as JSON ints


def test_nested_maps_and_arrays_round_trip() -> None:
    doc = {
        "actor": {"type": "device", "id": "RDR-01", "name": "Reader RDR-01 (VAN-01)"},
        "location": {"lat": 28.5011, "lng": 77.0838},
        "presentEpcs": ["E1", "E2"],
        "timeline": [{"status": "loaded", "at": NOW, "rfidVerified": True}],
        "stats": {"readsPerMin": 120, "cpuTempC": 48.3},
        "parcelId": None,
    }
    assert decode_fields(encode_fields(doc)) == doc


def test_decodes_what_firestore_omits_for_empty_containers() -> None:
    assert decode_value({"arrayValue": {}}) == []
    assert decode_value({"mapValue": {}}) == {}


def test_decodes_reference_and_geopoint_values() -> None:
    assert decode_value({"referenceValue": "projects/p/databases/(default)/documents/a/b"}).endswith("/a/b")
    assert decode_value({"geoPointValue": {"latitude": 1.5}}) == {"latitude": 1.5, "longitude": 0.0}


@pytest.mark.parametrize(
    "text, expected",
    [
        ("2026-01-02T03:04:05Z", datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)),
        ("2026-01-02T03:04:05.123456789Z", datetime(2026, 1, 2, 3, 4, 5, 123456, tzinfo=timezone.utc)),
        ("2026-01-02T03:04:05.1Z", datetime(2026, 1, 2, 3, 4, 5, 100000, tzinfo=timezone.utc)),
        ("2026-01-02T08:34:05+05:30", datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)),
        ("2026-01-01T22:04:05-05:00", datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)),
    ],
)
def test_parse_timestamp(text: str, expected: datetime) -> None:
    assert parse_timestamp(text) == expected


def test_rejects_bad_input() -> None:
    with pytest.raises(ValueError):
        parse_timestamp("yesterday")
    with pytest.raises(ValueError):
        encode_value(datetime(2026, 1, 1))  # naive: ambiguous timezone
    with pytest.raises(TypeError):
        encode_value({1, 2})
    with pytest.raises(ValueError):
        decode_value({"mysteryValue": 1})


def test_ts_converts_epoch_ms_to_utc() -> None:
    assert ts(1_767_225_600_123) == datetime(2026, 1, 1, 0, 0, 0, 123000, tzinfo=timezone.utc)


# ------------------------------------------------------------------ writes


def test_update_write_masks_only_data_fields() -> None:
    w = update_write(f"{DATABASE}/parcels/P1", {"status": "loaded", "inVehicleId": None}, [server_timestamp("updatedAt")])
    assert w["update"]["name"].endswith("/documents/parcels/P1")
    assert w["update"]["fields"] == {"status": {"stringValue": "loaded"}, "inVehicleId": {"nullValue": None}}
    assert w["updateMask"] == {"fieldPaths": ["status", "inVehicleId"]}  # updatedAt is transform-only
    assert w["updateTransforms"] == [{"fieldPath": "updatedAt", "setToServerValue": "REQUEST_TIME"}]
    assert w["currentDocument"] == {"exists": True}


def test_create_write_requires_a_new_document() -> None:
    w = create_write(f"{DATABASE}/events/e1", {"type": "note"}, [server_timestamp("createdAt")])
    assert w["currentDocument"] == {"exists": False}
    assert "updateMask" not in w


def test_append_missing_transform() -> None:
    t = append_missing("timeline", [{"status": "loaded", "at": NOW}])
    assert t["appendMissingElements"]["values"][0]["mapValue"]["fields"]["at"] == {"timestampValue": "2026-01-02T03:04:05.678000Z"}


def test_field_paths_must_be_plain_identifiers() -> None:
    with pytest.raises(ValueError):
        server_timestamp("bad field")
    with pytest.raises(ValueError):
        update_write(f"{DATABASE}/x/y", {"a-b": 1})


def test_build_query() -> None:
    single = build_query("parcels", {"epc": "E1"}, limit=1)
    assert single == {
        "from": [{"collectionId": "parcels"}],
        "where": {"fieldFilter": {"field": {"fieldPath": "epc"}, "op": "EQUAL", "value": {"stringValue": "E1"}}},
        "limit": 1,
    }
    composite = build_query("alerts", {"vehicleId": "VAN-01", "status": "open"})
    assert composite["where"]["compositeFilter"]["op"] == "AND"
    assert len(composite["where"]["compositeFilter"]["filters"]) == 2
    assert "limit" not in composite


def test_new_doc_ids_look_like_firestore_auto_ids() -> None:
    ids = {new_doc_id() for _ in range(200)}
    assert len(ids) == 200
    assert all(len(i) == 20 and i.isalnum() for i in ids)


def test_describe_write_is_readable() -> None:
    w = update_write(
        f"{DATABASE}/publicTracking/SRG-1",
        {"status": "loaded"},
        [server_timestamp("updatedAt"), append_missing("timeline", [{"status": "loaded"}])],
    )
    assert describe_write(w) == "update publicTracking/SRG-1: status='loaded', updatedAt=<server time>, timeline += [{status: 'loaded'}]"


# --------------------------------------------- in-memory store semantics


def test_mask_deletes_fields_missing_from_data_and_keeps_the_rest() -> None:
    before = {"a": 1, "b": 2, "c": 3}
    w = update_write(f"{DATABASE}/x/y", {"a": 10})
    w["updateMask"]["fieldPaths"].append("b")  # in the mask but not in data -> deleted
    assert apply_write(before, w, NOW) == {"a": 10, "c": 3}


def test_nested_server_timestamp_inside_a_replaced_map() -> None:
    w = update_write(f"{DATABASE}/vehicles/V", {"location": {"lat": 1.0, "lng": 2.0}}, [server_timestamp("location.updatedAt")])
    after = apply_write({"location": {"lat": 0.0, "lng": 0.0, "speedKmh": 9.0}}, w, NOW)
    assert after == {"location": {"lat": 1.0, "lng": 2.0, "updatedAt": NOW}}


def test_append_missing_elements_skips_equal_values() -> None:
    w = update_write(f"{DATABASE}/publicTracking/T", {}, [append_missing("timeline", ["a", "b"])])
    assert apply_write({"timeline": ["b"]}, w, NOW)["timeline"] == ["b", "a"]


def test_preconditions() -> None:
    with pytest.raises(PermanentError) as missing:
        apply_write(None, update_write(f"{DATABASE}/x/y", {"a": 1}), NOW)
    assert missing.value.status == "NOT_FOUND"
    with pytest.raises(PermanentError) as taken:
        apply_write({"a": 1}, create_write(f"{DATABASE}/x/y", {"a": 2}), NOW)
    assert taken.value.status == "ALREADY_EXISTS"


def test_commit_is_all_or_nothing() -> None:
    store = InMemoryFirestore(DATABASE, {"x/1": {"v": 1}})
    good = update_write(f"{DATABASE}/x/1", {"v": 2})
    bad = update_write(f"{DATABASE}/x/missing", {"v": 3})
    with pytest.raises(PermanentError):
        store.commit([good, bad])
    assert store.docs == {"x/1": {"v": 1}}
    assert store.commits == []


def test_equality_queries() -> None:
    store = InMemoryFirestore(DATABASE, {"p/1": {"v": "A", "s": 1}, "p/2": {"v": "A", "s": 2}, "p/3": {"v": "B"}, "q/1": {"v": "A"}})
    assert [i for i, _ in store.run_query("p", {"v": "A"})] == ["1", "2"]
    assert [i for i, _ in store.run_query("p", {"v": "A", "s": 2})] == ["2"]
    assert len(store.run_query("p", {"v": "A"}, limit=1)) == 1
    assert store.run_query("p", {"missing": None}) == []


def test_request_time_comes_from_the_store_clock() -> None:
    later = NOW + timedelta(seconds=5)
    store = InMemoryFirestore(DATABASE, {"x/1": {}}, clock=later.timestamp)
    store.commit([update_write(f"{DATABASE}/x/1", {}, [server_timestamp("t")])])
    assert store.docs["x/1"]["t"] == later
