"""NMEA parsing (RMC/GGA, checksums, hemispheres, fix loss) and the simulated GPS."""
from __future__ import annotations

from functools import reduce

import pytest
from support import FakeClock

from smartroute_gateway.engine import GeoPoint, distance_m
from smartroute_gateway.gps import GgaSentence, NmeaParser, RmcSentence, SimulatedGps, bearing_deg, nmea_checksum_ok, parse_sentence

# Textbook examples (checksums as published).
RMC = "$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A"
GGA = "$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47"


def sentence(body: str) -> str:
    return f"${body}*{reduce(lambda acc, ch: acc ^ ord(ch), body, 0):02X}"


def test_checksum_validation() -> None:
    assert nmea_checksum_ok(RMC)
    assert nmea_checksum_ok(GGA + "\r\n")
    assert not nmea_checksum_ok(RMC.replace("*6A", "*6B"))
    assert not nmea_checksum_ok(RMC.split("*")[0])  # no checksum at all
    assert not nmea_checksum_ok("GPRMC,123519*6A")  # no leading $
    assert not nmea_checksum_ok("$GPRMC*ZZ")


def test_parse_rmc() -> None:
    s = parse_sentence(RMC)
    assert isinstance(s, RmcSentence)
    assert s.valid
    assert s.lat == pytest.approx(48 + 7.038 / 60)
    assert s.lng == pytest.approx(11 + 31.0 / 60)
    assert s.speed_kmh == pytest.approx(22.4 * 1.852)
    assert s.heading == pytest.approx(84.4)


def test_parse_gga() -> None:
    s = parse_sentence(GGA)
    assert isinstance(s, GgaSentence)
    assert (s.quality, s.satellites, s.hdop) == (1, 8, 0.9)
    assert s.lat == pytest.approx(48.1173)


def test_gn_talker_and_southern_western_hemispheres() -> None:
    s = parse_sentence(sentence("GNRMC,083559.00,A,3352.3000,S,15112.6000,W,0.0,,010126,,,A"))
    assert isinstance(s, RmcSentence)
    assert s.lat == pytest.approx(-(33 + 52.3 / 60))
    assert s.lng == pytest.approx(-(151 + 12.6 / 60))
    assert s.heading is None  # empty course while stationary


def test_indian_coordinates() -> None:
    s = parse_sentence(sentence("GNGGA,061500.00,2830.0660,N,07705.0280,E,2,11,0.8,215.0,M,-35.0,M,,"))
    assert isinstance(s, GgaSentence)
    assert (s.lat, s.lng, s.quality) == (pytest.approx(28.50110), pytest.approx(77.08380), 2)


@pytest.mark.parametrize(
    "line",
    [
        RMC.replace("*6A", "*00"),  # bad checksum
        sentence("GPGSV,3,1,11,03,03,111,00"),  # other sentence types are ignored
        sentence("GPRMC,123519,A"),  # too few fields
        "garbage",
        "",
    ],
)
def test_ignored_lines(line: str) -> None:
    assert parse_sentence(line) is None


def test_invalid_coordinates_make_rmc_invalid() -> None:
    s = parse_sentence(sentence("GPRMC,123519,A,4875.000,N,01131.000,E,0.0,0.0,230394,,"))  # 75 minutes
    assert isinstance(s, RmcSentence) and not s.valid


def test_parser_merges_rmc_and_gga() -> None:
    clock = FakeClock()
    parser = NmeaParser(clock)
    parser.feed(GGA)
    assert parser.fix is not None and parser.fix.speed_kmh is None  # GGA alone: position, no speed
    parser.feed(RMC)
    fix = parser.fix
    assert fix is not None
    assert (fix.fix_quality, fix.satellites, fix.hdop) == (1, 8, 0.9)
    assert fix.speed_kmh == pytest.approx(41.4848)
    assert fix.received_at == clock.now


def test_void_rmc_or_quality_zero_gga_clears_the_fix() -> None:
    parser = NmeaParser(FakeClock())
    parser.feed(RMC)
    assert parser.fix is not None
    parser.feed(sentence("GPRMC,123520,V,,,,,,,230394,,,N"))
    assert parser.fix is None
    parser.feed(GGA)
    assert parser.fix is not None
    parser.feed(sentence("GPGGA,123521,,,,,0,00,99.99,,,,,,"))
    assert parser.fix is None


def test_simulated_gps_drives_along_waypoints_and_parks() -> None:
    clock = FakeClock()
    a, b, c = (28.5011, 77.0838), (28.4950, 77.0890), (28.4683, 77.0645)
    gps = SimulatedGps([a, b, c], speed_kmh=36, clock=clock)  # 10 m/s
    gps.start()
    start = gps.current_fix()
    assert start is not None and (start.lat, start.lng) == a
    assert start.heading == pytest.approx(bearing_deg(GeoPoint(*a), GeoPoint(*b)))

    leg = distance_m(GeoPoint(*a), GeoPoint(*b))
    clock.advance(leg / 2 / 10)
    mid = gps.current_fix()
    assert mid is not None
    assert distance_m(GeoPoint(mid.lat, mid.lng), GeoPoint(*a)) == pytest.approx(leg / 2, rel=0.01)

    clock.advance(10_000)
    end = gps.current_fix()
    assert end is not None
    assert ((end.lat, end.lng), end.speed_kmh, end.heading) == (c, 0.0, None)


def test_single_waypoint_is_a_parked_vehicle() -> None:
    gps = SimulatedGps([(28.5, 77.0)], speed_kmh=30, clock=FakeClock())
    fix = gps.current_fix()
    assert fix is not None and (fix.lat, fix.lng, fix.speed_kmh) == (28.5, 77.0, 0.0)
    with pytest.raises(ValueError):
        SimulatedGps([], speed_kmh=30)


def test_bearing() -> None:
    assert bearing_deg(GeoPoint(0, 0), GeoPoint(1, 0)) == pytest.approx(0)
    assert bearing_deg(GeoPoint(0, 0), GeoPoint(0, 1)) == pytest.approx(90)
    assert bearing_deg(GeoPoint(0, 0), GeoPoint(-1, 0)) == pytest.approx(180)
