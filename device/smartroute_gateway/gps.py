"""GPS sources: NMEA serial receiver (e.g. u-blox NEO-6M), simulated route, or none.

The NMEA parser is deliberately small: it validates the checksum and reads
``RMC`` (validity, position, speed, course) and ``GGA`` (fix quality,
satellites, HDOP, position) from any talker (``GP``, ``GN``, ``GL``...).
"""
from __future__ import annotations

import abc
import logging
import math
import threading
import time
from dataclasses import dataclass
from typing import Callable, List, Optional, Sequence, Tuple, Union

from .engine import GeoPoint, distance_m

log = logging.getLogger(__name__)

KNOTS_TO_KMH = 1.852


@dataclass(frozen=True)
class GpsFix:
    lat: float
    lng: float
    speed_kmh: Optional[float]
    heading: Optional[float]
    #: GGA fix quality (1 = GPS, 2 = DGPS ...); 1 when only RMC has been seen.
    fix_quality: int
    satellites: Optional[int]
    hdop: Optional[float]
    #: Local clock (epoch seconds) when the fix was received.
    received_at: float

    def point(self) -> GeoPoint:
        return GeoPoint(self.lat, self.lng)


# ------------------------------------------------------------------ NMEA


def nmea_checksum_ok(sentence: str) -> bool:
    """``$<body>*HH`` where HH is the XOR of every body character, in hex."""
    text = sentence.strip()
    if not text.startswith("$") or "*" not in text:
        return False
    body, _, given = text[1:].rpartition("*")
    if len(given) != 2:
        return False
    calc = 0
    for ch in body:
        calc ^= ord(ch)
    try:
        return calc == int(given, 16)
    except ValueError:
        return False


def _coordinate(value: str, hemisphere: str, limit: float) -> Optional[float]:
    """NMEA ``(d)ddmm.mmmm`` + N/S/E/W -> signed decimal degrees."""
    if not value or hemisphere not in ("N", "S", "E", "W"):
        return None
    dot = value.find(".")
    split = (dot if dot >= 0 else len(value)) - 2  # minutes are always the 2 digits before the dot
    if split < 1:
        return None
    try:
        degrees = int(value[:split])
        minutes = float(value[split:])
    except ValueError:
        return None
    if minutes >= 60:
        return None
    result = degrees + minutes / 60
    if result > limit:
        return None
    return -result if hemisphere in ("S", "W") else result


def _float(value: str) -> Optional[float]:
    try:
        return float(value) if value else None
    except ValueError:
        return None


def _int(value: str) -> Optional[int]:
    try:
        return int(value) if value else None
    except ValueError:
        return None


@dataclass(frozen=True)
class RmcSentence:
    valid: bool
    lat: Optional[float]
    lng: Optional[float]
    speed_kmh: Optional[float]
    heading: Optional[float]


@dataclass(frozen=True)
class GgaSentence:
    quality: int
    lat: Optional[float]
    lng: Optional[float]
    satellites: Optional[int]
    hdop: Optional[float]


def parse_sentence(line: str) -> Optional[Union[RmcSentence, GgaSentence]]:
    """Parse one RMC/GGA sentence; None for anything else or a bad checksum."""
    if not nmea_checksum_ok(line):
        return None
    fields = line.strip()[1:].rpartition("*")[0].split(",")
    kind = fields[0]
    if len(kind) != 5 or not kind[:2].isalpha():
        return None
    if kind[2:] == "RMC" and len(fields) >= 10:
        # $xxRMC,time,status,lat,N,lon,E,knots,course,date[,magvar,E[,mode]]
        lat = _coordinate(fields[3], fields[4], 90)
        lng = _coordinate(fields[5], fields[6], 180)
        mode_ok = len(fields) < 13 or fields[12][:1] != "N"  # NMEA 2.3 mode "N" = data not valid
        knots = _float(fields[7])
        return RmcSentence(
            valid=fields[2] == "A" and mode_ok and lat is not None and lng is not None,
            lat=lat,
            lng=lng,
            speed_kmh=knots * KNOTS_TO_KMH if knots is not None else None,
            heading=_float(fields[8]),
        )
    if kind[2:] == "GGA" and len(fields) >= 9:
        # $xxGGA,time,lat,N,lon,E,quality,sats,hdop,alt,M,...
        return GgaSentence(
            quality=_int(fields[6]) or 0,
            lat=_coordinate(fields[2], fields[3], 90),
            lng=_coordinate(fields[4], fields[5], 180),
            satellites=_int(fields[7]),
            hdop=_float(fields[8]),
        )
    return None


