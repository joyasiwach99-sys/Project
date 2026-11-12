"""Line-mode EPC extraction and the simulated reader's controls."""
from __future__ import annotations

import io
import random

import pytest

from smartroute_gateway.readers.base import ReaderError
from smartroute_gateway.readers.lines import LinesReader, epc_pattern, extract_epcs
from smartroute_gateway.readers.simulated import SimulatedReader

EPC = "E28011700000020A1B2C3D4E"
PATTERN = epc_pattern(12)


@pytest.mark.parametrize(
    "line",
    [
        EPC,
        EPC.lower() + "\r\n",
        "E2 80 11 70 00 00 02 0A 1B 2C 3D 4E",
        "E2:80:11:70:00:00:02:0A:1B:2C:3D:4E",
        f"EPC: {EPC}",
        f"ANT1,{EPC},-61",
        f"[12:30:45] tag {EPC} rssi -55",
    ],
)
def test_extracts_epcs_from_common_line_formats(line: str) -> None:
    assert extract_epcs(line, PATTERN) == [EPC]


@pytest.mark.parametrize("line", ["", "12:30:45", "E28011700000020A1B2C3D", "reader ready", "E28011700000020A1B2C3D4"])
def test_ignores_lines_without_a_full_epc(line: str) -> None:
    assert extract_epcs(line, PATTERN) == []


@pytest.mark.parametrize("separator", [" ", ",", " | ", "\t"])
def test_several_epcs_on_one_line(separator: str) -> None:
    other = "E28011700000020000000002"
    assert extract_epcs(f"{EPC}{separator}{other}", PATTERN) == [EPC, other]


def test_lines_reader_drains_what_arrived_since_the_last_round() -> None:
    reader = LinesReader("-", 9600)
    reader.feed_line(f"{EPC}\n")
    reader.feed_line("noise\n")
    reader.feed_line(f"{EPC}\n")
    assert reader.inventory() == [EPC, EPC]
    assert reader.inventory() == []


def test_simulated_reader_commands() -> None:
    reader = SimulatedReader(console=io.StringIO())
    assert reader.handle_command(f"+{EPC} +E28011700000020000000002") == "2 tag(s) in field"
    assert reader.handle_command("list").splitlines() == ["E28011700000020000000002", EPC]
    assert reader.handle_command(f"-{EPC.lower()}") == "1 tag(s) in field"
    assert reader.handle_command("clear") == "field cleared"
    assert reader.handle_command("list") == "(no tags in field)"
    assert "commands:" in reader.handle_command("help")
    assert reader.handle_command("   ") == ""


def test_simulated_reader_offline_and_read_misses() -> None:
    reader = SimulatedReader([EPC], miss_probability=0.5, rng=random.Random(7))
    reads = [len(reader.inventory()) for _ in range(200)]
    assert 60 < sum(reads) < 140  # roughly half the rounds miss the tag
    reader.handle_command("offline")
    with pytest.raises(ReaderError):
        reader.inventory()
    reader.handle_command("online")
    assert reader.inventory() in ([EPC], [])
