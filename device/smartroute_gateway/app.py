"""The gateway: inventory loop on the main thread, cloud sync on a background thread.

Main thread, every ``inventoryIntervalMs`` (~1 s) - never touches the network:

    reader.inventory() -> PresenceTracker -> engine decisions -> Writer -> outbox (SQLite)
                                                    \\-> vehicles/{me} presence when the set changed

Sync thread, every 0.5 s (or when woken):

    flush outbox -> targeted EPC lookups -> refresh route / parcels / alerts
    + enqueue heartbeat (every heartbeatSec) and location (5 s if moved > 10 m, else 30 s)

Keeping the network off the main thread matters: a stalled HTTPS request in
a dead zone must not delay inventory rounds, or shadowed tags would be
declared "departed" when rounds resume.

Reader failures: rounds where the reader does not answer are *not* fed to
the presence tracker (a dead reader is not an empty cargo area). After
``OFFLINE_AFTER_FAILURES`` consecutive failures the vehicle is marked
``readerOnline: false`` and one ``reader_offline`` alert is raised; the
reader is reopened every round and the alert auto-resolves on recovery.
"""
from __future__ import annotations

import logging
import signal
import socket
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any, Callable, Deque, Dict, List, Mapping, Optional, Tuple

from . import __version__
from .config import Config, GpsSettings, ReaderSettings
from .engine import Decision, GeoPoint, PresenceTracker, decide_arrival, decide_departure, distance_m, normalize_epc
from .firebase_client import AuthError, DocumentStore, FirebaseAuth, FirebaseError, PermanentError, TransientError
from .gps import GpsFix, GpsSource, NmeaGps, NoGps, SimulatedGps
from .queue import Outbox
from .readers.base import Reader, ReaderError
from .readers.chafon import ChafonReader
from .readers.lines import LinesReader
from .readers.simulated import SimulatedReader
from .state import GatewayState
from .writer import WriteContext, Writer

log = logging.getLogger(__name__)

FIRMWARE = f"smartroute-gateway {__version__}"
OFFLINE_AFTER_FAILURES = 3
SYNC_INTERVAL_S = 0.5
IDENTITY_RETRY_S = 60.0
OFFLINE_RETRY_S = 10.0
LOCATION_MIN_INTERVAL_S = 5.0
LOCATION_MIN_MOVE_M = 10.0
LOCATION_MAX_INTERVAL_S = 30.0
THERMAL_ZONE = Path("/sys/class/thermal/thermal_zone0/temp")


# ------------------------------------------------------------- factories


def build_reader(settings: ReaderSettings) -> Reader:
    if settings.backend == "chafon":
        return ChafonReader(
            settings.port,
            settings.baud,
            settings.address,
            settings.commands,
            settings.layout,
            settings.response_timeout_ms / 1000,
            settings.tx_power_dbm,
        )
    if settings.backend == "lines":
        return LinesReader(settings.port, settings.baud, settings.min_epc_bytes)
    return SimulatedReader(settings.simulated_tags, settings.miss_probability, interactive=True)


def build_gps(settings: GpsSettings) -> GpsSource:
    if settings.backend == "nmea":
        return NmeaGps(settings.port, settings.baud, settings.max_fix_age_s)
    if settings.backend == "simulated":
        return SimulatedGps(settings.simulated_waypoints, settings.simulated_speed_kmh)
    return NoGps()


# --------------------------------------------------------------- helpers


def cpu_temp_c(path: Path = THERMAL_ZONE) -> Optional[float]:
    try:
        return round(int(path.read_text().strip()) / 1000, 1)
    except (OSError, ValueError):
        return None


def local_ip() -> Optional[str]:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))  # UDP "connect" sends nothing; it only picks the outbound interface
            return str(sock.getsockname()[0])
    except OSError:
        return None


