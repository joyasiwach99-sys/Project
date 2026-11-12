"""Each engine decision produces exactly the writes of ARCHITECTURE.md 3.3, and
every write passes the device rules (emulated in support.DeviceRules)."""
from __future__ import annotations

import itertools
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import pytest
from support import (
    DATABASE,
    DEVICE,
    HUB,
    STOP_B,
    VEHICLE,
    FakeClock,
    assert_server_stamped_creates,
    base_docs,
    make_store,
    parcel_doc,
)

from smartroute_gateway.engine import Decision, EngineParcel, GeoPoint
from smartroute_gateway.firebase_client import PermanentError, create_write, ts
from smartroute_gateway.gps import GpsFix
from smartroute_gateway.memstore import InMemoryFirestore
from smartroute_gateway.queue import Outbox
from smartroute_gateway.state import OpenAlerts, alert_key, parcel_from_doc
from smartroute_gateway.writer import LOAD_TIMELINE_LABEL, WriteContext, Writer, format_distance

ACTOR = {"type": "device", "id": DEVICE, "name": f"Reader {DEVICE} ({VEHICLE})"}
LOCATION = GeoPoint(*HUB)
AT = 1_767_225_700_000  # ms
LAST_SEEN = AT - 4_000


class Harness:
    def __init__(self, parcels: Dict[str, Dict[str, Any]], route_status: str = "loading", extra_docs: Optional[Dict[str, Any]] = None) -> None:
        self.clock = FakeClock()
        docs = base_docs(route_status, parcels)
        docs.update(extra_docs or {})
        self.store: InMemoryFirestore = make_store(docs, self.clock)
        self.outbox = Outbox(":memory:", clock=self.clock)
        self.alerts = OpenAlerts()
        ids = itertools.count(1)
        self.writer = Writer(self.outbox, self.alerts, DATABASE, VEHICLE, DEVICE, new_id=lambda: f"id{next(ids):03d}")
        self.ctx = WriteContext(route_id="R1", route_status=route_status, location=LOCATION)

    @property
    def server_time(self) -> datetime:
        return datetime.fromtimestamp(self.clock.now, tz=timezone.utc)

    def parcel(self, pid: str) -> EngineParcel:
        p = parcel_from_doc(pid, self.store.docs[f"parcels/{pid}"])
        assert p is not None
        return p

    def apply(self, decision: Decision) -> None:
        self.writer.apply(decision, self.ctx)
        self.flush()

    def flush(self) -> None:
        result = self.outbox.flush(self.store.commit)
        assert self.outbox.dead_letters() == [], "a write was rejected (rules or precondition)"
        assert not result.blocked

    def docs(self, collection: str) -> Dict[str, Dict[str, Any]]:
        prefix = f"{collection}/"
        return {k[len(prefix):]: v for k, v in self.store.docs.items() if k.startswith(prefix)}

    def new_docs(self, collection: str) -> List[Dict[str, Any]]:
        return [v for k, v in sorted(self.docs(collection).items()) if k.startswith("id")]

    def events(self, event_type: Optional[str] = None) -> List[Dict[str, Any]]:
        return [e for e in self.new_docs("events") if event_type is None or e["type"] == event_type]

    def alerts_of(self, alert_type: str) -> List[Dict[str, Any]]:
        return [a for a in self.new_docs("alerts") if a["type"] == alert_type]


def changed_parcel_fields(h: Harness) -> List[List[str]]:
    """updateMask of every parcel write, in order."""
    return [
        w["updateMask"]["fieldPaths"]
        for commit in h.store.commits
        for w in commit
        if "/documents/parcels/" in w["update"]["name"]
    ]


# ------------------------------------------------------------ arrivals


