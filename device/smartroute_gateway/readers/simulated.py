"""Simulated RFID reader for demos and tests - no hardware needed.

Control it from the terminal (``interactive=True``) or programmatically::

    +E28011700000020000000001      tag enters the read field (several EPCs allowed)
    -E28011700000020000000001      tag leaves
    list                           show tags in the field
    clear                          remove every tag
    offline / online               make the reader stop / resume answering
    help

``miss_probability`` drops each tag from a round at random, the way shadowed
UHF tags are missed in a real cargo area, to exercise the presence debounce.
"""
from __future__ import annotations

import random
import sys
import threading
from typing import Iterable, List, Optional, Set, TextIO

from ..engine import normalize_epc
from .base import Reader, ReaderError

HELP = "commands: +EPC [EPC...] | -EPC [EPC...] | list | clear | offline | online | help"


class SimulatedReader(Reader):
    def __init__(
        self,
        tags: Iterable[str] = (),
        miss_probability: float = 0.0,
        rng: Optional[random.Random] = None,
        interactive: bool = False,
        console: TextIO = sys.stdout,
    ) -> None:
        self._lock = threading.Lock()
        self._tags: Set[str] = {e for e in (normalize_epc(t) for t in tags) if e}
        self._miss = miss_probability
        self._rng = rng or random.Random()
        self._online = True
        self._open = False
        self._interactive = interactive
        self._console = console
        self._stdin_thread: Optional[threading.Thread] = None

    # ------------------------------------------------------------- control

    def add(self, *epcs: str) -> None:
        with self._lock:
            self._tags.update(e for e in (normalize_epc(x) for x in epcs) if e)

    def remove(self, *epcs: str) -> None:
        with self._lock:
            self._tags.difference_update(normalize_epc(x) for x in epcs)

    def clear(self) -> None:
        with self._lock:
            self._tags.clear()

    def tags(self) -> List[str]:
        with self._lock:
            return sorted(self._tags)

    def set_online(self, online: bool) -> None:
        self._online = online

    def handle_command(self, line: str) -> str:
        text = line.strip()
        if not text:
            return ""
        words = text.split()
        if text[0] in "+-":
            epcs = [w.lstrip("+-") for w in words]
            (self.add if text[0] == "+" else self.remove)(*epcs)
            return f"{len(self.tags())} tag(s) in field"
        command = words[0].lower()
        if command == "list":
            tags = self.tags()
            return "\n".join(tags) if tags else "(no tags in field)"
        if command == "clear":
            self.clear()
            return "field cleared"
        if command in ("offline", "online"):
            self.set_online(command == "online")
            return f"simulated reader {command}"
        return HELP

    # -------------------------------------------------------------- Reader

    @property
    def is_open(self) -> bool:
        return self._open

    def open(self) -> None:
        self._open = True
        if self._interactive and self._stdin_thread is None:
            self._stdin_thread = threading.Thread(target=self._read_stdin, name="sim-reader-stdin", daemon=True)
            self._stdin_thread.start()
            print(f"[simulated reader] {HELP}", file=self._console, flush=True)

    def close(self) -> None:
        self._open = False

    def inventory(self) -> List[str]:
        if not self._online:
            raise ReaderError("simulated reader is offline")
        with self._lock:
            tags = sorted(self._tags)
        return [t for t in tags if self._rng.random() >= self._miss]

    def _read_stdin(self) -> None:
        for line in sys.stdin:  # ends quietly at EOF
            reply = self.handle_command(line)
            if reply:
                print(f"[simulated reader] {reply}", file=self._console, flush=True)
