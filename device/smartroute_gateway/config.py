"""Load and validate ``config.json`` (see ``config.example.json``)."""
from __future__ import annotations

import dataclasses
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

from .readers.chafon import ChafonCommands, ResponseLayout

PLACEHOLDER_PASSWORD = "CHANGE_ME"
READER_BACKENDS = ("chafon", "lines", "simulated")
GPS_BACKENDS = ("nmea", "simulated", "none")


class ConfigError(ValueError):
    pass


@dataclass(frozen=True)
class FirebaseSettings:
    api_key: str
    project_id: str


@dataclass(frozen=True)
class DeviceSettings:
    email: str
    password: str
    device_id: str
    vehicle_id: str


@dataclass(frozen=True)
class ReaderSettings:
    backend: str
    port: str
    baud: int
    address: int
    inventory_interval_ms: int
    response_timeout_ms: int
    tx_power_dbm: Optional[int]
    commands: ChafonCommands
    layout: ResponseLayout
    min_epc_bytes: int
    simulated_tags: Tuple[str, ...]
    miss_probability: float


@dataclass(frozen=True)
class GpsSettings:
    backend: str
    port: str
    baud: int
    max_fix_age_s: float
    simulated_waypoints: Tuple[Tuple[float, float], ...]
    simulated_speed_kmh: float


@dataclass(frozen=True)
class EngineSettings:
    absence_timeout_sec: float
    geofence_m: float


@dataclass(frozen=True)
class Config:
    firebase: FirebaseSettings
    device: DeviceSettings
    reader: ReaderSettings
    gps: GpsSettings
    engine: EngineSettings
    heartbeat_sec: float
    parcel_refresh_sec: float
    route_refresh_sec: float
    queue_path: Path

    def simulated(self) -> "Config":
        """Same config with the simulated reader and simulated GPS (``--simulate``)."""
        return dataclasses.replace(
            self,
            reader=dataclasses.replace(self.reader, backend="simulated"),
            gps=dataclasses.replace(self.gps, backend="simulated"),
        )


_MISSING = object()


class _Section:
    """Typed accessors over one JSON object, with error messages that name the key."""

    def __init__(self, data: Any, path: str) -> None:
        if not isinstance(data, dict):
            raise ConfigError(f"{path or 'config'} must be a JSON object")
        self._data: Dict[str, Any] = data
        self._path = path

    def _name(self, key: str) -> str:
        return f"{self._path}.{key}" if self._path else key

    def _get(self, key: str, default: Any) -> Any:
        if key in self._data:
            return self._data[key]
        if default is _MISSING:
            raise ConfigError(f"{self._name(key)} is required")
        return default

    def section(self, key: str, required: bool = True) -> "_Section":
        return _Section(self._get(key, _MISSING if required else {}), self._name(key))

    def text(self, key: str, default: Any = _MISSING) -> str:
        value = self._get(key, default)
        if not isinstance(value, str) or not value.strip():
            raise ConfigError(f"{self._name(key)} must be a non-empty string")
        return value.strip()

    def number(self, key: str, default: Any = _MISSING, minimum: Optional[float] = None, maximum: Optional[float] = None) -> float:
        value = self._get(key, default)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ConfigError(f"{self._name(key)} must be a number")
        if (minimum is not None and value < minimum) or (maximum is not None and value > maximum):
            raise ConfigError(f"{self._name(key)} must be between {minimum} and {maximum}")
        return float(value)

    def integer(self, key: str, default: Any = _MISSING, minimum: Optional[int] = None, maximum: Optional[int] = None) -> int:
        value = self.number(key, default, minimum, maximum)
        if value != int(value):
            raise ConfigError(f"{self._name(key)} must be a whole number")
        return int(value)

    def optional_integer(self, key: str, minimum: int, maximum: int) -> Optional[int]:
        return None if self._data.get(key) is None else self.integer(key, minimum=minimum, maximum=maximum)

    def byte(self, key: str, default: Any = _MISSING) -> int:
        """A byte given as a number or a hex string such as ``"0x01"`` / ``"2F"``."""
        value = self._get(key, default)
        try:
            number = int(value, 16) if isinstance(value, str) else value
        except ValueError:
            number = None
        if isinstance(number, bool) or not isinstance(number, int) or not 0 <= number <= 0xFF:
            raise ConfigError(f"{self._name(key)} must be a byte, e.g. \"0x01\"")
        return number

    def optional_byte(self, key: str, default: Optional[int]) -> Optional[int]:
        if key in self._data and self._data[key] is None:
            return None
        return self.byte(key, default)

    def hex_bytes(self, key: str) -> bytes:
        value = self._get(key, "")
        if not isinstance(value, str):
            raise ConfigError(f"{self._name(key)} must be a hex string such as \"04 00\"")
        try:
            return bytes.fromhex(value.replace("0x", "").replace(",", " "))
        except ValueError as err:
            raise ConfigError(f"{self._name(key)}: {err}") from err

    def boolean(self, key: str, default: bool) -> bool:
        value = self._get(key, default)
        if not isinstance(value, bool):
            raise ConfigError(f"{self._name(key)} must be true or false")
        return value

    def choice(self, key: str, options: Sequence[str], default: Any = _MISSING) -> str:
        value = self.text(key, default)
        if value not in options:
            raise ConfigError(f"{self._name(key)} must be one of {', '.join(options)}")
        return value

    def string_list(self, key: str) -> Tuple[str, ...]:
        value = self._get(key, [])
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
            raise ConfigError(f"{self._name(key)} must be a list of strings")
        return tuple(value)

    def waypoints(self, key: str) -> Tuple[Tuple[float, float], ...]:
        value = self._get(key, [])
        error = ConfigError(f"{self._name(key)} must be a list of [lat, lng] pairs")
        if not isinstance(value, list):
            raise error
        points: List[Tuple[float, float]] = []
        for item in value:
            if (
                not isinstance(item, list)
                or len(item) != 2
                or not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in item)
                or not (-90 <= item[0] <= 90 and -180 <= item[1] <= 180)
            ):
                raise error
            points.append((float(item[0]), float(item[1])))
        return tuple(points)