@pytest.mark.parametrize("route_status, expected", [("loading", "loaded"), ("in_progress", "in_transit")])
def test_loaded(route_status: str, expected: str) -> None:
    h = Harness({"P1": parcel_doc(1)}, route_status)
    p = h.parcel("P1")
    h.apply(Decision("loaded", AT, parcel=p))

    doc = h.store.docs["parcels/P1"]
    assert doc["status"] == expected
    assert doc["inVehicleId"] == VEHICLE
    assert doc["lastSeenAt"] == ts(AT)
    assert doc["loadedAt"] == ts(AT)
    assert doc["updatedAt"] == h.server_time
    (event,) = h.events()
    assert event["type"] == "parcel_loaded"
    assert event["actor"] == ACTOR
    assert event["vehicleId"] == VEHICLE
    assert (event["parcelId"], event["trackingId"], event["routeId"], event["epc"]) == ("P1", "SRG-T0001", "R1", p.epc)
    assert event["deviceTime"] == ts(AT)
    assert event["createdAt"] == h.server_time
    assert event["location"] == {"lat": HUB[0], "lng": HUB[1]}
    assert h.new_docs("alerts") == []
    # public mirror: status + RFID-verified timeline entry
    public = h.store.docs["publicTracking/SRG-T0001"]
    assert public["status"] == expected
    assert public["timeline"] == [{"status": "loaded", "label": LOAD_TIMELINE_LABEL, "at": ts(AT), "rfidVerified": True}]
    # optimistic local update for the next round
    assert (p.status, p.in_vehicle_id) == (expected, VEHICLE)
    assert_server_stamped_creates(h.store)


def test_loaded_timeline_append_is_idempotent_on_retry() -> None:
    h = Harness({"P1": parcel_doc(1)})
    h.apply(Decision("loaded", AT, parcel=h.parcel("P1")))
    public_write = h.store.commits[-1]
    h.store.commit(public_write)  # e.g. replayed after a lost response
    assert len(h.store.docs["publicTracking/SRG-T0001"]["timeline"]) == 1


def test_missing_public_mirror_does_not_block_the_parcel_update() -> None:
    h = Harness({"P2": parcel_doc(2, trackingId="SRG-NOMIRROR")})
    h.writer.apply(Decision("loaded", AT, parcel=h.parcel("P2")), h.ctx)
    h.outbox.flush(h.store.commit)
    assert h.store.docs["parcels/P2"]["status"] == "loaded"
    assert [d.label for d in h.outbox.dead_letters()] == ["publicTracking SRG-NOMIRROR"]


def test_present_writes_only_when_in_vehicle_changes() -> None:
    h = Harness({"P1": parcel_doc(1, status="in_transit", inVehicleId=VEHICLE)})
    h.apply(Decision("present", AT, parcel=h.parcel("P1")))
    assert h.store.commits == []

    h2 = Harness({"P1": parcel_doc(1, status="in_transit", inVehicleId=None)})
    p = h2.parcel("P1")
    h2.apply(Decision("present", AT, parcel=p))
    assert changed_parcel_fields(h2) == [["inVehicleId", "lastSeenAt"]]
    assert h2.store.docs["parcels/P1"]["inVehicleId"] == VEHICLE
    assert h2.store.docs["parcels/P1"]["lastSeenAt"] == ts(AT)
    assert h2.events() == []


def test_redetected_restores_status_and_auto_resolves_alerts() -> None:
    h = Harness(
        {"P1": parcel_doc(1, status="exception", inVehicleId=None, leftVehicleAt=ts(AT - 60_000))},
        route_status="in_progress",
        extra_docs={
            "alerts/A1": {"type": "unauthorized_removal", "status": "open", "vehicleId": VEHICLE, "parcelId": "P1"},
            "alerts/A2": {"type": "delivery_mismatch", "status": "acknowledged", "vehicleId": VEHICLE, "parcelId": "P1"},
        },
    )
    h.alerts.add(alert_key("unauthorized_removal", "P1"), "A1")
    h.alerts.add(alert_key("delivery_mismatch", "P1"), "A2")
    h.apply(Decision("redetected", AT, parcel=h.parcel("P1")))

    doc = h.store.docs["parcels/P1"]
    assert (doc["status"], doc["inVehicleId"], doc["leftVehicleAt"], doc["lastSeenAt"]) == ("in_transit", VEHICLE, None, ts(AT))
    (note,) = h.events("note")
    assert "re-detected" in note["message"]
    for alert_id in ("A1", "A2"):
        alert = h.store.docs[f"alerts/{alert_id}"]
        assert alert["status"] == "resolved"
        assert alert["resolvedBy"] == ACTOR
        assert alert["resolvedAt"] == h.server_time
        assert alert["resolution"]
    resolved = h.events("alert_resolved")
    assert sorted(e["alertId"] for e in resolved) == ["A1", "A2"]
    assert len(h.alerts) == 0
    assert_server_stamped_creates(h.store)


