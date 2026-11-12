"""config.example.json loads, and bad configs fail with a message naming the key."""
from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any, Dict

import pytest

from smartroute_gateway.config import ConfigError, load_config, parse_config

EXAMPLE = Path(__file__).resolve().parents[1] / "config.example.json"


def example() -> Dict[str, Any]:
    return json.loads(EXAMPLE.read_text())


def test_example_config_loads_with_the_documented_defaults() -> None:
    cfg = load_config(EXAMPLE)
    assert (cfg.firebase.project_id, cfg.device.vehicle_id, cfg.device.device_id) == ("project-e0bb4", "VAN-01", "RDR-01")
    assert cfg.reader.backend == "chafon"
    assert (cfg.reader.commands.inventory, cfg.reader.commands.get_info, cfg.reader.commands.set_power) == (0x01, 0x21, 0x2F)
    assert cfg.reader.address == 0xFF
    assert cfg.reader.tx_power_dbm is None
    assert (cfg.engine.absence_timeout_sec, cfg.engine.geofence_m) == (6, 150)
    assert (cfg.heartbeat_sec, cfg.parcel_refresh_sec, cfg.route_refresh_sec) == (15, 30, 10)
    assert cfg.queue_path == EXAMPLE.parent / "outbox.sqlite"  # relative to the config file
    assert len(cfg.gps.simulated_waypoints) == 3


def test_simulated_overrides_reader_and_gps() -> None:
    cfg = load_config(EXAMPLE).simulated()
    assert (cfg.reader.backend, cfg.gps.backend) == ("simulated", "simulated")


@pytest.mark.parametrize("value, expected", [("0x2F", 0x2F), ("2f", 0x2F), (47, 47), ("01", 1)])
def test_command_bytes_accept_hex_strings_and_numbers(value: Any, expected: int) -> None:
    raw = example()
    raw["reader"]["commands"]["setPower"] = value
    assert parse_config(raw, EXAMPLE.parent).reader.commands.set_power == expected


def test_optional_commands_can_be_disabled() -> None:
    raw = example()
    raw["reader"]["commands"]["getInfo"] = None
    raw["reader"]["commands"]["inventoryData"] = "04 00"
    cmds = parse_config(raw, EXAMPLE.parent).reader.commands
    assert (cmds.get_info, cmds.inventory_data) == (None, b"\x04\x00")


@pytest.mark.parametrize(
    "mutate, message",
    [
        (lambda c: c["reader"].update(backend="rfid9000"), "reader.backend must be one of"),
        (lambda c: c["device"].pop("email"), "device.email is required"),
        (lambda c: c["reader"]["commands"].update(inventory="0x1FF"), "reader.commands.inventory must be a byte"),
        (lambda c: c["engine"].update(absenceTimeoutSec="6"), "engine.absenceTimeoutSec must be a number"),
        (lambda c: c["reader"].update(txPowerDbm=99), "reader.txPowerDbm must be between"),
        (lambda c: c["gps"].update(backend="simulated") or c["gps"]["simulated"].update(waypoints=[]), "waypoints"),
        (lambda c: c["gps"]["simulated"].update(waypoints=[[200, 1]]), "lat, lng"),
        (lambda c: c.update(firebase="nope"), "firebase must be a JSON object"),
    ],
)
def test_invalid_configs_are_rejected(mutate: Any, message: str) -> None:
    raw = copy.deepcopy(example())
    mutate(raw)
    with pytest.raises(ConfigError, match=message):
        parse_config(raw, EXAMPLE.parent)


def test_missing_or_broken_file(tmp_path: Path) -> None:
    with pytest.raises(ConfigError, match="not found"):
        load_config(tmp_path / "config.json")
    bad = tmp_path / "bad.json"
    bad.write_text("{nope")
    with pytest.raises(ConfigError, match="not valid JSON"):
        load_config(bad)