def parse_config(raw: Any, base_dir: Path) -> Config:
    root = _Section(raw, "")
    fb = root.section("firebase")
    dev = root.section("device")
    rd = root.section("reader")
    cmds = rd.section("commands", required=False)
    layout = rd.section("responseLayout", required=False)
    sim_reader = rd.section("simulated", required=False)
    gps = root.section("gps", required=False)
    sim_gps = gps.section("simulated", required=False)
    eng = root.section("engine", required=False)

    gps_settings = GpsSettings(
        backend=gps.choice("backend", GPS_BACKENDS, "none"),
        port=gps.text("port", "/dev/serial0"),
        baud=gps.integer("baud", 9600, minimum=1200),
        max_fix_age_s=gps.number("maxFixAgeSec", 5, minimum=1),
        simulated_waypoints=sim_gps.waypoints("waypoints"),
        simulated_speed_kmh=sim_gps.number("speedKmh", 25, minimum=0, maximum=200),
    )
    if gps_settings.backend == "simulated" and not gps_settings.simulated_waypoints:
        raise ConfigError("gps.simulated.waypoints needs at least one [lat, lng] pair for the simulated GPS")

    queue_path = Path(root.text("queuePath", "outbox.sqlite")).expanduser()
    return Config(
        firebase=FirebaseSettings(api_key=fb.text("apiKey"), project_id=fb.text("projectId")),
        device=DeviceSettings(
            email=dev.text("email"),
            password=dev.text("password"),
            device_id=dev.text("deviceId"),
            vehicle_id=dev.text("vehicleId"),
        ),
        reader=ReaderSettings(
            backend=rd.choice("backend", READER_BACKENDS),
            port=rd.text("port", "/dev/ttyUSB0"),
            baud=rd.integer("baud", 57600, minimum=1200),
            address=rd.byte("address", 0xFF),
            inventory_interval_ms=rd.integer("inventoryIntervalMs", 1000, minimum=100, maximum=10_000),
            response_timeout_ms=rd.integer("responseTimeoutMs", 1000, minimum=50, maximum=10_000),
            tx_power_dbm=rd.optional_integer("txPowerDbm", minimum=0, maximum=33),
            commands=ChafonCommands(
                inventory=cmds.byte("inventory", 0x01),
                inventory_data=cmds.hex_bytes("inventoryData"),
                get_info=cmds.optional_byte("getInfo", 0x21),
                set_power=cmds.optional_byte("setPower", 0x2F),
            ),
            layout=ResponseLayout(
                antenna_byte=layout.boolean("antennaByte", False),
                rssi_byte=layout.boolean("rssiByte", False),
            ),
            min_epc_bytes=rd.integer("minEpcBytes", 12, minimum=2, maximum=62),
            simulated_tags=sim_reader.string_list("tags"),
            miss_probability=sim_reader.number("missProbability", 0.0, minimum=0, maximum=0.9),
        ),
        gps=gps_settings,
        engine=EngineSettings(
            absence_timeout_sec=eng.number("absenceTimeoutSec", 6, minimum=1, maximum=600),
            geofence_m=eng.number("geofenceM", 150, minimum=10, maximum=5000),
        ),
        heartbeat_sec=root.number("heartbeatSec", 15, minimum=5),
        parcel_refresh_sec=root.number("parcelRefreshSec", 30, minimum=5),
        route_refresh_sec=root.number("routeRefreshSec", 10, minimum=2),
        queue_path=queue_path if queue_path.is_absolute() else base_dir / queue_path,
    )


def load_config(path: Union[str, Path]) -> Config:
    path = Path(path)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ConfigError(f"{path} not found - copy config.example.json to config.json and edit it") from None
    except json.JSONDecodeError as err:
        raise ConfigError(f"{path} is not valid JSON: {err}") from None
    return parse_config(raw, path.resolve().parent)