def test_wrong_vehicle_claims_presence_and_raises_one_warning() -> None:
    foreign = parcel_doc(4, vehicleId="VAN-02", routeId="R2", status="loaded", inVehicleId="VAN-02")
    h = Harness({"P4": foreign})
    p = h.parcel("P4")
    h.apply(Decision("wrong_vehicle", AT, parcel=p))
    h.apply(Decision("wrong_vehicle", AT + 9_000, parcel=p))  # seen again: no duplicate alert

    doc = h.store.docs["parcels/P4"]
    assert (doc["inVehicleId"], doc["lastSeenAt"], doc["status"], doc["vehicleId"]) == (VEHICLE, ts(AT + 9_000), "loaded", "VAN-02")
    (alert,) = h.alerts_of("wrong_vehicle")
    assert alert["severity"] == "warning"
    assert alert["status"] == "open"
    assert alert["source"] == "device"
    assert alert["title"] == "Wrong vehicle"
    assert alert["message"] == "Parcel SRG-T0004 is assigned to VAN-02 but was detected in VAN-01."
    assert alert["detectedAt"] == ts(AT)
    assert alert["createdAt"] == h.server_time
    (raised,) = h.events("alert_raised")
    assert raised["alertId"] == "id001"
    assert raised["message"] == "Wrong vehicle: Parcel SRG-T0004 is assigned to VAN-02 but was detected in VAN-01."
    assert_server_stamped_creates(h.store)


def test_unknown_tag_alerts_once_per_epc_per_session() -> None:
    h = Harness({})
    h.apply(Decision("unknown_tag", AT, epc="DEADBEEF00000000000000FF"))
    h.alerts.replace({})  # someone resolved it in the dashboard
    h.apply(Decision("unknown_tag", AT + 60_000, epc="DEADBEEF00000000000000FF"))
    h.apply(Decision("unknown_tag", AT, epc="DEADBEEF00000000000000AA"))

    alerts = h.alerts_of("unknown_tag")
    assert [a["epc"] for a in alerts] == ["DEADBEEF00000000000000FF", "DEADBEEF00000000000000AA"]
    assert all(a["severity"] == "info" and a["parcelId"] is None and a["routeId"] == "R1" for a in alerts)
    assert h.docs("parcels") == {}


def test_unknown_tag_is_deduplicated_against_alerts_already_open_in_the_cloud() -> None:
    h = Harness({})
    h.alerts.add(alert_key("unknown_tag", epc="deadbeef00000000000000ff"), "OLD")
    h.apply(Decision("unknown_tag", AT, epc="DEADBEEF00000000000000FF"))
    assert h.store.commits == []


def test_delivered_but_present_raises_a_warning_mismatch() -> None:
    h = Harness({"P3": parcel_doc(3, status="delivered")})
    h.apply(Decision("delivered_but_present", AT, parcel=h.parcel("P3")))
    (alert,) = h.alerts_of("delivery_mismatch")
    assert alert["severity"] == "warning"
    assert "marked delivered but RFID still detects it" in alert["message"]
    assert h.store.docs["parcels/P3"]["status"] == "delivered"  # parcel untouched
    assert changed_parcel_fields(h) == []


# ----------------------------------------------------------- departures


