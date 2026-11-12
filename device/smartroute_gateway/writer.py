"""Turns engine decisions into Firestore writes (docs/ARCHITECTURE.md 3.3).

Every write is enqueued in the outbox; nothing here touches the network.

| Decision              | parcels/{id} update                                        | Event               | Alert |
|-----------------------|------------------------------------------------------------|---------------------|-------|
| loaded                | status=after-load, inVehicleId=me, lastSeenAt, loadedAt    | parcel_loaded       | -     |
| present               | inVehicleId=me, lastSeenAt (only if inVehicleId changed)   | -                   | -     |
| redetected            | status=after-load, inVehicleId=me, lastSeenAt, leftVehicleAt=null | note        | auto-resolve unauthorized_removal / delivery_mismatch |
| wrong_vehicle         | inVehicleId=me, lastSeenAt                                 | -                   | wrong_vehicle (warning) |
| unknown_tag           | -                                                          | -                   | unknown_tag (info), once per EPC per session |
| delivered_but_present | -                                                          | -                   | delivery_mismatch (warning) |
| unloaded_at_hub       | status=assigned, inVehicleId=null, loadedAt=null           | parcel_unloaded     | -     |
| left_at_stop          | inVehicleId=null, leftVehicleAt=ts(lastSeen)               | parcel_left_at_stop | -     |
| wrong_stop            | status=exception, inVehicleId=null, leftVehicleAt          | -                   | delivery_mismatch (critical) |
| unauthorized_removal  | status=exception, inVehicleId=null, leftVehicleAt          | -                   | unauthorized_removal (critical) |
| wrong_vehicle_cleared | inVehicleId=null (only if it was me)                       | -                   | auto-resolve wrong_vehicle |

Every alert also writes an ``alert_raised`` event and every auto-resolve an
``alert_resolved`` event. ``loaded`` also appends to the parcel's
``publicTracking`` timeline.

Time conventions: ``lastSeenAt``/``loadedAt``/``deviceTime``/``detectedAt``
are the physical (device-clock) times - the arrival round for arrivals and
the last RFID read for departures; ``createdAt``/``updatedAt``/``resolvedAt``
are server timestamps (``createdAt == request.time`` is enforced by the rules).

The writer also applies each parcel change to the cached ``EngineParcel``,
so the next inventory round sees it before the cloud does.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Mapping, Optional, Set

from .engine import ALERT_META, Decision, EngineParcel, GeoPoint
from .firebase_client import Write, append_missing, create_write, new_doc_id, server_timestamp, ts, update_write
from .gps import GpsFix
from .queue import Outbox
from .state import OpenAlerts, alert_key

log = logging.getLogger(__name__)

#: Customer-facing timeline entry for a load (same wording as src/lib/gateway.ts).
LOAD_TIMELINE_LABEL = "Loaded into the delivery vehicle — verified by RFID"


@dataclass(frozen=True)
class WriteContext:
    route_id: Optional[str]
    route_status: Optional[str]
    location: Optional[GeoPoint]


def status_after_load(route_status: Optional[str]) -> str:
    return "in_transit" if route_status == "in_progress" else "loaded"


def format_distance(metres: float) -> str:
    return f"{metres:.0f} m" if metres < 1000 else f"{metres / 1000:.1f} km"


def _geo(point: Optional[GeoPoint]) -> Optional[Dict[str, float]]:
    return {"lat": point.lat, "lng": point.lng} if point else None


def _require_parcel(d: Decision) -> EngineParcel:
    assert d.parcel is not None, f"{d.kind} decision without a parcel"
    return d.parcel


def _require_last_seen(d: Decision) -> int:
    assert d.last_seen is not None, f"{d.kind} decision without last_seen"
    return d.last_seen


class Writer:
    def __init__(
        self,
        outbox: Outbox,
        alerts: OpenAlerts,
        database: str,
        vehicle_id: str,
        device_id: str,
        location_source: str = "gps_module",
        new_id: Callable[[], str] = new_doc_id,
    ) -> None:
        self._outbox = outbox
        self._alerts = alerts
        self._database = database
        self.vehicle_id = vehicle_id
        self.device_id = device_id
        self._location_source = location_source
        self._new_id = new_id
        self.actor = {"type": "device", "id": device_id, "name": f"Reader {device_id} ({vehicle_id})"}
        self._unknown_alerted: Set[str] = set()
        self._handlers: Dict[str, Callable[[Decision, WriteContext], None]] = {
            "loaded": self._loaded,
            "present": self._present,
            "redetected": self._redetected,
            "wrong_vehicle": self._wrong_vehicle,
            "unknown_tag": self._unknown_tag,
            "delivered_but_present": self._delivered_but_present,
            "unloaded_at_hub": self._unloaded_at_hub,
            "left_at_stop": self._left_at_stop,
            "wrong_stop": self._wrong_stop,
            "unauthorized_removal": self._unauthorized_removal,
            "wrong_vehicle_cleared": self._wrong_vehicle_cleared,
        }

    # -------------------------------------------------------------- public

    def apply(self, decision: Decision, ctx: WriteContext) -> None:
        self._handlers[decision.kind](decision, ctx)

    def publish_presence(self, epcs: List[str], last_scan_ms: Optional[int], reader_online: bool) -> None:
        data: Dict[str, Any] = {"presentEpcs": epcs, "presentCount": len(epcs), "readerOnline": reader_online}
        if last_scan_ms is not None:
            data["lastScanAt"] = ts(last_scan_ms)
        write = update_write(self._doc(f"vehicles/{self.vehicle_id}"), data, [server_timestamp("updatedAt")])
        self._outbox.enqueue([write], "vehicle presence", coalesce_key="vehicle-presence")

    def publish_location(self, fix: GpsFix) -> None:
        location: Dict[str, Any] = {"lat": fix.lat, "lng": fix.lng, "source": self._location_source}
        if fix.speed_kmh is not None:
            location["speedKmh"] = round(fix.speed_kmh, 1)
        if fix.heading is not None:
            location["heading"] = round(fix.heading, 1)
        write = update_write(
            self._doc(f"vehicles/{self.vehicle_id}"),
            {"location": location},
            [server_timestamp("location.updatedAt"), server_timestamp("updatedAt")],
        )
        self._outbox.enqueue([write], "vehicle location", coalesce_key="vehicle-location")

    def heartbeat(self, stats: Mapping[str, float], ip: Optional[str], firmware: str) -> None:
        data: Dict[str, Any] = {"stats": dict(stats), "firmware": firmware}
        if ip:
            data["ip"] = ip
        write = update_write(self._doc(f"devices/{self.device_id}"), data, [server_timestamp("lastHeartbeat"), server_timestamp("updatedAt")])
        self._outbox.enqueue([write], "heartbeat", coalesce_key="heartbeat")

    def reader_offline(self, error: str, since_ms: int, ctx: WriteContext) -> None:
        self._raise_alert(
            "reader_offline",
            "warning",
            message=f"RFID reader {self.device_id} in {self.vehicle_id} stopped responding ({error}). "
            "Parcel presence is frozen until it recovers.",
            detected_ms=since_ms,
            ctx=ctx,
        )

    def reader_recovered(self, at_ms: int, ctx: WriteContext) -> None:
        self._resolve_alert("reader_offline", f"Reader {self.device_id} is responding again.", at_ms, ctx)

    # ------------------------------------------------------------ decisions

    def _loaded(self, d: Decision, ctx: WriteContext) -> None:
        p = _require_parcel(d)
        status = status_after_load(ctx.route_status)
        self._commit(
            [
                self._parcel_write(p, {"status": status, "inVehicleId": self.vehicle_id, "lastSeenAt": ts(d.at), "loadedAt": ts(d.at)}),
                self._event("parcel_loaded", f"Parcel {p.tracking_id} loaded into {self.vehicle_id} (RFID verified).", d.at, ctx, p),
            ],
            f"parcel_loaded {p.tracking_id}",
        )
        # Separate commit: the public mirror may legitimately not exist, and
        # that must not cost us the parcel update.
        entry = {"status": "loaded", "label": LOAD_TIMELINE_LABEL, "at": ts(d.at), "rfidVerified": True}
        self._commit(
            [
                update_write(
                    self._doc(f"publicTracking/{p.tracking_id}"),
                    {"status": status},
                    [server_timestamp("updatedAt"), append_missing("timeline", [entry])],
                )
            ],
            f"publicTracking {p.tracking_id}",
        )
        p.status, p.in_vehicle_id = status, self.vehicle_id

    def _present(self, d: Decision, ctx: WriteContext) -> None:
        p = _require_parcel(d)
        if p.in_vehicle_id == self.vehicle_id:
            return
        self._commit([self._parcel_write(p, {"inVehicleId": self.vehicle_id, "lastSeenAt": ts(d.at)})], f"parcel present {p.tracking_id}")
        p.in_vehicle_id = self.vehicle_id

    def _redetected(self, d: Decision, ctx: WriteContext) -> None:
        p = _require_parcel(d)
        status = status_after_load(ctx.route_status)
        self._commit(
            [
                self._parcel_write(p, {"status": status, "inVehicleId": self.vehicle_id, "lastSeenAt": ts(d.at), "leftVehicleAt": None}),
                self._event("note", f"Parcel {p.tracking_id} re-detected in {self.vehicle_id}; status set to {status}.", d.at, ctx, p),
            ],
            f"parcel redetected {p.tracking_id}",
        )
        p.status, p.in_vehicle_id = status, self.vehicle_id
        for alert_type in ("unauthorized_removal", "delivery_mismatch"):
            self._resolve_alert(alert_type, f"Parcel re-detected in {self.vehicle_id}.", d.at, ctx, parcel=p)

    def _wrong_vehicle(self, d: Decision, ctx: WriteContext) -> None:
        p = _require_parcel(d)
        self._commit([self._parcel_write(p, {"inVehicleId": self.vehicle_id, "lastSeenAt": ts(d.at)})], f"parcel wrong vehicle {p.tracking_id}")
        p.in_vehicle_id = self.vehicle_id
        assigned = f"is assigned to {p.vehicle_id}" if p.vehicle_id else "is not assigned to any vehicle"
        self._raise_alert(
            "wrong_vehicle",
            "warning",
            message=f"Parcel {p.tracking_id} {assigned} but was detected in {self.vehicle_id}.",
            detected_ms=d.at,
            ctx=ctx,
            parcel=p,
        )

    def _unknown_tag(self, d: Decision, ctx: WriteContext) -> None:
        epc = d.epc or ""
        if epc in self._unknown_alerted:
            return
        self._unknown_alerted.add(epc)
        self._raise_alert(
            "unknown_tag",
            "info",
            message=f"RFID tag {epc} was detected in {self.vehicle_id} but is not registered to any parcel.",
            detected_ms=d.at,
            ctx=ctx,
            epc=epc,
        )

    def _delivered_but_present(self, d: Decision, ctx: WriteContext) -> None:
        p = _require_parcel(d)
        self._raise_alert(
            "delivery_mismatch",
            "warning",
            message=f"Parcel {p.tracking_id} is marked {p.status} but RFID still detects it in the cargo of {self.vehicle_id}.",
            detected_ms=d.at,
            ctx=ctx,
            parcel=p,
        )

    def _unloaded_at_hub(self, d: Decision, ctx: WriteContext) -> None:
        p = _require_parcel(d)
        last_seen = _require_last_seen(d)
        self._commit(
            [
                self._parcel_write(p, {"status": "assigned", "inVehicleId": None, "loadedAt": None}),
                self._event("parcel_unloaded", f"Parcel {p.tracking_id} unloaded from {self.vehicle_id} (route not in progress).", last_seen, ctx, p),
            ],
            f"parcel_unloaded {p.tracking_id}",
        )
        p.status, p.in_vehicle_id = "assigned", None

    def _left_at_stop(self, d: Decision, ctx: WriteContext) -> None:
        p = _require_parcel(d)
        last_seen = _require_last_seen(d)
        where = f" ({format_distance(d.distance_m)} from the address)" if d.distance_m is not None else ""
        self._commit(
            [
                self._parcel_write(p, {"inVehicleId": None, "leftVehicleAt": ts(last_seen)}),
                self._event("parcel_left_at_stop", f"Parcel {p.tracking_id} left {self.vehicle_id} at its destination{where}.", last_seen, ctx, p),
            ],
            f"parcel_left_at_stop {p.tracking_id}",
        )
        p.in_vehicle_id = None

    def _wrong_stop(self, d: Decision, ctx: WriteContext) -> None:
        p = _require_parcel(d)
        last_seen = _require_last_seen(d)
        self._mark_removed(p, last_seen)
        near = d.near_parcel.tracking_id if d.near_parcel else "another parcel"
        away = f" ({format_distance(d.distance_m)} from that address)" if d.distance_m is not None else ""
        self._raise_alert(
            "delivery_mismatch",
            "critical",
            message=f"Parcel {p.tracking_id} was removed from {self.vehicle_id} at the stop for {near}{away}, "
            "not at its own destination - it may have been handed to the wrong customer.",
            detected_ms=last_seen,
            ctx=ctx,
            parcel=p,
            title="Wrong stop",
        )

    def _unauthorized_removal(self, d: Decision, ctx: WriteContext) -> None:
        p = _require_parcel(d)
        last_seen = _require_last_seen(d)
        self._mark_removed(p, last_seen)
        where = f"{format_distance(d.distance_m)} from its destination" if d.distance_m is not None else "with no GPS fix (location unknown)"
        self._raise_alert(
            "unauthorized_removal",
            "critical",
            message=f"Parcel {p.tracking_id} was removed from {self.vehicle_id} {where} while the route was in progress.",
            detected_ms=last_seen,
            ctx=ctx,
            parcel=p,
        )

    def _wrong_vehicle_cleared(self, d: Decision, ctx: WriteContext) -> None:
        p = _require_parcel(d)
        if p.in_vehicle_id == self.vehicle_id:
            self._commit([self._parcel_write(p, {"inVehicleId": None})], f"parcel left (wrong vehicle) {p.tracking_id}")
            p.in_vehicle_id = None
        self._resolve_alert("wrong_vehicle", f"Parcel is no longer detected in {self.vehicle_id}.", d.at, ctx, parcel=p)

    # -------------------------------------------------------------- helpers

    def _doc(self, path: str) -> str:
        return f"{self._database}/{path}"

    def _commit(self, writes: List[Write], label: str) -> None:
        self._outbox.enqueue(writes, label)

    def _parcel_write(self, p: EngineParcel, patch: Mapping[str, Any]) -> Write:
        return update_write(self._doc(f"parcels/{p.id}"), patch, [server_timestamp("updatedAt")])

    def _mark_removed(self, p: EngineParcel, last_seen: int) -> None:
        self._commit(
            [self._parcel_write(p, {"status": "exception", "inVehicleId": None, "leftVehicleAt": ts(last_seen)})],
            f"parcel removed {p.tracking_id}",
        )
        p.status, p.in_vehicle_id = "exception", None

    def _event(
        self,
        event_type: str,
        message: str,
        device_ms: int,
        ctx: WriteContext,
        parcel: Optional[EngineParcel] = None,
        epc: Optional[str] = None,
        alert_id: Optional[str] = None,
    ) -> Write:
        data = {
            "type": event_type,
            "message": message,
            "vehicleId": self.vehicle_id,
            "parcelId": parcel.id if parcel else None,
            "trackingId": parcel.tracking_id if parcel else None,
            "routeId": parcel.route_id if parcel else ctx.route_id,
            "alertId": alert_id,
            "epc": parcel.epc if parcel else epc,
            "actor": self.actor,
            "location": _geo(ctx.location),
            "deviceTime": ts(device_ms),
        }
        return create_write(self._doc(f"events/{self._new_id()}"), data, [server_timestamp("createdAt")])

    def _raise_alert(
        self,
        alert_type: str,
        severity: str,
        message: str,
        detected_ms: int,
        ctx: WriteContext,
        parcel: Optional[EngineParcel] = None,
        epc: Optional[str] = None,
        title: Optional[str] = None,
    ) -> None:
        key = alert_key(alert_type, parcel.id if parcel else None, epc)
        subject = parcel.tracking_id if parcel else (epc or self.device_id)
        existing = self._alerts.get(key)
        if existing:
            log.debug("%s alert for %s already open (%s); not raising another", alert_type, subject, existing)
            return
        alert_id = self._new_id()
        title = title or ALERT_META[alert_type].label
        alert = {
            "type": alert_type,
            "severity": severity,
            "status": "open",
            "title": title,
            "message": message,
            "vehicleId": self.vehicle_id,
            "parcelId": parcel.id if parcel else None,
            "trackingId": parcel.tracking_id if parcel else None,
            "routeId": parcel.route_id if parcel else ctx.route_id,
            "epc": parcel.epc if parcel else epc,
            "location": _geo(ctx.location),
            "detectedAt": ts(detected_ms),
            "source": "device",
        }
        self._commit(
            [
                create_write(self._doc(f"alerts/{alert_id}"), alert, [server_timestamp("createdAt")]),
                self._event("alert_raised", f"{title}: {message}", detected_ms, ctx, parcel, epc, alert_id),
            ],
            f"alert {alert_type} {subject}",
        )
        self._alerts.add(key, alert_id)
        log.warning("ALERT %s (%s): %s", alert_type, severity, message)

    def _resolve_alert(
        self,
        alert_type: str,
        resolution: str,
        at_ms: int,
        ctx: WriteContext,
        parcel: Optional[EngineParcel] = None,
    ) -> None:
        alert_id = self._alerts.pop(alert_key(alert_type, parcel.id if parcel else None))
        if not alert_id:
            return
        self._commit(
            [
                update_write(
                    self._doc(f"alerts/{alert_id}"),
                    {"status": "resolved", "resolvedBy": self.actor, "resolution": resolution},
                    [server_timestamp("resolvedAt")],
                ),
                self._event("alert_resolved", f"{ALERT_META[alert_type].label} alert resolved automatically: {resolution}", at_ms, ctx, parcel, None, alert_id),
            ],
            f"resolve {alert_type} {parcel.tracking_id if parcel else self.device_id}",
        )
        log.info("resolved %s alert %s: %s", alert_type, alert_id, resolution)
