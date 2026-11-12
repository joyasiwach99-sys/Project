"""End-to-end: inventory rounds + sync cycles against the in-memory Firestore
with the device rules enforced. Time is driven explicitly, so no sleeps."""
from __future__ import annotations

import dataclasses
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pytest
from support import HUB, STOP_A, VEHICLE, FakeClock, assert_server_stamped_creates, base_docs, epc, make_store, parcel_doc

from smartroute_gateway.__main__ import instance_lock, main
from smartroute_gateway.app import Gateway, identity_problems
from smartroute_gateway.config import Config, load_config
from smartroute_gateway.firebase_client import TransientError
from smartroute_gateway.gps import SimulatedGps
from smartroute_gateway.memstore import InMemoryFirestore
from smartroute_gateway.queue import Outbox
from smartroute_gateway.readers.simulated import SimulatedReader

EXAMPLE_CONFIG = Path(__file__).resolve().parents[1] / "config.example.json"


@pytest.fixture(scope="module")
def cfg() -> Config:
    base = load_config(EXAMPLE_CONFIG)
    return dataclasses.replace(base, device=dataclasses.replace(base.device, vehicle_id="VAN-01", device_id="RDR-01"))


class FakeAuth:
    """Stands in for FirebaseAuth: the gateway only needs token(), uid and email."""

    def __init__(self) -> None:
        self.uid = "uid-device"
        self.email = "device-van01@smartroute.demo"
        self.fail: Optional[Exception] = None

    def token(self) -> str:
        if self.fail:
            raise self.fail
        return "token"


class Rig:
    def __init__(self, cfg: Config, docs: Dict[str, Any], position: Tuple[float, float] = HUB, auth: Optional[FakeAuth] = None) -> None:
        self.clock = FakeClock()
        self.store: InMemoryFirestore = make_store(docs, self.clock)
        self.outbox = Outbox(":memory:", clock=self.clock)
        self.reader = SimulatedReader()
        gps = SimulatedGps([position], speed_kmh=0, clock=self.clock)
        self.gw = Gateway(cfg, self.reader, gps, self.store, self.outbox, auth=auth, clock=self.clock)  # type: ignore[arg-type]

    def round(self, seconds: float = 1.0) -> None:
        self.gw.run_round(int(self.clock.now * 1000))
        self.clock.advance(seconds)

    def sync(self) -> None:
        self.gw.sync_once(self.clock.now)
        assert self.outbox.dead_letters() == [], [d.error for d in self.outbox.dead_letters()]

    def step(self, rounds: int = 1) -> None:
        for _ in range(rounds):
            self.round()
            self.sync()

    def parcel(self, pid: str) -> Dict[str, Any]:
        return self.store.docs[f"parcels/{pid}"]

    def created(self, collection: str) -> List[Dict[str, Any]]:
        prefix = f"{collection}/"
        known = set(base_docs())
        return [v for k, v in self.store.docs.items() if k.startswith(prefix) and k not in known]

    def alert_types(self, status: Optional[str] = None) -> List[str]:
        return sorted(a["type"] for a in self.created("alerts") if status is None or a["status"] == status)


def test_load_then_removal_at_the_hub(cfg: Config) -> None:
    rig = Rig(cfg, base_docs("loading", {"P1": parcel_doc(1)}))
    rig.sync()  # initial route + parcel load
    rig.reader.add(epc(1))
    rig.step()
    assert (rig.parcel("P1")["status"], rig.parcel("P1")["inVehicleId"]) == ("loaded", VEHICLE)
    vehicle = rig.store.docs[f"vehicles/{VEHICLE}"]
    assert (vehicle["presentEpcs"], vehicle["presentCount"], vehicle["readerOnline"]) == ([epc(1)], 1, True)

    rig.reader.remove(epc(1))
    rig.step(6)
    assert rig.parcel("P1")["status"] == "loaded"  # within the absence timeout: debounced
    rig.step(2)
    assert (rig.parcel("P1")["status"], rig.parcel("P1")["inVehicleId"]) == ("assigned", None)
    assert [e["type"] for e in rig.created("events")] == ["parcel_loaded", "parcel_unloaded"]
    assert rig.store.docs[f"vehicles/{VEHICLE}"]["presentEpcs"] == []
    assert_server_stamped_creates(rig.store)