def test_unloaded_at_hub_resets_the_parcel() -> None:
    h = Harness({"P1": parcel_doc(1, status="loaded", inVehicleId=VEHICLE, loadedAt=ts(AT - 100_000))})
    h.apply(Decision("unloaded_at_hub", AT, parcel=h.parcel("P1"), last_seen=LAST_SEEN))
    doc = h.store.docs["parcels/P1"]
    assert (doc["status"], doc["inVehicleId"], doc["loadedAt"]) == ("assigned", None, None)
    (event,) = h.events()
    assert event["type"] == "parcel_unloaded"
    assert event["deviceTime"] == ts(LAST_SEEN)
    assert h.new_docs("alerts") == []


def test_left_at_stop_records_when_it_left() -> None:
    h = Harness({"P1": parcel_doc(1, status="in_transit", inVehicleId=VEHICLE)}, "in_progress")
    h.apply(Decision("left_at_stop", AT, parcel=h.parcel("P1"), last_seen=LAST_SEEN, distance_m=42.0))
    doc = h.store.docs["parcels/P1"]
    assert (doc["status"], doc["inVehicleId"], doc["leftVehicleAt"]) == ("in_transit", None, ts(LAST_SEEN))
    (event,) = h.events()
    assert event["type"] == "parcel_left_at_stop"
    assert "42 m" in event["message"]
    assert h.new_docs("alerts") == []


def test_wrong_stop_is_a_critical_delivery_mismatch() -> None:
    h = Harness(
        {
            "P1": parcel_doc(1, status="in_transit", inVehicleId=VEHICLE),
            "P2": parcel_doc(2, status="in_transit", inVehicleId=VEHICLE, lat=STOP_B[0], lng=STOP_B[1]),
        },
        "in_progress",
    )
    h.apply(Decision("wrong_stop", AT, parcel=h.parcel("P1"), last_seen=LAST_SEEN, near_parcel=h.parcel("P2"), distance_m=12.0))
    doc = h.store.docs["parcels/P1"]
    assert (doc["status"], doc["inVehicleId"], doc["leftVehicleAt"]) == ("exception", None, ts(LAST_SEEN))
    (alert,) = h.alerts_of("delivery_mismatch")
    assert (alert["severity"], alert["title"]) == ("critical", "Wrong stop")
    assert alert["detectedAt"] == ts(LAST_SEEN)
    assert "at the stop for SRG-T0002 (12 m from that address)" in alert["message"]
    assert [e["type"] for e in h.events()] == ["alert_raised"]


def test_unauthorized_removal_is_critical_with_a_readable_message() -> None:
    h = Harness({"P1": parcel_doc(1, status="in_transit", inVehicleId=VEHICLE)}, "in_progress")
    h.apply(Decision("unauthorized_removal", AT, parcel=h.parcel("P1"), last_seen=LAST_SEEN, distance_m=1234.0))
    doc = h.store.docs["parcels/P1"]
    assert (doc["status"], doc["inVehicleId"], doc["leftVehicleAt"]) == ("exception", None, ts(LAST_SEEN))
    (alert,) = h.alerts_of("unauthorized_removal")
    assert alert["severity"] == "critical"
    assert alert["message"] == "Parcel SRG-T0001 was removed from VAN-01 1.2 km from its destination while the route was in progress."
    assert alert["detectedAt"] == ts(LAST_SEEN)
    assert alert["location"] == {"lat": HUB[0], "lng": HUB[1]}
    assert [e["type"] for e in h.events()] == ["alert_raised"]
    assert_server_stamped_creates(h.store)


def test_unauthorized_removal_without_gps() -> None:
    h = Harness({"P1": parcel_doc(1, status="in_transit", inVehicleId=VEHICLE)}, "in_progress")
    h.ctx = WriteContext(route_id="R1", route_status="in_progress", location=None)
    h.apply(Decision("unauthorized_removal", AT, parcel=h.parcel("P1"), last_seen=LAST_SEEN, distance_m=None))
    (alert,) = h.alerts_of("unauthorized_removal")
    assert "no GPS fix" in alert["message"]
    assert alert["location"] is None


