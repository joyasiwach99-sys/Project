"""Port of src/lib/verification.test.ts (same scenarios, same fixtures), plus a
few extra branch checks at the end."""
from __future__ import annotations

import dataclasses
from typing import Any, List

import pytest

from smartroute_gateway.engine import (
    ALERT_META,
    Departure,
    EngineContext,
    EngineParcel,
    GeoPoint,
    PresenceTracker,
    check_load,
    decide_arrival,
    decide_departure,
    distance_m,
    normalize_epc,
)

HUB = GeoPoint(28.5011, 77.0838)
STOP_A = GeoPoint(28.4950, 77.0890)  # Cyber City
STOP_B = GeoPoint(28.4683, 77.0645)  # Sector 29


def parcel(pid: str, **over: Any) -> EngineParcel:
    base = EngineParcel(
        id=pid,
        epc=f"E2801170000002{pid.rjust(10, '0')}"[:24].upper(),
        tracking_id=f"SRG-{pid}",
        vehicle_id="VAN-01",
        route_id="R1",
        status="assigned",
        in_vehicle_id=None,
        lat=STOP_A.lat,
        lng=STOP_A.lng,
    )
    return dataclasses.replace(base, **over)


def at(point: GeoPoint) -> dict:
    return {"lat": point.lat, "lng": point.lng}


def ctx(parcels: List[EngineParcel], **over: Any) -> EngineContext:
    base = EngineContext(
        vehicle_id="VAN-01",
        route_status="loading",
        location=HUB,
        parcels_by_epc={p.epc: p for p in parcels},
        geofence_m=150,
    )
    return dataclasses.replace(base, **over)


# ------------------------------------------------------------- distanceM


class TestDistance:
    def test_is_zero_for_identical_points_and_symmetric(self) -> None:
        assert distance_m(HUB, HUB) == pytest.approx(0, abs=1e-5)
        assert distance_m(HUB, STOP_A) == pytest.approx(distance_m(STOP_A, HUB), abs=1e-6)

    def test_matches_a_known_distance_within_1_percent(self) -> None:
        # ~0.01 deg latitude ~ 1112 m
        d = distance_m(GeoPoint(28.5, 77), GeoPoint(28.51, 77))
        assert 1100 < d < 1124


# ------------------------------------------------------- PresenceTracker


class TestPresenceTracker:
    def test_debounces_read_misses_shorter_than_the_absence_timeout(self) -> None:
        t = PresenceTracker(5000)
        assert t.ingest(["e2 80 aa"], 0).arrived == ["E280AA"]
        assert t.ingest([], 3000).departed == []
        assert t.ingest(["E280AA"], 4000).arrived == []
        assert t.ingest([], 8000).departed == []
        assert t.ingest([], 9001).departed == [Departure("E280AA", 4000)]
        assert t.present() == []


# --------------------------------------------------------- decideArrival


class TestDecideArrival:
    def test_marks_an_assigned_parcel_as_loaded(self) -> None:
        p = parcel("1")
        assert decide_arrival(p.epc, ctx([p]), 1)[0].kind == "loaded"

    def test_flags_a_parcel_assigned_to_another_vehicle(self) -> None:
        p = parcel("2", vehicle_id="VAN-02")
        assert decide_arrival(p.epc, ctx([p]), 1)[0].kind == "wrong_vehicle"

    def test_flags_unknown_tags(self) -> None:
        assert decide_arrival("DEADBEEF", ctx([]), 1)[0].kind == "unknown_tag"

    def test_flags_a_delivered_parcel_that_is_still_in_the_cargo(self) -> None:
        p = parcel("3", status="delivered")
        assert decide_arrival(p.epc, ctx([p]), 1)[0].kind == "delivered_but_present"

    def test_redetects_a_parcel_that_was_flagged_as_removed(self) -> None:
        p = parcel("4", status="exception")
        assert decide_arrival(p.epc, ctx([p]), 1)[0].kind == "redetected"


# ------------------------------------------------------- decideDeparture


class TestDecideDeparture:
    def test_treats_removal_before_the_route_starts_as_a_normal_hub_unload(self) -> None:
        p = parcel("5", status="loaded", in_vehicle_id="VAN-01")
        assert decide_departure(p.epc, 0, ctx([p]), 1)[0].kind == "unloaded_at_hub"

    def test_accepts_removal_inside_the_parcels_own_destination_geofence(self) -> None:
        p = parcel("6", status="in_transit", in_vehicle_id="VAN-01")
        near = GeoPoint(STOP_A.lat + 0.0005, STOP_A.lng)  # ~55 m
        d = decide_departure(p.epc, 0, ctx([p], route_status="in_progress", location=near), 1)
        assert d[0].kind == "left_at_stop"

    def test_raises_unauthorized_removal_away_from_any_stop(self) -> None:
        p = parcel("7", status="in_transit", in_vehicle_id="VAN-01")
        d = decide_departure(p.epc, 0, ctx([p], route_status="in_progress", location=HUB), 1)
        assert d[0].kind == "unauthorized_removal"

    def test_detects_a_parcel_dropped_at_another_customers_stop(self) -> None:
        a = parcel("8", status="in_transit", **at(STOP_A))
        b = parcel("9", status="in_transit", **at(STOP_B))
        d = decide_departure(a.epc, 0, ctx([a, b], route_status="in_progress", location=STOP_B), 1, [a, b])
        assert d[0].kind == "wrong_stop"

    def test_clears_a_foreign_parcel_when_it_leaves(self) -> None:
        p = parcel("10", vehicle_id="VAN-03")
        assert decide_departure(p.epc, 0, ctx([p]), 1)[0].kind == "wrong_vehicle_cleared"


