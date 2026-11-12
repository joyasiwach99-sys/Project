"""CHAFON-style framing: CRC-16/MCRF4XX, frame decoder, inventory parsing, and
ChafonReader against a fake serial port. (Protocol shape only - the real CF591
command set still has to be verified against CHAFON's manual.)"""
from __future__ import annotations

from typing import List, Optional

import pytest

from smartroute_gateway.readers.base import ReaderError
from smartroute_gateway.readers.chafon import (
    ChafonCommands,
    ChafonReader,
    FrameDecoder,
    MalformedFrame,
    ResponseFrame,
    ResponseLayout,
    build_frame,
    crc16_mcrf4xx,
    parse_inventory,
)

EPC_A = bytes.fromhex("E28011700000020000000001")
EPC_B = bytes.fromhex("E28011700000020000000002")


def response(cmd: int, status: int, data: bytes = b"", address: int = 0x00) -> bytes:
    """Len | Adr | Cmd | Status | Data | CRC (a response is a frame whose data starts with Status)."""
    return build_frame(address, cmd, bytes([status]) + data)


def tag_list(*epcs: bytes, antenna: Optional[int] = None, rssi: Optional[int] = None) -> bytes:
    out = bytes([antenna]) if antenna is not None else b""
    out += bytes([len(epcs)])
    for e in epcs:
        out += bytes([len(e)]) + e + (bytes([rssi]) if rssi is not None else b"")
    return out


# ---------------------------------------------------------------------- CRC


def test_crc16_mcrf4xx_check_value() -> None:
    assert crc16_mcrf4xx(b"123456789") == 0x6F91


def test_crc_of_empty_input_is_the_init_value() -> None:
    assert crc16_mcrf4xx(b"") == 0xFFFF


def test_build_frame_layout_and_crc_byte_order() -> None:
    frame = build_frame(0xFF, 0x01)
    assert frame[:3] == bytes([0x04, 0xFF, 0x01])  # Len counts Adr + Cmd + 2 CRC bytes
    crc = crc16_mcrf4xx(frame[:3])
    assert frame[3:] == bytes([crc & 0xFF, crc >> 8])  # LSB first
    with_data = build_frame(0x00, 0x2F, bytes([20]))
    assert with_data[0] == 5 and len(with_data) == 6


def test_a_frame_crc_over_everything_including_crc_is_zero() -> None:
    # Property of reflected CRCs without final XOR: appending the CRC LSB-first
    # makes the CRC of the whole frame 0 - a handy sanity check on byte order.
    assert crc16_mcrf4xx(build_frame(0x00, 0x01, b"\x10\x20")) == 0


# ------------------------------------------------------------------ decoder


def test_decoder_reassembles_split_frames() -> None:
    raw = response(0x01, 0x01, tag_list(EPC_A))
    dec = FrameDecoder()
    assert dec.feed(raw[:5]) == []
    (frame,) = dec.feed(raw[5:])
    assert frame == ResponseFrame(0x00, 0x01, 0x01, tag_list(EPC_A))


def test_decoder_skips_garbage_and_bad_crc_frames() -> None:
    good = response(0x01, 0x01, tag_list(EPC_A))
    corrupted = bytearray(response(0x01, 0x01, tag_list(EPC_B)))
    corrupted[6] ^= 0xFF
    stream = b"\x00\xf0\x13garbage" + bytes(corrupted) + good + response(0x21, 0x00, b"\x01\x02")
    frames = FrameDecoder().feed(stream)
    assert [(f.command, f.data) for f in frames] == [(0x01, tag_list(EPC_A)), (0x21, b"\x01\x02")]


def test_decoder_does_not_wait_forever_on_a_bogus_length_byte() -> None:
    # 0xF0 looks like the start of a 240-byte frame; a real frame follows it.
    frames = FrameDecoder().feed(b"\xf0" + response(0x01, 0xFB))
    assert [(f.command, f.status) for f in frames] == [(0x01, 0xFB)]


# ------------------------------------------------------------ inventory data


def test_parse_inventory_default_layout() -> None:
    assert parse_inventory(tag_list(EPC_A, EPC_B), ResponseLayout()) == [EPC_A.hex().upper(), EPC_B.hex().upper()]
    assert parse_inventory(tag_list(), ResponseLayout()) == []


def test_parse_inventory_with_antenna_and_rssi_bytes() -> None:
    layout = ResponseLayout(antenna_byte=True, rssi_byte=True)
    assert parse_inventory(tag_list(EPC_A, EPC_B, antenna=1, rssi=0x45), layout) == [EPC_A.hex().upper(), EPC_B.hex().upper()]