class NmeaParser:
    """Merges RMC and GGA sentences into the current fix (``self.fix``).

    A void RMC (status ``V``) or a GGA with quality 0 clears the fix.
    """

    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self._clock = clock
        self.fix: Optional[GpsFix] = None
        self._rmc: Optional[RmcSentence] = None
        self._gga: Optional[GgaSentence] = None

    def feed(self, line: str) -> None:
        sentence = parse_sentence(line)
        if isinstance(sentence, RmcSentence):
            self._rmc = sentence
            if not sentence.valid or sentence.lat is None or sentence.lng is None:
                self.fix = None
                return
            gga = self._gga if self._gga and self._gga.quality > 0 else None
            self.fix = GpsFix(
                sentence.lat,
                sentence.lng,
                sentence.speed_kmh,
                sentence.heading,
                gga.quality if gga else 1,
                gga.satellites if gga else None,
                gga.hdop if gga else None,
                self._clock(),
            )
        elif isinstance(sentence, GgaSentence):
            self._gga = sentence
            if sentence.quality <= 0 or sentence.lat is None or sentence.lng is None:
                self.fix = None
                return
            rmc = self._rmc if self._rmc and self._rmc.valid else None
            self.fix = GpsFix(
                sentence.lat,
                sentence.lng,
                rmc.speed_kmh if rmc else None,
                rmc.heading if rmc else None,
                sentence.quality,
                sentence.satellites,
                sentence.hdop,
                self._clock(),
            )


# --------------------------------------------------------------- sources


class GpsSource(abc.ABC):
    #: ``vehicles/{id}.location.source`` for fixes from this source.
    source = "gps_module"

    def start(self) -> None:
        """Begin acquiring fixes (no-op by default)."""

    def stop(self) -> None:
        """Release the device (no-op by default)."""

    @abc.abstractmethod
    def current_fix(self) -> Optional[GpsFix]:
        """The latest fix, or None if there is no (fresh) fix."""


class NoGps(GpsSource):
    """No GPS fitted: every removal during a route counts as unauthorized."""

    def current_fix(self) -> Optional[GpsFix]:
        return None


class NmeaGps(GpsSource):
    """Reads NMEA from a serial port on a background thread (reopens on errors)."""

    def __init__(self, port: str, baud: int, max_fix_age_s: float, clock: Callable[[], float] = time.time) -> None:
        self._port = port
        self._baud = baud
        self._max_age = max_fix_age_s
        self._clock = clock
        self._parser = NmeaParser(clock)
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="gps", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3)

    def current_fix(self) -> Optional[GpsFix]:
        with self._lock:
            fix = self._parser.fix
        if fix is None or self._clock() - fix.received_at > self._max_age:
            return None
        return fix

    def _run(self) -> None:
        import serial  # pyserial; imported here so the parser works without it

        had_fix = False
        while not self._stop.is_set():
            try:
                with serial.Serial(self._port, self._baud, timeout=1, exclusive=True) as port:
                    log.info("GPS: reading NMEA from %s @ %d baud", self._port, self._baud)
                    buffer = b""
                    while not self._stop.is_set():
                        buffer += port.read(port.in_waiting or 1)
                        *lines, buffer = buffer.split(b"\n")
                        for raw in lines:
                            with self._lock:
                                self._parser.feed(raw.decode("ascii", errors="replace"))
                        has_fix = self.current_fix() is not None
                        if has_fix != had_fix:
                            log.info("GPS: %s", "fix acquired" if has_fix else "fix lost")
                            had_fix = has_fix
                        if len(buffer) > 4096:  # not NMEA (wrong baud rate?) - don't grow forever
                            buffer = b""
            except (OSError, ValueError) as err:  # serial.SerialException is an OSError
                log.warning("GPS: %s unavailable (%s); retrying in 5 s", self._port, err)
                self._stop.wait(5)


def bearing_deg(a: GeoPoint, b: GeoPoint) -> float:
    """Initial great-circle bearing a -> b, degrees clockwise from north."""
    lat1, lat2 = math.radians(a.lat), math.radians(b.lat)
    d_lng = math.radians(b.lng - a.lng)
    y = math.sin(d_lng) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(d_lng)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


class SimulatedGps(GpsSource):
    """Drives along ``waypoints`` at a constant speed, then parks at the last one."""

    source = "simulator"

    def __init__(self, waypoints: Sequence[Tuple[float, float]], speed_kmh: float, clock: Callable[[], float] = time.time) -> None:
        if not waypoints:
            raise ValueError("SimulatedGps needs at least one waypoint")
        self._points = [GeoPoint(lat, lng) for lat, lng in waypoints]
        self._legs: List[Tuple[GeoPoint, GeoPoint, float]] = [
            (a, b, distance_m(a, b)) for a, b in zip(self._points, self._points[1:])
        ]
        self._speed_kmh = speed_kmh
        self._clock = clock
        self._started: Optional[float] = None

    def start(self) -> None:
        self._started = self._clock()

    def current_fix(self) -> Optional[GpsFix]:
        now = self._clock()
        if self._started is None:
            self._started = now
        remaining = (now - self._started) * self._speed_kmh / 3.6
        for a, b, length in self._legs:
            if remaining <= length:
                f = remaining / length if length else 1.0
                lat = a.lat + (b.lat - a.lat) * f
                lng = a.lng + (b.lng - a.lng) * f
                return GpsFix(lat, lng, self._speed_kmh, bearing_deg(a, b), 1, None, None, now)
            remaining -= length
        last = self._points[-1]
        return GpsFix(last.lat, last.lng, 0.0, None, 1, None, None, now)
