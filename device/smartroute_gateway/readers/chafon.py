"""CHAFON-style UHF reader serial protocol (command / response frames).

!!! NOT VERIFIED AGAINST A REAL CF591 !!!
This implements the frame format widely used by CHAFON UHF readers (the
"UHFReader18/288"-style protocol). The exact command set, status codes and
inventory response layout of *your* CF591 must be checked against the
protocol manual / SDK that CHAFON ships with the reader. Everything that
varies is configurable (``reader.commands``, ``reader.responseLayout``,
``reader.address``, ``reader.baud``). Bring-up procedure: README.md
"Bringing up the CF591".

Frame format (both directions)::

    Len | Adr | Cmd | Data... | CRC16-LSB | CRC16-MSB

* ``Len`` - number of bytes that follow ``Len`` (Adr + Cmd + Data + 2 CRC bytes)
* ``Adr`` - reader address (0xFF is commonly accepted as broadcast)
* CRC-16/MCRF4XX over ``Len..Data``: reflected poly 0x8408, init 0xFFFF,
  no final XOR (check value for b"123456789" is 0x6F91).

Responses carry a status byte after ``Cmd``::

    Len | Adr | Cmd | Status | Data... | CRC16-LSB | CRC16-MSB

Inventory response data (bytes after ``Status``)::

    [Ant] Num { EpcLen EPC[EpcLen] [RSSI] } x Num

``Ant`` and ``RSSI`` are present on some models only (``responseLayout``).
A status of ``MORE_FRAMES_STATUS`` means the tag list continues in another
frame.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Callable, List, Optional, Protocol, Tuple

from .base import Reader, ReaderError

log = logging.getLogger(__name__)

BROADCAST_ADDRESS = 0xFF
#: Status values that carry a tag list (from the UHFReader18-style manuals:
#: 0x01 done, 0x02 scan time overflow, 0x03 more frames follow, 0x04 buffer full).
TAG_DATA_STATUSES = frozenset({0x01, 0x02, 0x03, 0x04})
MORE_FRAMES_STATUS = 0x03
MAX_EPC_BYTES = 62  # EPC Gen2 allows up to 496 bits
_MIN_RESPONSE_LEN = 5  # Adr + Cmd + Status + 2 CRC bytes
_MAX_BUFFER = 1024


def crc16_mcrf4xx(data: bytes) -> int:
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ 0x8408 if crc & 1 else crc >> 1
    return crc


def build_frame(address: int, command: int, data: bytes = b"") -> bytes:
    if len(data) > 251:
        raise ValueError("frame data too long")
    body = bytes([len(data) + 4, address & 0xFF, command & 0xFF]) + data
    crc = crc16_mcrf4xx(body)
    return body + bytes([crc & 0xFF, crc >> 8])


@dataclass(frozen=True)
class ResponseFrame:
    address: int
    command: int
    status: int
    data: bytes


class FrameDecoder:
    """Reassembles response frames from a byte stream.

    Garbage, partial frames and frames with a bad CRC are skipped: the
    decoder looks for the earliest offset where a complete frame with a
    valid CRC starts.
    """

    def __init__(self) -> None:
        self._buf = bytearray()

    def reset(self) -> None:
        self._buf.clear()

    def feed(self, chunk: bytes) -> List[ResponseFrame]:
        self._buf += chunk
        frames: List[ResponseFrame] = []
        while True:
            span = self._next_frame()
            if span is None:
                break
            start, end = span
            raw = bytes(self._buf[start:end])
            del self._buf[:end]
            frames.append(ResponseFrame(raw[1], raw[2], raw[3], raw[4:-2]))
        if len(self._buf) > _MAX_BUFFER:
            del self._buf[:-_MAX_BUFFER]
        return frames

    def _next_frame(self) -> Optional[Tuple[int, int]]:
        buf = self._buf
        for start in range(len(buf)):
            length = buf[start]
            end = start + 1 + length
            if length < _MIN_RESPONSE_LEN or end > len(buf):
                continue
            if crc16_mcrf4xx(bytes(buf[start : end - 2])) == buf[end - 2] | (buf[end - 1] << 8):
                return start, end
        return None


@dataclass(frozen=True)
class ResponseLayout:
    #: Inventory data starts with an antenna byte before the tag count.
    antenna_byte: bool = False
    #: Every tag entry ends with an RSSI byte.
    rssi_byte: bool = False


class MalformedFrame(ValueError):
    pass


def parse_inventory(data: bytes, layout: ResponseLayout) -> List[str]:
    """Decode the tag list of an inventory response (the bytes after Status).

    Bounds-checked; raises MalformedFrame if the counts and lengths don't
    add up exactly, so a misconfigured layout never yields garbage EPCs.
    """
    pos = 1 if layout.antenna_byte else 0
    if len(data) < pos + 1:
        raise MalformedFrame("too short for the tag count")
    count = data[pos]
    pos += 1
    trailer = 1 if layout.rssi_byte else 0
    epcs: List[str] = []
    for i in range(1, count + 1):
        if pos >= len(data):
            raise MalformedFrame(f"tag {i}/{count}: missing EPC length")
        length = data[pos]
        pos += 1
        if not 1 <= length <= MAX_EPC_BYTES:
            raise MalformedFrame(f"tag {i}/{count}: implausible EPC length {length}")
        if pos + length + trailer > len(data):
            raise MalformedFrame(f"tag {i}/{count}: truncated")
        epcs.append(data[pos : pos + length].hex().upper())
        pos += length + trailer
    if pos != len(data):
        raise MalformedFrame(f"{len(data) - pos} unexpected trailing byte(s)")
    return epcs


@dataclass(frozen=True)
class ChafonCommands:
    inventory: int = 0x01
    #: Extra bytes sent with the inventory command (model-specific; empty by default).
    inventory_data: bytes = b""
    #: "Get reader information" - used by ``tools.scan --info`` (None to disable).
    get_info: Optional[int] = 0x21
    #: "Set RF power" (data = one byte, dBm) - only sent when txPowerDbm is set.
    set_power: Optional[int] = 0x2F


class SerialPort(Protocol):
    """The part of ``serial.Serial`` we use (lets tests inject a fake)."""

    @property
    def in_waiting(self) -> int: ...

    def read(self, size: int = 1) -> bytes: ...

    def write(self, data: bytes) -> Optional[int]: ...

    def reset_input_buffer(self) -> None: ...

    def close(self) -> None: ...


class ChafonReader(Reader):
    def __init__(
        self,
        port: str,
        baud: int,
        address: int = BROADCAST_ADDRESS,
        commands: ChafonCommands = ChafonCommands(),
        layout: ResponseLayout = ResponseLayout(),
        response_timeout_s: float = 1.0,
        tx_power_dbm: Optional[int] = None,
        serial_factory: Optional[Callable[[], SerialPort]] = None,
    ) -> None:
        self._port_name = port
        self._baud = baud
        self._address = address
        self._commands = commands
        self._layout = layout
        self._timeout = response_timeout_s
        self._tx_power = tx_power_dbm
        self._serial_factory = serial_factory or self._open_serial
        self._serial: Optional[SerialPort] = None
        self._decoder = FrameDecoder()

    def _open_serial(self) -> SerialPort:
        import serial  # pyserial; imported here so the protocol code works without it

        return serial.Serial(self._port_name, self._baud, timeout=0.05, exclusive=True)

    @property
    def is_open(self) -> bool:
        return self._serial is not None

    def open(self) -> None:
        try:
            self._serial = self._serial_factory()
        except (OSError, ValueError) as err:  # serial.SerialException is an OSError
            raise ReaderError(f"cannot open {self._port_name}: {err}") from err
        log.info("CHAFON reader on %s @ %d baud, address 0x%02X", self._port_name, self._baud, self._address)
        if self._tx_power is not None:
            self._apply_tx_power(self._tx_power)

    def close(self) -> None:
        if self._serial is not None:
            try:
                self._serial.close()
            except OSError:
                pass
            self._serial = None

    def inventory(self) -> List[str]:
        frames = self._transact(self._commands.inventory, self._commands.inventory_data, multi_frame=True)
        epcs: List[str] = []
        for frame in frames:
            if frame.status not in TAG_DATA_STATUSES:
                continue  # the reader answered without a tag list (e.g. "no tag in field")
            try:
                epcs.extend(parse_inventory(frame.data, self._layout))
            except MalformedFrame as err:
                log.warning(
                    "ignoring malformed inventory frame (%s): %s - check reader.responseLayout against the CHAFON manual",
                    err,
                    frame.data.hex(),
                )
        return epcs

    def reader_info(self) -> ResponseFrame:
        """Raw answer to the get-info command (for bring-up / ``tools.scan --info``)."""
        if self._commands.get_info is None:
            raise ReaderError("reader.commands.getInfo is not configured")
        return self._transact(self._commands.get_info, b"")[0]

    def _apply_tx_power(self, dbm: int) -> None:
        if self._commands.set_power is None:
            log.warning("txPowerDbm is set but reader.commands.setPower is null; RF power left unchanged")
            return
        try:
            frame = self._transact(self._commands.set_power, bytes([dbm]))[0]
        except ReaderError as err:
            log.warning("set RF power to %d dBm failed: %s", dbm, err)
            return
        if frame.status == 0x00:
            log.info("RF power set to %d dBm", dbm)
        else:
            log.warning("reader answered set-power with status 0x%02X; check the command in the CHAFON manual", frame.status)

    def _transact(self, command: int, data: bytes, multi_frame: bool = False) -> List[ResponseFrame]:
        port = self._serial
        if port is None:
            raise ReaderError("reader is not open")
        frames: List[ResponseFrame] = []
        try:
            port.reset_input_buffer()
            self._decoder.reset()
            port.write(build_frame(self._address, command, data))
            deadline = time.monotonic() + self._timeout
            while time.monotonic() < deadline:
                chunk = port.read(port.in_waiting or 1)
                for frame in self._decoder.feed(chunk):
                    if frame.command != command:
                        continue  # stale answer to an earlier command
                    if self._address != BROADCAST_ADDRESS and frame.address != self._address:
                        continue
                    frames.append(frame)
                    if not multi_frame or frame.status != MORE_FRAMES_STATUS:
                        return frames
        except OSError as err:
            raise ReaderError(f"serial I/O on {self._port_name} failed: {err}") from err
        if frames:
            log.warning("multi-frame answer to 0x%02X cut short after %.1f s", command, self._timeout)
            return frames
        raise ReaderError(f"no valid answer to command 0x{command:02X} within {self._timeout:.1f} s")