def test_wrong_vehicle_cleared_releases_presence_and_resolves() -> None:
    foreign = parcel_doc(4, vehicleId="VAN-02", routeId="R2", status="loaded", inVehicleId="VAN-02")
    h = Harness({"P4": foreign})
    p = h.parcel("P4")
    h.apply(Decision("wrong_vehicle", AT, parcel=p))
    h.apply(Decision("wrong_vehicle_cleared", AT + 8_000, parcel=p, last_seen=AT + 1_000))

    assert h.store.docs["parcels/P4"]["inVehicleId"] is None
    (alert,) = h.alerts_of("wrong_vehicle")
    assert alert["status"] == "resolved"
    assert [e["type"] for e in h.events()] == ["alert_raised", "alert_resolved"]


def test_wrong_vehicle_cleared_leaves_other_vehicles_claim_alone() -> None:
    foreign = parcel_doc(4, vehicleId="VAN-02", routeId="R2", status="loaded", inVehicleId="VAN-02")
    h = Harness({"P4": foreign})
    h.apply(Decision("wrong_vehicle_cleared", AT, parcel=h.parcel("P4"), last_seen=LAST_SEEN))
    assert h.store.commits == []  # not ours to release, no open alert to resolve


# ------------------------------------------------ vehicle, device, reader


def test_presence_location_and_heartbeat_pass_the_rules() -> None:
    h = Harness({})
    h.writer.publish_presence(["E1", "E2"], AT, reader_online=True)
    h.writer.publish_location(GpsFix(28.5, 77.08, 31.24, 92.0, 1, 7, 1.1, 0))
    h.writer.heartbeat({"readsPerMin": 120, "uniqueTags": 2, "uptimeSec": 60, "queueDepth": 0}, "10.0.0.7", "fw 1")
    h.flush()

    vehicle = h.store.docs[f"vehicles/{VEHICLE}"]
    assert (vehicle["presentEpcs"], vehicle["presentCount"], vehicle["readerOnline"], vehicle["lastScanAt"]) == (["E1", "E2"], 2, True, ts(AT))
    assert vehicle["location"] == {"lat": 28.5, "lng": 77.08, "speedKmh": 31.2, "heading": 92.0, "source": "gps_module", "updatedAt": h.server_time}
    assert vehicle["updatedAt"] == h.server_time
    device = h.store.docs[f"devices/{DEVICE}"]
    assert device["stats"]["readsPerMin"] == 120
    assert (device["ip"], device["firmware"], device["lastHeartbeat"]) == ("10.0.0.7", "fw 1", h.server_time)


def test_reader_offline_raises_once_and_resolves_on_recovery() -> None:
    h = Harness({})
    h.writer.reader_offline("no answer", AT, h.ctx)
    h.writer.reader_offline("no answer", AT + 5_000, h.ctx)
    h.flush()
    (alert,) = h.alerts_of("reader_offline")
    assert (alert["severity"], alert["status"], alert["title"], alert["detectedAt"]) == ("warning", "open", "Reader offline", ts(AT))
    h.writer.reader_recovered(AT + 9_000, h.ctx)
    h.flush()
    assert h.alerts_of("reader_offline")[0]["status"] == "resolved"


def test_the_rules_emulation_really_rejects_client_timestamps() -> None:
    """Guard for the tests themselves: a createdAt sent as a client value fails."""
    h = Harness({})
    bad = create_write(f"{DATABASE}/events/x", {"type": "note", "vehicleId": VEHICLE, "actor": ACTOR, "createdAt": ts(AT)})
    with pytest.raises(PermanentError):
        h.store.commit([bad])


@pytest.mark.parametrize("metres, text", [(12.4, "12 m"), (999.4, "999 m"), (1234, "1.2 km"), (15_049, "15.0 km")])
def test_format_distance(metres: float, text: str) -> None:
    assert format_distance(metres) == text
