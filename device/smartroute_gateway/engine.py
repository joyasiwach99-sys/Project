"""SmartRoute Guardian - parcel verification engine (Python port).

Pure logic, no I/O. This module is a 1:1 port of ``src/lib/verification.ts``:
the same decision kinds, the same conditions and the same order of checks.
If you change one, change the other, and keep ``tests/test_engine.py`` and
``src/lib/verification.test.ts`` covering the same scenarios.

    RFID inventory rounds --> PresenceTracker --> arrivals / departures
                                                       |
                 vehicle + route + GPS context ------->|
                                                       v
                                               [Decision] (what happened)

``writer.py`` turns decisions into Firestore writes (docs/ARCHITECTURE.md 3.3).

Naming: Python attributes are snake_case (``tracking_id``); the Firestore field
names they come from stay camelCase (``trackingId``). Times are epoch
milliseconds, exactly as in the TypeScript engine.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Dict, Iterable, List, Literal, Optional, Protocol, Sequence

ParcelStatus = Literal["registered", "assigned", "loaded", "in_transit", "delivered", "exception", "returned"]
RouteStatus = Literal["planned", "loading", "in_progress", "completed", "cancelled"]
DecisionKind = Literal[
    "loaded",
    "present",
    "redetected",
    "wrong_vehicle",
    "unknown_tag",
    "delivered_but_present",
    "unloaded_at_hub",
    "left_at_stop",
    "wrong_stop",
    "unauthorized_removal",
    "wrong_vehicle_cleared",
]


class HasLatLng(Protocol):
    @property
    def lat(self) -> float: ...

    @property
    def lng(self) -> float: ...


@dataclass(frozen=True)
class GeoPoint:
    lat: float
    lng: float


@dataclass
class EngineParcel:
    """The subset of ``parcels/{id}`` the engine needs (``EngineParcel`` in TS)."""

    id: str
    epc: str
    tracking_id: str
    status: str
    lat: float
    lng: float
    vehicle_id: Optional[str] = None
    route_id: Optional[str] = None
    in_vehicle_id: Optional[str] = None


@dataclass
class EngineContext:
    vehicle_id: str
    #: Status of the vehicle's active route, or None when it has none.
    route_status: Optional[str]
    location: Optional[GeoPoint]
    parcels_by_epc: Dict[str, EngineParcel]
    geofence_m: float


@dataclass
class Decision:
    """One outcome of the engine (the TS ``Decision`` union, flattened).

    ``parcel`` is set for every kind except ``unknown_tag`` (which sets ``epc``).
    ``last_seen`` is set for departure kinds; ``distance_m`` for ``left_at_stop``,
    ``wrong_stop`` and ``unauthorized_removal`` (None there means "no GPS fix");
    ``near_parcel`` only for ``wrong_stop``.
    """

    kind: DecisionKind
    at: int
    parcel: Optional[EngineParcel] = None
    epc: Optional[str] = None
    last_seen: Optional[int] = None
    distance_m: Optional[float] = None
    near_parcel: Optional[EngineParcel] = None


# ------------------------------------------------------------------ geo

EARTH_RADIUS_M = 6_371_000


def distance_m(a: HasLatLng, b: HasLatLng) -> float:
    """Great-circle distance in metres (haversine)."""
    d_lat = math.radians(b.lat - a.lat)
    d_lng = math.radians(b.lng - a.lng)
    h = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(a.lat)) * math.cos(math.radians(b.lat)) * math.sin(d_lng / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(h)))


# ------------------------------------------------------------- presence

_NON_HEX = re.compile(r"[^0-9a-fA-F]")


def normalize_epc(raw: str) -> str:
    return _NON_HEX.sub("", raw).upper()


@dataclass(frozen=True)
class Departure:
    epc: str
    last_seen: int


@dataclass
class IngestResult:
    arrived: List[str]
    departed: List[Departure]


class PresenceTracker:
    """Debounces raw RFID reads into stable presence.

    A tag "arrives" the first time it is read and "departs" once it has not
    been read for ``absence_timeout_ms`` - this tolerates the read misses that
    are normal for UHF RFID (tags shadowed by other parcels, metal, water, angle).
    """

    def __init__(self, absence_timeout_ms: int = 6000) -> None:
        self.absence_timeout_ms = absence_timeout_ms
        # Insertion-ordered like the JS Map, so departures come out in the same order.
        self._last_seen: Dict[str, int] = {}

    def ingest(self, epcs: Iterable[str], now: int) -> IngestResult:
        arrived: List[str] = []
        for raw in epcs:
            epc = normalize_epc(raw)
            if not epc:
                continue
            if epc not in self._last_seen:
                arrived.append(epc)
            self._last_seen[epc] = now
        departed: List[Departure] = []
        for epc, seen in list(self._last_seen.items()):
            if now - seen > self.absence_timeout_ms:
                departed.append(Departure(epc, seen))
                del self._last_seen[epc]
        return IngestResult(arrived, departed)

    def present(self) -> List[str]:
        return sorted(self._last_seen)

    def has(self, epc: str) -> bool:
        return normalize_epc(epc) in self._last_seen

    def reset(self) -> None:
        self._last_seen.clear()


# ------------------------------------------------------------ decisions

DONE = ("delivered", "returned")


def decide_arrival(epc: str, ctx: EngineContext, now: int) -> List[Decision]:
    parcel = ctx.parcels_by_epc.get(epc)
    if parcel is None:
        return [Decision("unknown_tag", now, epc=epc)]

    if parcel.vehicle_id != ctx.vehicle_id:
        return [Decision("wrong_vehicle", now, parcel=parcel)]

    if parcel.status in DONE:
        return [Decision("delivered_but_present", now, parcel=parcel)]

    if parcel.status in ("registered", "assigned"):
        return [Decision("loaded", now, parcel=parcel)]

    if parcel.status == "exception":
        return [Decision("redetected", now, parcel=parcel)]

    # loaded / in_transit: if it had been taken out (e.g. customer not home) and
    # put back, clear the "left at stop" marker; otherwise just refresh presence.
    if parcel.in_vehicle_id != ctx.vehicle_id:
        return [Decision("redetected", now, parcel=parcel)]
    return [Decision("present", now, parcel=parcel)]


def decide_departure(
    epc: str,
    last_seen: int,
    ctx: EngineContext,
    now: int,
    route_parcels: Sequence[EngineParcel] = (),
) -> List[Decision]:
    parcel = ctx.parcels_by_epc.get(epc)
    if parcel is None:
        return []

    if parcel.vehicle_id != ctx.vehicle_id:
        return [Decision("wrong_vehicle_cleared", now, parcel=parcel, last_seen=last_seen)]

    if parcel.status in DONE:
        return []

    if ctx.route_status != "in_progress":
        return [Decision("unloaded_at_hub", now, parcel=parcel, last_seen=last_seen)]

    if ctx.location is None:
        return [Decision("unauthorized_removal", now, parcel=parcel, last_seen=last_seen, distance_m=None)]

    own = distance_m(ctx.location, parcel)
    if own <= ctx.geofence_m:
        return [Decision("left_at_stop", now, parcel=parcel, last_seen=last_seen, distance_m=own)]

    # Removed at somebody else's stop -> likely handed to the wrong customer.
    best: Optional[EngineParcel] = None
    best_d = 0.0
    for p in route_parcels:
        if p.id == parcel.id or p.status in DONE:
            continue
        d = distance_m(ctx.location, p)
        if d <= ctx.geofence_m and (best is None or d < best_d):
            best, best_d = p, d
    if best is not None:
        return [Decision("wrong_stop", now, parcel=parcel, last_seen=last_seen, near_parcel=best, distance_m=best_d)]

    return [Decision("unauthorized_removal", now, parcel=parcel, last_seen=last_seen, distance_m=own)]


# -------------------------------------------------------- load checking


@dataclass
class LoadCheckResult:
    expected: int
    detected: int
    missing: List[EngineParcel]
    extra_epcs: List[str]
    passed: bool
    #: Detection rate for this manifest, 0-100.
    rate: float


def check_load(manifest: Sequence[EngineParcel], present_epcs: Iterable[str]) -> LoadCheckResult:
    """Compare the route manifest with what the RFID reader currently sees.

    Parcels already delivered/returned are excluded from the expectation.
    """
    present = list(dict.fromkeys(normalize_epc(e) for e in present_epcs))  # ordered set, like JS Set
    expected = [p for p in manifest if p.status not in DONE]
    expected_epcs = {normalize_epc(p.epc) for p in expected}
    present_set = set(present)
    missing = [p for p in expected if normalize_epc(p.epc) not in present_set]
    extra_epcs = [e for e in present if e not in expected_epcs]
    detected = len(expected) - len(missing)
    # JS Math.round rounds .5 up; Python's round() is banker's rounding.
    rate = math.floor(detected / len(expected) * 1000 + 0.5) / 10 if expected else 100
    return LoadCheckResult(
        expected=len(expected),
        detected=detected,
        missing=missing,
        extra_epcs=extra_epcs,
        passed=not missing and not extra_epcs,
        rate=rate,
    )


# ---------------------------------------------------- alert vocabulary


@dataclass(frozen=True)
class AlertMeta:
    label: str
    severity: str


ALERT_META: Dict[str, AlertMeta] = {
    "missing_parcel": AlertMeta("Missing parcel", "critical"),
    "unauthorized_removal": AlertMeta("Unauthorized removal", "critical"),
    "wrong_vehicle": AlertMeta("Wrong vehicle", "warning"),
    "delivery_mismatch": AlertMeta("Delivery mismatch", "warning"),
    "unknown_tag": AlertMeta("Unknown tag", "info"),
    "reader_offline": AlertMeta("Reader offline", "warning"),
}
