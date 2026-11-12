"""Shared test helpers: a fake clock, a demo dataset and an emulation of the
device-role rules in ``firestore.rules`` (plugged into InMemoryFirestore so
every write the gateway makes in a test is checked against them)."""
from __future__ import annotations

import copy
from datetime import datetime
from typing import Any, Dict, FrozenSet, Iterable, Optional

from smartroute_gateway.firebase_client import Document, PermanentError, database_path
from smartroute_gateway.memstore import InMemoryFirestore

DATABASE = database_path("test-project")
VEHICLE = "VAN-01"
DEVICE = "RDR-01"
HUB = (28.5011, 77.0838)
STOP_A = (28.4950, 77.0890)  # Cyber City
STOP_B = (28.4683, 77.0645)  # Sector 29
T0 = 1_767_225_600.0  # 2026-01-01T00:00:00Z


class FakeClock:
    def __init__(self, now: float = T0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def epc(n: int) -> str:
    return f"E2801170000002{n:010d}"


def parcel_doc(n: int, **over: Any) -> Document:
    doc: Document = {
        "trackingId": f"SRG-T{n:04d}",
        "epc": epc(n),
        "recipientName": "Test Recipient",
        "address": "Test address",
        "area": "Cyber City",
        "city": "Gurugram",
        "lat": STOP_A[0],
        "lng": STOP_A[1],
        "status": "assigned",
        "vehicleId": VEHICLE,
        "routeId": "R1",
        "inVehicleId": None,
    }
    doc.update(over)
    return doc


def base_docs(route_status: str = "loading", parcels: Optional[Dict[str, Document]] = None) -> Dict[str, Document]:
    docs: Dict[str, Document] = {
        f"vehicles/{VEHICLE}": {"name": "Van 01", "status": "loading", "activeRouteId": "R1", "presentEpcs": [], "readerOnline": False},
        "vehicles/VAN-02": {"name": "Van 02", "status": "en_route", "activeRouteId": "R2"},
        "routes/R1": {"code": "R-1", "vehicleId": VEHICLE, "status": route_status, "parcelIds": ["P1", "P2"]},
        f"devices/{DEVICE}": {"vehicleId": VEHICLE, "model": "CHAFON CF591", "firmware": "unknown"},
        "publicTracking/SRG-T0001": {"trackingId": "SRG-T0001", "status": "assigned", "area": "Cyber City", "city": "Gurugram", "recipientInitials": "T.R.", "timeline": []},
    }
    for pid, data in (parcels or {}).items():
        docs[f"parcels/{pid}"] = data
    return docs


def _affected(before: Document, after: Document) -> FrozenSet[str]:
    keys = set(before) | set(after)
    return frozenset(k for k in keys if k not in before or k not in after or before[k] != after[k])


class DeviceRules:
    """The device-role branches of firestore.rules, for a device whose profile
    says ``vehicleId == VEHICLE`` and ``deviceId == DEVICE``."""

    VEHICLE_FIELDS = {"presentEpcs", "presentCount", "lastScanAt", "readerOnline", "location", "status", "updatedAt"}
    PARCEL_SEEN_FIELDS = {"inVehicleId", "lastSeenAt", "updatedAt"}
    PARCEL_LIFECYCLE_FIELDS = {"status", "inVehicleId", "lastSeenAt", "loadedAt", "leftVehicleAt", "updatedAt"}
    ALERT_UPDATE_FIELDS = {"status", "acknowledgedAt", "acknowledgedBy", "resolvedAt", "resolvedBy", "resolution"}
    DEVICE_FIELDS = {"lastHeartbeat", "stats", "ip", "firmware", "updatedAt"}

    def __init__(self, vehicle: str = VEHICLE, device: str = DEVICE) -> None:
        self.vehicle = vehicle
        self.device = device

    def __call__(self, path: str, before: Optional[Document], after: Document, request_time: datetime) -> None:
        collection, doc_id = path.split("/", 1)
        if not self._allowed(collection, doc_id, before, after, request_time):
            raise PermanentError(f"PERMISSION_DENIED: device may not write {path}", "PERMISSION_DENIED", 403)

    def _allowed(self, collection: str, doc_id: str, before: Optional[Document], after: Document, request_time: datetime) -> bool:
        me = self.vehicle
        if collection == "events":  # create only, append-only trail
            actor = after.get("actor") or {}
            return before is None and after.get("createdAt") == request_time and actor.get("type") == "device" and after.get("vehicleId") == me
        if collection == "alerts":
            if before is None:
                return after.get("createdAt") == request_time and after.get("status") == "open" and after.get("vehicleId") == me
            return before.get("vehicleId") == me and _affected(before, after) <= self.ALERT_UPDATE_FIELDS
        if collection == "publicTracking":
            return True  # any writer
        if before is None:  # everything below is update-only for a device
            return False
        changed = _affected(before, after)
        if collection == "vehicles":
            return doc_id == me and changed <= self.VEHICLE_FIELDS
        if collection == "parcels":
            seen = changed <= self.PARCEL_SEEN_FIELDS and (after.get("inVehicleId") == me or before.get("inVehicleId") == me)
            lifecycle = before.get("vehicleId") == me and changed <= self.PARCEL_LIFECYCLE_FIELDS
            return seen or lifecycle
        if collection == "devices":
            return doc_id == self.device and changed <= self.DEVICE_FIELDS
        return False


def make_store(docs: Dict[str, Document], clock: FakeClock) -> InMemoryFirestore:
    return InMemoryFirestore(DATABASE, copy.deepcopy(docs), clock=clock, validator=DeviceRules())


def all_writes(store: InMemoryFirestore) -> Iterable[Dict[str, Any]]:
    for commit in store.commits:
        yield from commit


def assert_server_stamped_creates(store: InMemoryFirestore) -> None:
    """Every event/alert create must stamp createdAt with a REQUEST_TIME transform."""
    for write in all_writes(store):
        name = write["update"]["name"]
        if "/documents/events/" in name or ("/documents/alerts/" in name and write.get("currentDocument") == {"exists": False}):
            assert write["currentDocument"] == {"exists": False}, name
            assert {"fieldPath": "createdAt", "setToServerValue": "REQUEST_TIME"} in write["updateTransforms"], name
            assert "createdAt" not in write["update"]["fields"], name