def test_missed_reads_do_not_cause_departures(cfg: Config) -> None:
    rig = Rig(cfg, base_docs("in_progress", {"P1": parcel_doc(1, status="in_transit", inVehicleId=VEHICLE)}))
    rig.sync()
    rig.reader.add(epc(1))
    for i in range(30):
        if i % 4 == 0:  # read only every 4th round (shadowed tag)
            rig.reader.add(epc(1))
        else:
            rig.reader.remove(epc(1))
        rig.step()
    assert rig.parcel("P1")["status"] == "in_transit"
    assert rig.created("alerts") == []


def test_removal_mid_route_away_from_the_stop_raises_and_redetection_resolves(cfg: Config) -> None:
    rig = Rig(cfg, base_docs("in_progress", {"P1": parcel_doc(1, status="in_transit", inVehicleId=VEHICLE)}), position=HUB)
    rig.sync()
    rig.reader.add(epc(1))
    rig.step()
    rig.reader.remove(epc(1))
    rig.step(8)
    assert rig.parcel("P1")["status"] == "exception"
    (alert,) = rig.created("alerts")
    assert (alert["type"], alert["severity"], alert["status"]) == ("unauthorized_removal", "critical", "open")
    assert "from its destination while the route was in progress" in alert["message"]

    rig.reader.add(epc(1))
    rig.step()
    assert (rig.parcel("P1")["status"], rig.parcel("P1")["inVehicleId"]) == ("in_transit", VEHICLE)
    assert rig.alert_types("resolved") == ["unauthorized_removal"]


def test_removal_at_its_own_stop_is_a_delivery_handoff(cfg: Config) -> None:
    rig = Rig(cfg, base_docs("in_progress", {"P1": parcel_doc(1, status="in_transit", inVehicleId=VEHICLE)}), position=STOP_A)
    rig.sync()
    rig.reader.add(epc(1))
    rig.step()
    rig.reader.remove(epc(1))
    rig.step(8)
    assert rig.parcel("P1")["inVehicleId"] is None
    assert rig.parcel("P1")["status"] == "in_transit"
    assert [e["type"] for e in rig.created("events")] == ["parcel_left_at_stop"]
    assert rig.created("alerts") == []


def test_unknown_epc_is_looked_up_before_being_declared_unknown(cfg: Config) -> None:
    rig = Rig(cfg, base_docs("loading", {"P9": parcel_doc(9, vehicleId="VAN-02", routeId="R2", status="loaded", inVehicleId="VAN-02")}))
    rig.sync()
    assert epc(9) not in rig.gw.state.parcels_by_epc  # not on this vehicle's manifest

    rig.reader.add(epc(9), "DEADBEEF00000000000000FF")
    arrived_at = rig.clock.now
    rig.round()  # both deferred: not in the cache
    assert rig.created("alerts") == []
    rig.sync()  # targeted epc == lookups
    rig.round()
    rig.sync()
    assert rig.alert_types() == ["unknown_tag", "wrong_vehicle"]
    assert rig.parcel("P9")["inVehicleId"] == VEHICLE
    wrong = next(a for a in rig.created("alerts") if a["type"] == "wrong_vehicle")
    assert wrong["detectedAt"].timestamp() == pytest.approx(arrived_at, abs=0.01)  # the arrival round, not the lookup


def test_reader_failure_freezes_presence_and_raises_one_alert(cfg: Config) -> None:
    rig = Rig(cfg, base_docs("in_progress", {"P1": parcel_doc(1, status="in_transit", inVehicleId=VEHICLE)}))
    rig.sync()
    rig.reader.add(epc(1))
    rig.step()
    rig.reader.set_online(False)
    rig.step(12)  # far longer than the absence timeout
    assert rig.parcel("P1")["status"] == "in_transit"  # a dead reader is not an empty cargo area
    assert rig.alert_types() == ["reader_offline"]
    assert rig.store.docs[f"vehicles/{VEHICLE}"]["readerOnline"] is False

    rig.reader.set_online(True)
    rig.step()
    assert rig.alert_types("resolved") == ["reader_offline"]
    assert rig.store.docs[f"vehicles/{VEHICLE}"]["readerOnline"] is True
    rig.step(3)
    assert rig.parcel("P1")["status"] == "in_transit"


def test_parcels_the_cloud_places_in_this_cargo_are_watched_after_a_restart(cfg: Config) -> None:
    # The gateway restarts mid-route; P1 is recorded in the van but is no longer there.
    rig = Rig(cfg, base_docs("in_progress", {"P1": parcel_doc(1, status="in_transit", inVehicleId=VEHICLE)}))
    rig.sync()
    rig.step(8)
    assert rig.parcel("P1")["status"] == "exception"
    assert rig.alert_types() == ["unauthorized_removal"]