@pytest.mark.parametrize(
    "data",
    [
        b"",  # no count
        bytes([2, 12]) + EPC_A,  # says 2 tags, has 1
        bytes([1, 0]),  # zero-length EPC
        bytes([1, 63]) + bytes(63),  # longer than EPC Gen2 allows
        bytes([1, 12]) + EPC_A[:6],  # truncated EPC
        tag_list(EPC_A) + b"\x00",  # trailing junk (e.g. layout misconfigured)
    ],
)
def test_parse_inventory_rejects_malformed_data(data: bytes) -> None:
    with pytest.raises(MalformedFrame):
        parse_inventory(data, ResponseLayout())


def test_wrong_layout_is_detected_rather_than_producing_garbage() -> None:
    with pytest.raises(MalformedFrame):
        parse_inventory(tag_list(EPC_A, rssi=0x40), ResponseLayout())


# ---------------------------------------------------------------- reader


class FakeSerial:
    """Answers each written command with the next scripted chunk(s)."""

    def __init__(self, answers: List[bytes]) -> None:
        self.answers = answers
        self.written: List[bytes] = []
        self._rx = b""
        self.closed = False

    @property
    def in_waiting(self) -> int:
        return len(self._rx)

    def read(self, size: int = 1) -> bytes:
        out, self._rx = self._rx[:size], self._rx[size:]
        return out

    def write(self, data: bytes) -> int:
        self.written.append(data)
        if self.answers:
            self._rx += self.answers.pop(0)
        return len(data)

    def reset_input_buffer(self) -> None:
        self._rx = b""

    def close(self) -> None:
        self.closed = True


def make_reader(port: FakeSerial, **kwargs: object) -> ChafonReader:
    reader = ChafonReader("/dev/fake", 57600, response_timeout_s=0.05, serial_factory=lambda: port, **kwargs)  # type: ignore[arg-type]
    reader.open()
    return reader


def test_inventory_sends_the_configured_command_and_returns_epcs() -> None:
    port = FakeSerial([response(0x01, 0x01, tag_list(EPC_A, EPC_B))])
    reader = make_reader(port, address=0x00)
    assert reader.inventory() == [EPC_A.hex().upper(), EPC_B.hex().upper()]
    assert port.written == [build_frame(0x00, 0x01)]


def test_inventory_follows_more_data_frames() -> None:
    port = FakeSerial([response(0x01, 0x03, tag_list(EPC_A)) + response(0x01, 0x01, tag_list(EPC_B))])
    assert make_reader(port).inventory() == [EPC_A.hex().upper(), EPC_B.hex().upper()]


def test_no_tag_status_is_an_empty_round_not_an_error() -> None:
    port = FakeSerial([response(0x01, 0xFB)])
    assert make_reader(port).inventory() == []


def test_malformed_inventory_frames_are_ignored() -> None:
    port = FakeSerial([response(0x01, 0x01, bytes([3, 12]) + EPC_A)])
    assert make_reader(port).inventory() == []


def test_stale_answers_to_other_commands_and_other_addresses_are_ignored() -> None:
    port = FakeSerial([response(0x21, 0x00, b"\x01") + response(0x01, 0x01, tag_list(EPC_B), address=0x05) + response(0x01, 0x01, tag_list(EPC_A), address=0x00)])
    assert make_reader(port, address=0x00).inventory() == [EPC_A.hex().upper()]


def test_silence_raises_reader_error() -> None:
    port = FakeSerial([])
    with pytest.raises(ReaderError, match="no valid answer"):
        make_reader(port).inventory()


def test_custom_inventory_command_and_data() -> None:
    port = FakeSerial([response(0x18, 0x01, tag_list(EPC_A))])
    reader = make_reader(port, commands=ChafonCommands(inventory=0x18, inventory_data=b"\x04\x00"))
    assert reader.inventory() == [EPC_A.hex().upper()]
    assert port.written == [build_frame(0xFF, 0x18, b"\x04\x00")]


def test_tx_power_is_sent_on_open_only_when_configured() -> None:
    port = FakeSerial([response(0x2F, 0x00)])
    make_reader(port, tx_power_dbm=20)
    assert port.written == [build_frame(0xFF, 0x2F, bytes([20]))]
    quiet = FakeSerial([])
    make_reader(quiet)
    assert quiet.written == []


def test_unopenable_port_raises_reader_error() -> None:
    def fail() -> FakeSerial:
        raise OSError("No such file or directory: '/dev/ttyUSB0'")

    reader = ChafonReader("/dev/ttyUSB0", 57600, serial_factory=fail)
    with pytest.raises(ReaderError, match="cannot open"):
        reader.open()
    assert not reader.is_open