# -------------------------------------------------------------- checkLoad


class TestCheckLoad:
    def test_reports_missing_and_extra_tags(self) -> None:
        a = parcel("11")
        b = parcel("12")
        r = check_load([a, b], [a.epc, "ABCDEF"])
        assert [p.id for p in r.missing] == ["12"]
        assert r.extra_epcs == ["ABCDEF"]
        assert r.passed is False
        assert r.rate == 50

    def test_passes_when_everything_is_present_and_ignores_delivered_parcels(self) -> None:
        a = parcel("13")
        b = parcel("14", status="delivered")
        r = check_load([a, b], [normalize_epc(a.epc.lower())])
        assert r.passed is True
        assert r.expected == 1


# ------------------------------------------- extra branch checks (Python side)


class TestExtraBranches:
    def test_loaded_parcel_back_in_its_own_vehicle_is_just_present(self) -> None:
        p = parcel("20", status="in_transit", in_vehicle_id="VAN-01")
        assert decide_arrival(p.epc, ctx([p]), 1)[0].kind == "present"

    def test_loaded_parcel_put_back_after_leaving_at_a_stop_is_redetected(self) -> None:
        p = parcel("21", status="in_transit", in_vehicle_id=None)
        assert decide_arrival(p.epc, ctx([p]), 1)[0].kind == "redetected"

    def test_wrong_vehicle_is_checked_before_delivered(self) -> None:
        p = parcel("22", vehicle_id="VAN-02", status="delivered")
        assert decide_arrival(p.epc, ctx([p]), 1)[0].kind == "wrong_vehicle"

    @pytest.mark.parametrize("status", ["registered", "assigned"])
    def test_registered_and_assigned_both_load(self, status: str) -> None:
        p = parcel("23", status=status)
        assert decide_arrival(p.epc, ctx([p]), 1)[0].kind == "loaded"

    def test_unknown_and_done_parcels_produce_no_departure(self) -> None:
        p = parcel("24", status="returned")
        assert decide_departure("DEADBEEF", 0, ctx([p]), 1) == []
        assert decide_departure(p.epc, 0, ctx([p], route_status="in_progress"), 1) == []

    def test_no_gps_fix_during_a_route_is_unauthorized_with_unknown_distance(self) -> None:
        p = parcel("25", status="in_transit", in_vehicle_id="VAN-01")
        d = decide_departure(p.epc, 7, ctx([p], route_status="in_progress", location=None), 9)[0]
        assert (d.kind, d.distance_m, d.last_seen, d.at) == ("unauthorized_removal", None, 7, 9)

    def test_no_active_route_counts_as_at_the_hub(self) -> None:
        p = parcel("26", status="loaded", in_vehicle_id="VAN-01")
        assert decide_departure(p.epc, 0, ctx([p], route_status=None, location=None), 1)[0].kind == "unloaded_at_hub"

    def test_wrong_stop_picks_the_nearest_undelivered_other_stop(self) -> None:
        a = parcel("27", status="in_transit", **at(STOP_A))
        near = parcel("28", status="in_transit", lat=STOP_B.lat + 0.0003, lng=STOP_B.lng)
        nearest = parcel("29", status="in_transit", **at(STOP_B))
        delivered = parcel("30", status="delivered", **at(STOP_B))
        route = [a, near, nearest, delivered]
        d = decide_departure(a.epc, 0, ctx(route, route_status="in_progress", location=STOP_B), 1, route)[0]
        assert d.kind == "wrong_stop"
        assert d.near_parcel is nearest
        assert d.distance_m == pytest.approx(0, abs=1e-6)

    def test_departures_come_out_in_first_arrival_order(self) -> None:
        t = PresenceTracker(1000)
        t.ingest(["BB", "AA"], 0)
        t.ingest(["AA"], 500)
        assert [d.epc for d in t.ingest([], 2000).departed] == ["BB", "AA"]

    def test_rate_rounds_half_up_like_javascript(self) -> None:
        manifest = [parcel(str(i)) for i in range(40, 48)]  # 8 parcels
        r = check_load(manifest, [p.epc for p in manifest[:1]])  # 1/8 = 12.5 %
        assert r.rate == 12.5
        manifest3 = [parcel(str(i)) for i in range(50, 53)]
        assert check_load(manifest3, [manifest3[0].epc]).rate == 33.3
        assert check_load([], []).rate == 100

    def test_alert_vocabulary_matches_the_typescript_table(self) -> None:
        severities = {k: v.severity for k, v in ALERT_META.items()}
        assert severities == {
            "missing_parcel": "critical",
            "unauthorized_removal": "critical",
            "wrong_vehicle": "warning",
            "delivery_mismatch": "warning",
            "unknown_tag": "info",
            "reader_offline": "warning",
        }