def identity_problems(profile: Optional[Mapping[str, Any]], vehicle_id: str, device_id: str) -> List[str]:
    """Why ``users/{uid}`` does not match this gateway's config (empty = OK)."""
    if profile is None:
        return ["users/{uid} does not exist (an admin must create the device profile)"]
    problems = []
    if profile.get("role") != "device":
        problems.append(f"role is {profile.get('role')!r}, expected 'device'")
    if profile.get("vehicleId") != vehicle_id:
        problems.append(f"vehicleId is {profile.get('vehicleId')!r} but config says {vehicle_id!r}")
    if profile.get("deviceId") != device_id:
        problems.append(f"deviceId is {profile.get('deviceId')!r} but config says {device_id!r}")
    return problems


def describe_decision(d: Decision) -> str:
    subject = f"{d.parcel.tracking_id} ({d.parcel.epc})" if d.parcel else (d.epc or "?")
    extra = f", {d.distance_m:.0f} m" if d.distance_m is not None else ""
    return f"{d.kind:<22} {subject}{extra}"


# --------------------------------------------------------------- gateway


class Gateway:
    def __init__(
        self,
        cfg: Config,
        reader: Reader,
        gps: GpsSource,
        store: DocumentStore,
        outbox: Outbox,
        auth: Optional[FirebaseAuth] = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.cfg = cfg
        self.reader = reader
        self.gps = gps
        self.store = store
        self.outbox = outbox
        self.auth = auth
        self._clock = clock
        self.state = GatewayState(cfg.device.vehicle_id)
        self.tracker = PresenceTracker(int(cfg.engine.absence_timeout_sec * 1000))
        self.writer = Writer(outbox, self.state.alerts, store.database, cfg.device.vehicle_id, cfg.device.device_id, gps.source)
        self._stop = threading.Event()
        self._wake = threading.Event()

        # main thread
        self._failures = 0
        self._first_failure_ms = 0
        self._reader_offline = False
        self._last_scan_ms: Optional[int] = None
        self._published: Optional[Tuple[Tuple[str, ...], bool]] = None

        # shared counters for the heartbeat
        self._stats_lock = threading.Lock()
        self._reads: Deque[Tuple[float, int]] = deque()
        self._unique_tags = 0

        # sync thread
        self._started_at = clock()
        self._identity_ok = auth is None  # nothing to verify offline (--dry-run)
        self._next_identity = 0.0
        self._next_route = 0.0
        self._next_parcels = 0.0
        self._next_heartbeat = 0.0
        self._last_location: Optional[Tuple[float, GeoPoint]] = None
        self._cloud_ok: Optional[bool] = None

    # ---------------------------------------------------------- lifecycle

    def run(self) -> None:
        """Run until SIGINT/SIGTERM (or ``stop()``)."""
        if threading.current_thread() is threading.main_thread():
            for sig in (signal.SIGINT, signal.SIGTERM):
                signal.signal(sig, lambda *_: self.stop())
        log.info(
            "gateway %s starting: vehicle %s, reader %s (%s), GPS %s",
            FIRMWARE,
            self.cfg.device.vehicle_id,
            self.cfg.device.device_id,
            type(self.reader).__name__,
            type(self.gps).__name__,
        )
        self.gps.start()
        sync = threading.Thread(target=self._sync_loop, name="sync", daemon=True)
        sync.start()
        interval = self.cfg.reader.inventory_interval_ms / 1000
        next_round = time.monotonic()
        try:
            while not self._stop.is_set():
                self.run_round(int(self._clock() * 1000))
                next_round += interval
                delay = next_round - time.monotonic()
                if delay < 0:  # overran (slow reader): don't try to catch up
                    next_round, delay = time.monotonic(), 0.0
                self._stop.wait(delay)
        finally:
            self._shutdown(sync)

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()

    def _shutdown(self, sync: threading.Thread) -> None:
        log.info("shutting down")
        with self.state.lock:
            self.writer.publish_presence(self.tracker.present(), self._last_scan_ms, reader_online=False)
        sync.join(timeout=30)
        if self._identity_ok:
            self.outbox.flush(self.store.commit)  # last chance; anything left is sent on the next start
        self.reader.close()
        self.gps.stop()
        log.info("stopped; %d write(s) waiting in the outbox", self.outbox.depth())

    # -------------------------------------------------- main thread: rounds

    def run_round(self, now_ms: int) -> None:
        """One inventory round: read, debounce, decide, enqueue writes."""
        try:
            if not self.reader.is_open:
                self.reader.open()
            raw = self.reader.inventory()
        except ReaderError as err:
            self._reader_failed(err, now_ms)
            return
        location = self._location()
        with self.state.lock:
            wctx = self._write_context(location)
            if self._failures:
                self._reader_recovered(now_ms, wctx)
            self._last_scan_ms = now_ms
            read = [e for e in (normalize_epc(r) for r in raw) if e]
            self._process(read, now_ms, location, wctx)
            self._publish_presence()
        with self._stats_lock:
            self._reads.append((now_ms / 1000, len(read)))
            self._unique_tags = len(self.tracker.present())

    def _process(self, read: List[str], now_ms: int, location: Optional[GeoPoint], wctx: WriteContext) -> None:
        # EPCs the cloud says are in this cargo are watched from the first
        # round, so a parcel removed while the gateway was down still departs.
        seed = self.state.take_seed()
        result = self.tracker.ingest(read + seed, now_ms)
        read_set = set(read)
        ctx = self.state.engine_context(location, self.cfg.engine.geofence_m)
        decisions: List[Decision] = []
        route_parcels = self.state.route_parcels()
        for dep in result.departed:
            if self.state.cancel_deferred(dep.epc):
                continue  # its arrival was never decided, so there is nothing to undo
            decisions += decide_departure(dep.epc, dep.last_seen, ctx, now_ms, route_parcels)
        for epc, arrived_at in self.state.ready_arrivals():
            decisions += decide_arrival(epc, ctx, arrived_at)
        for epc in result.arrived:
            if epc not in read_set:
                continue  # seeded, not physically read
            if self.state.can_decide(epc):
                decisions += decide_arrival(epc, ctx, now_ms)
            else:
                self.state.defer_arrival(epc, now_ms)  # not in the cache: sync thread looks it up
                self._wake.set()
        for d in decisions:
            log.info("%s", describe_decision(d))
            self.writer.apply(d, wctx)

    def _publish_presence(self) -> None:
        present = tuple(self.tracker.present())
        online = not self._reader_offline
        if self._published != (present, online):
            self.writer.publish_presence(list(present), self._last_scan_ms, online)
            self._published = (present, online)

    def _reader_failed(self, err: ReaderError, now_ms: int) -> None:
        if self._failures == 0:
            self._first_failure_ms = now_ms
            log.warning("reader error: %s", err)
        self._failures += 1
        self.reader.close()  # reopened on the next round
        if self._failures >= OFFLINE_AFTER_FAILURES and not self._reader_offline:
            self._reader_offline = True
            log.error("RFID reader offline after %d failed rounds: %s", self._failures, err)
            with self.state.lock:
                self.writer.reader_offline(str(err), self._first_failure_ms, self._write_context(self._location()))
                self._publish_presence()

    def _reader_recovered(self, now_ms: int, wctx: WriteContext) -> None:
        # Rounds the reader missed are no evidence that tags left: restart
        # every tag's absence timer instead of letting them all depart now.
        self.tracker.ingest(self.tracker.present(), now_ms)
        self._failures = 0
        if self._reader_offline:
            self._reader_offline = False
            log.info("RFID reader is back online")
            self.writer.reader_recovered(now_ms, wctx)

    def _location(self) -> Optional[GeoPoint]:
        fix = self.gps.current_fix()
        return fix.point() if fix else None

    def _write_context(self, location: Optional[GeoPoint]) -> WriteContext:
        return WriteContext(route_id=self.state.route_id, route_status=self.state.route_status, location=location)

    # ----------------------------------------------------- sync thread

    def _sync_loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.sync_once(self._clock())
            except Exception:  # never let the sync thread die
                log.exception("sync step failed")
            self._wake.wait(SYNC_INTERVAL_S)
            self._wake.clear()

    def sync_once(self, now: float) -> None:
        """One sync cycle: local periodic writes, then flush and refresh."""
        self._enqueue_periodic(now)
        if not self._identity_ok and not self._verify_identity(now):
            return  # writes stay queued until the device account checks out
        try:
            flushed = self.outbox.flush(self.store.commit)
            if flushed.blocked:
                self._set_cloud_ok(False, flushed.error)
                return
            self.state.resolve_lookups(self.store)
            if now >= self._next_route:
                self._next_route = now + self.cfg.route_refresh_sec
                self.state.refresh_route(self.store)
            if now >= self._next_parcels:
                self._next_parcels = now + (self.cfg.parcel_refresh_sec if self.state.parcels_loaded else 5.0)
                if not self.state.refresh_parcels(self.store, self.outbox):
                    self._next_parcels = now + 1.0  # local writes still in flight; retry shortly
            self._set_cloud_ok(True)
        except TransientError as err:
            self._set_cloud_ok(False, err)
        except PermanentError as err:
            log.error("Firestore read refused: %s", err)

    def _verify_identity(self, now: float) -> bool:
        if now < self._next_identity or self.auth is None:
            return False
        self._next_identity = now + IDENTITY_RETRY_S
        try:
            self.auth.token()
            profile = self.store.get_document(f"users/{self.auth.uid}")
        except FirebaseError as err:
            if isinstance(err, TransientError) and not isinstance(err, AuthError):
                self._next_identity = now + OFFLINE_RETRY_S  # just offline: try again soon
            log.warning("cannot verify the device account yet: %s", err)
            return False
        problems = identity_problems(profile, self.cfg.device.vehicle_id, self.cfg.device.device_id)
        if problems:
            log.error(
                "device account %s is not set up for this gateway: %s. Writes stay queued; retrying in %.0f s.",
                self.auth.email,
                "; ".join(problems),
                IDENTITY_RETRY_S,
            )
            return False
        log.info("device account %s verified (vehicle %s, reader %s)", self.auth.email, self.cfg.device.vehicle_id, self.cfg.device.device_id)
        self._identity_ok = True
        return True

    def _enqueue_periodic(self, now: float) -> None:
        if now >= self._next_heartbeat:
            self._next_heartbeat = now + self.cfg.heartbeat_sec
            self.writer.heartbeat(self.stats(now), local_ip(), FIRMWARE)
        fix = self.gps.current_fix()
        if fix is not None and self._location_due(fix, now):
            self.writer.publish_location(fix)
            self._last_location = (now, fix.point())

    def _location_due(self, fix: GpsFix, now: float) -> bool:
        if self._last_location is None:
            return True
        last_at, last_point = self._last_location
        elapsed = now - last_at
        moved = distance_m(last_point, fix)
        return (moved > LOCATION_MIN_MOVE_M and elapsed >= LOCATION_MIN_INTERVAL_S) or elapsed >= LOCATION_MAX_INTERVAL_S

    def stats(self, now: float) -> Dict[str, float]:
        with self._stats_lock:
            while self._reads and self._reads[0][0] < now - 60:
                self._reads.popleft()
            reads_per_min = sum(n for _, n in self._reads)
            unique = self._unique_tags
        stats: Dict[str, float] = {
            "readsPerMin": reads_per_min,
            "uniqueTags": unique,
            "uptimeSec": int(now - self._started_at),
            "queueDepth": self.outbox.depth(),
        }
        temp = cpu_temp_c()
        if temp is not None:
            stats["cpuTempC"] = temp
        return stats

    def _set_cloud_ok(self, ok: bool, err: Optional[Exception] = None) -> None:
        if ok != self._cloud_ok:
            if ok:
                log.info("cloud reachable; outbox depth %d", self.outbox.depth())
            else:
                log.warning("cloud unreachable (%s); writes are queued locally", err or "backing off")
            self._cloud_ok = ok
