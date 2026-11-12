"""The gateway's local view of the cloud.

* the vehicle doc and its active route (``vehicles/{me}.activeRouteId`` ->
  ``routes/{id}``), refreshed every ``routeRefreshSec``;
* parcels indexed by EPC - this vehicle's manifest (``vehicleId == me``) plus
  anything the cloud says is in this cargo (``inVehicleId == me``, e.g. a
  wrong-vehicle parcel) - refreshed every ``parcelRefreshSec``;
* open/acknowledged alerts for this vehicle, for de-duplication.

An EPC that is not in the cache is not declared unknown straight away: its
arrival is *deferred* and the sync thread runs one targeted ``epc ==`` query
(a parcel may have been registered since the last refresh). Only if that
finds nothing does the engine see it as ``unknown_tag``.

Threading: the main thread (inventory rounds) and the sync thread (network)
share this object; both hold ``lock`` while touching it. Network calls are
made *outside* the lock.

Caches are only replaced when the outbox holds no un-sent parcel/alert
writes: until those land, the cloud's copy is older than ours (the writer
updates cached parcels optimistically), and swapping it in would make the
engine repeat decisions.
"""
from __future__ import annotations

import logging
import math
import threading
from typing import Any, Dict, List, Mapping, Optional, Set, Tuple

from .engine import DONE, EngineContext, EngineParcel, GeoPoint, normalize_epc
from .firebase_client import DocumentStore
from .queue import Outbox

log = logging.getLogger(__name__)

AlertKey = Tuple[str, str]


def alert_key(alert_type: str, parcel_id: Optional[str] = None, epc: Optional[str] = None) -> AlertKey:
    """De-dup key ``(type, parcelId | epc)``; the vehicle is implicit (we only track our own)."""
    if parcel_id:
        return alert_type, f"parcel:{parcel_id}"
    if epc:
        return alert_type, f"epc:{normalize_epc(epc)}"
    return alert_type, ""


class OpenAlerts:
    """Open/acknowledged alerts of this vehicle: de-dup key -> alert id."""

    def __init__(self) -> None:
        self._ids: Dict[AlertKey, str] = {}

    def get(self, key: AlertKey) -> Optional[str]:
        return self._ids.get(key)

    def add(self, key: AlertKey, alert_id: str) -> None:
        self._ids[key] = alert_id

    def pop(self, key: AlertKey) -> Optional[str]:
        return self._ids.pop(key, None)

    def replace(self, ids: Mapping[AlertKey, str]) -> None:
        self._ids = dict(ids)

    def __len__(self) -> int:
        return len(self._ids)


def _number(value: Any) -> float:
    # A parcel without destination coordinates gets NaN: every distance
    # comparison with NaN is False, so it can never count as "at its stop".
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    return math.nan


def _optional_str(value: Any) -> Optional[str]:
    return str(value) if value else None


def parcel_from_doc(doc_id: str, data: Mapping[str, Any]) -> Optional[EngineParcel]:
    """``parcels/{id}`` fields -> EngineParcel (None if it has no EPC)."""
    epc = normalize_epc(str(data.get("epc") or ""))
    if not epc:
        return None
    return EngineParcel(
        id=doc_id,
        epc=epc,
        tracking_id=str(data.get("trackingId") or doc_id),
        status=str(data.get("status") or "registered"),
        lat=_number(data.get("lat")),
        lng=_number(data.get("lng")),
        vehicle_id=_optional_str(data.get("vehicleId")),
        route_id=_optional_str(data.get("routeId")),
        in_vehicle_id=_optional_str(data.get("inVehicleId")),
    )


