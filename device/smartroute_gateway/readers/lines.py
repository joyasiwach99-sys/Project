"""Line-oriented readers: active / auto-output mode on a serial port, or stdin.

Many UHF readers can be switched (with the vendor's configuration tool) to
push every tag they see as a line of text, e.g. ``E28011700000020A1B2C3D4E``,
``EPC: E2 80 11 70 ...`` or ``1,E280117000...,-61``. This backend extracts
hex EPCs from whatever lines arrive; ``inventory()`` returns everything
received since the previous call.

``port: "-"`` reads stdin. That also covers keyboard-wedge (USB HID) readers
when run interactively - they "type" into the terminal, so this only works
in a foreground session (e.g. ``tools.scan``), not under systemd.
"""
from __future__ import annotations

import logging
import re
import sys
import threading
from typing import Any, List, Optional

from .base import Reader, ReaderError

log = logging.getLogger(__name__)


def epc_pattern(min_bytes: int) -> "re.Pattern[str]":
    # Either every byte pair is separated ("E2 80 11 ..." / "E2:80:11...") or
    # none is ("E28011..."), so two contiguous EPCs separated by a space stay
    # two EPCs. Not glued to other hex digits; odd-length runs never match.
    hx = "[0-9A-Fa-f]"
    separated = rf"{hx}{{2}}(?:[ :-]{hx}{{2}}){{{min_bytes - 1},}}"
    contiguous = rf"(?:{hx}{{2}}){{{min_bytes},}}"
    return re.compile(rf"(?<!{hx})(?:{separated}|{contiguous})(?!{hx})")


def extract_epcs(line: str, pattern: "re.Pattern[str]") -> List[str]:
    return [re.sub(r"[^0-9A-Fa-f]", "", m.group(0)).upper() for m in pattern.finditer(line)]


class LinesReader(Reader):
    def __init__(self, port: str, baud: int, min_epc_bytes: int = 12) -> None:
        self._port_name = port
        self._baud = baud
        self._pattern = epc_pattern(min_epc_bytes)
        self._lock = threading.Lock()
        self._pending: List[str] = []
        self._error: Optional[str] = None
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._serial: Optional[Any] = None  # serial.Serial when reading a port

    @property
    def is_open(self) -> bool:
        return self._thread is not None

    def open(self) -> None:
        self._stop.clear()
        self._error = None
        if self._port_name == "-":
            target = self._pump_stdin
        else:
            import serial  # pyserial

            try:
                self._serial = serial.Serial(self._port_name, self._baud, timeout=0.5, exclusive=True)
            except (OSError, ValueError) as err:
                raise ReaderError(f"cannot open {self._port_name}: {err}") from err
            target = self._pump_serial
        self._thread = threading.Thread(target=target, name="reader-lines", daemon=True)
        self._thread.start()
        log.info("line reader on %s", "stdin" if self._port_name == "-" else f"{self._port_name} @ {self._baud} baud")

    def close(self) -> None:
        self._stop.set()
        if self._serial is not None:
            self._serial.close()  # unblocks the pump thread
            self._serial = None
        self._thread = None

    def inventory(self) -> List[str]:
        with self._lock:
            if self._error:
                raise ReaderError(self._error)
            epcs, self._pending = self._pending, []
        return epcs

    def feed_line(self, line: str) -> None:
        epcs = extract_epcs(line, self._pattern)
        if epcs:
            with self._lock:
                self._pending.extend(epcs)

    def _pump_stdin(self) -> None:
        for line in sys.stdin:  # ends quietly at EOF
            if self._stop.is_set():
                return
            self.feed_line(line)

    def _pump_serial(self) -> None:
        port = self._serial
        buffer = b""
        try:
            while port is not None and not self._stop.is_set():
                buffer += port.read(port.in_waiting or 1)
                *lines, buffer = re.split(rb"[\r\n]", buffer)
                for raw in lines:
                    self.feed_line(raw.decode("ascii", errors="replace"))
                if len(buffer) > 4096:  # no line breaks at all: wrong mode or baud rate
                    buffer = b""
        except (OSError, TypeError) as err:  # TypeError: pyserial after close() from another thread
            if not self._stop.is_set():
                with self._lock:
                    self._error = f"serial read on {self._port_name} failed: {err}"