def test_dead_zone_queues_writes_and_delivers_them_in_order(cfg: Config) -> None:
    rig = Rig(cfg, base_docs("loading", {"P1": parcel_doc(1)}))
    rig.sync()
    commit = rig.store.commit

    def offline(writes: Any) -> None:
        raise TransientError("no signal")

    rig.store.commit = offline  # type: ignore[assignment]
    rig.reader.add(epc(1))
    rig.step(3)
    assert rig.parcel("P1")["status"] == "assigned"  # nothing reached the cloud
    assert rig.outbox.depth(ordered_only=True) == 2  # parcel+event, publicTracking

    rig.store.commit = commit  # type: ignore[assignment]
    rig.clock.advance(120)  # past any backoff
    rig.sync()
    assert rig.parcel("P1")["status"] == "loaded"
    (event,) = rig.created("events")
    assert event["deviceTime"].timestamp() == pytest.approx(rig.clock.now - 123, abs=0.01)  # physical time kept
    assert event["createdAt"].timestamp() == pytest.approx(rig.clock.now)  # server time on arrival


def test_cache_refresh_waits_for_local_writes(cfg: Config) -> None:
    rig = Rig(cfg, base_docs("loading", {"P1": parcel_doc(1)}))
    rig.sync()
    rig.reader.add(epc(1))
    rig.round()  # decision taken; write still in the outbox
    assert rig.outbox.depth(ordered_only=True) > 0
    assert rig.gw.state.refresh_parcels(rig.store, rig.outbox) is False
    assert rig.gw.state.parcels_by_epc[epc(1)].status == "loaded"  # optimistic local state kept


def test_heartbeat_and_location(cfg: Config) -> None:
    rig = Rig(cfg, base_docs("loading", {"P1": parcel_doc(1)}))
    rig.reader.add(epc(1))
    rig.step(2)
    device = rig.store.docs["devices/RDR-01"]
    assert {"readsPerMin", "uniqueTags", "uptimeSec", "queueDepth"} <= set(device["stats"])
    assert device["stats"]["queueDepth"] == 1  # sampled before that cycle's flush: the first presence update
    assert device["firmware"].startswith("smartroute-gateway")
    assert rig.store.docs[f"vehicles/{VEHICLE}"]["location"]["source"] == "simulator"
    stats = rig.gw.stats(rig.clock.now)
    assert (stats["readsPerMin"], stats["uniqueTags"]) == (2, 1)


def test_writes_wait_for_a_verified_device_account(cfg: Config) -> None:
    auth = FakeAuth()
    rig = Rig(cfg, base_docs("loading", {"P1": parcel_doc(1)}), auth=auth)
    rig.reader.add(epc(1))

    auth.fail = TransientError("offline")
    rig.round()
    rig.sync()
    assert rig.store.commits == [] and rig.outbox.depth() > 0

    auth.fail = None
    rig.clock.advance(10)  # offline: retried after 10 s ...
    rig.sync()  # ... but users/{uid} does not exist yet
    assert rig.store.commits == []

    rig.store.docs["users/uid-device"] = {"role": "device", "vehicleId": VEHICLE, "deviceId": "RDR-01"}
    rig.clock.advance(30)
    rig.sync()  # profile problems are re-checked once a minute
    assert rig.store.commits == []
    rig.clock.advance(30)
    rig.sync()
    assert rig.outbox.depth() == 0
    assert rig.store.docs[f"vehicles/{VEHICLE}"]["presentEpcs"] == [epc(1)]


def test_identity_problems() -> None:
    ok = {"role": "device", "vehicleId": "VAN-01", "deviceId": "RDR-01"}
    assert identity_problems(ok, "VAN-01", "RDR-01") == []
    assert len(identity_problems(None, "VAN-01", "RDR-01")) == 1
    assert len(identity_problems({**ok, "role": "driver", "vehicleId": "VAN-02"}, "VAN-01", "RDR-01")) == 2


def test_only_one_gateway_per_outbox(tmp_path: Path) -> None:
    first = instance_lock(tmp_path / "outbox.lock")
    assert first is not None
    assert instance_lock(tmp_path / "outbox.lock") is None
    first.close()
    again = instance_lock(tmp_path / "outbox.lock")
    assert again is not None
    again.close()


def test_cli_refuses_placeholder_password_and_missing_files(tmp_path: Path) -> None:
    assert main(["--config", str(EXAMPLE_CONFIG)]) == 2  # password is still CHANGE_ME
    assert main(["--config", str(tmp_path / "missing.json")]) == 2
    assert main(["--config", str(EXAMPLE_CONFIG), "--dry-run", "--fixture", str(tmp_path / "missing.json")]) == 2