class GatewayState:
    def __init__(self, vehicle_id: str) -> None:
        self.vehicle_id = vehicle_id
        self.lock = threading.RLock()
        self.alerts = OpenAlerts()
        self.parcels_by_epc: Dict[str, EngineParcel] = {}
        self.parcels_loaded = False
        self.vehicle: Optional[Dict[str, Any]] = None
        self.route_id: Optional[str] = None
        self.route: Optional[Dict[str, Any]] = None
        self._deferred: Dict[str, int] = {}  # EPC -> arrival time, waiting for a lookup
        self._not_registered: Set[str] = set()  # lookups that found nothing
        self._seed: List[str] = []

    # ------------------------------------------------------- engine inputs

    @property
    def route_status(self) -> Optional[str]:
        status = (self.route or {}).get("status")
        return str(status) if status else None

    def route_parcels(self) -> List[EngineParcel]:
        """Parcels of the active route (for the wrong-stop check)."""
        ids = (self.route or {}).get("parcelIds") or []
        by_id = {p.id: p for p in self.parcels_by_epc.values()}
        return [by_id[i] for i in ids if i in by_id]

    def engine_context(self, location: Optional[GeoPoint], geofence_m: float) -> EngineContext:
        return EngineContext(
            vehicle_id=self.vehicle_id,
            route_status=self.route_status,
            location=location,
            parcels_by_epc=self.parcels_by_epc,
            geofence_m=geofence_m,
        )

    # ------------------------------------------ deferred arrivals (main thread)

    def can_decide(self, epc: str) -> bool:
        """True when the engine may decide this EPC's arrival now."""
        if epc in self.parcels_by_epc:
            return True
        if self.parcels_loaded and epc in self._not_registered:
            self._not_registered.discard(epc)  # look it up again on its next arrival
            return True
        return False

    def defer_arrival(self, epc: str, at: int) -> None:
        self._deferred.setdefault(epc, at)

    def cancel_deferred(self, epc: str) -> bool:
        """Forget a deferred arrival (the tag left before it was decided)."""
        self._not_registered.discard(epc)
        return self._deferred.pop(epc, None) is not None

    def ready_arrivals(self) -> List[Tuple[str, int]]:
        """Deferred arrivals that can now be decided, with their original arrival time."""
        ready = [(epc, at) for epc, at in self._deferred.items() if self.can_decide(epc)]
        for epc, _ in ready:
            del self._deferred[epc]
        return ready

    def take_seed(self) -> List[str]:
        """EPCs the cloud believes are in this cargo, handed out once after the
        first parcel load so the presence tracker can watch them too."""
        seed, self._seed = self._seed, []
        return seed

    # ---------------------------------------------------- refresh (sync thread)

    def refresh_route(self, store: DocumentStore) -> None:
        vehicle = store.get_document(f"vehicles/{self.vehicle_id}")
        route_id = _optional_str((vehicle or {}).get("activeRouteId"))
        route = store.get_document(f"routes/{route_id}") if route_id else None
        with self.lock:
            if vehicle is None and self.vehicle is None:
                log.warning("vehicles/%s does not exist - ask an admin to create it", self.vehicle_id)
            new_status = str((route or {}).get("status") or "") or None
            if route_id != self.route_id or new_status != self.route_status:
                log.info("active route: %s (status %s)", route_id or "none", new_status or "-")
            self.vehicle, self.route_id, self.route = vehicle, route_id, route

    def refresh_parcels(self, store: DocumentStore, outbox: Outbox) -> bool:
        """Reload parcels + open alerts. Returns False if skipped because local
        writes have not reached the cloud yet (try again shortly)."""
        with self.lock:
            if outbox.depth(ordered_only=True):
                return False
            version = outbox.version

        rows = store.run_query("parcels", {"vehicleId": self.vehicle_id}) + store.run_query("parcels", {"inVehicleId": self.vehicle_id})
        parcels: Dict[str, EngineParcel] = {}
        for doc_id, data in rows:
            parcel = parcel_from_doc(doc_id, data)
            if parcel is None:
                continue
            other = parcels.get(parcel.epc)
            if other is not None and other.id != parcel.id:
                log.warning("EPC %s is registered to two parcels (%s, %s); using %s", parcel.epc, other.id, parcel.id, parcel.id)
            parcels[parcel.epc] = parcel

        alerts: Dict[AlertKey, str] = {}
        for status in ("open", "acknowledged"):
            for alert_id, data in store.run_query("alerts", {"vehicleId": self.vehicle_id, "status": status}):
                alerts[alert_key(str(data.get("type") or ""), _optional_str(data.get("parcelId")), _optional_str(data.get("epc")))] = alert_id

        with self.lock:
            if outbox.version != version or outbox.depth(ordered_only=True):
                return False
            # Keep parcels found by a targeted lookup whose arrival is still waiting.
            for epc in self._deferred:
                if epc in self.parcels_by_epc and epc not in parcels:
                    parcels[epc] = self.parcels_by_epc[epc]
            first_load = not self.parcels_loaded
            self.parcels_by_epc = parcels
            self.alerts.replace(alerts)
            self.parcels_loaded = True
            if first_load:
                self._seed = [p.epc for p in parcels.values() if p.in_vehicle_id == self.vehicle_id and p.status not in DONE]
                log.info("loaded %d parcel(s), %d open alert(s); %d parcel(s) recorded in this cargo", len(parcels), len(alerts), len(self._seed))
        return True

    def resolve_lookups(self, store: DocumentStore) -> None:
        """Targeted ``epc ==`` query for each deferred EPC not looked up yet."""
        with self.lock:
            todo = [e for e in self._deferred if e not in self.parcels_by_epc and e not in self._not_registered]
        for epc in todo:
            rows = store.run_query("parcels", {"epc": epc}, limit=1)
            parcel = parcel_from_doc(*rows[0]) if rows else None
            with self.lock:
                if parcel is not None:
                    self.parcels_by_epc[parcel.epc] = parcel
                else:
                    self._not_registered.add(epc)
