"""Durable outbox: every Firestore write goes through SQLite first.

A vehicle drives through dead zones; nothing the reader observed may be lost.
The gateway therefore never talks to Firestore directly when it writes:
it *enqueues* a commit (a list of REST ``Write`` objects applied atomically)
and a background thread *flushes* the outbox in FIFO order.

* Order is preserved: the head item blocks the queue while it is failing
  transiently (an alert must be created before it can be resolved).
* Transient failures back off exponentially (1 s, 2 s, 4 s ... 60 s).
* Permanent failures (security rules, missing document) are moved to the
  ``dead_letter`` table and logged, so one bad write cannot wedge the queue.
* ``ALREADY_EXISTS`` means an earlier attempt was applied but its response
  was lost (document ids are generated on the device), so it counts as sent.
* Physical times (``deviceTime``, ``detectedAt``, ``leftVehicleAt`` ...) are
  inside the stored writes, so they survive any delay; only ``createdAt`` /
  ``updatedAt`` are stamped by the server when the write finally lands.
* ``coalesce_key``: for state snapshots (presence, location, heartbeat) only
  the newest pending write matters; enqueueing replaces the pending one.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from dataclasses import dataclass
from typing import Callable, List, Optional, Sequence

from .firebase_client import PermanentError, TransientError, Write

log = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS outbox (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    created_ms      INTEGER NOT NULL,
    label           TEXT    NOT NULL,
    coalesce_key    TEXT,
    writes          TEXT    NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_ms INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT
);
CREATE INDEX IF NOT EXISTS outbox_coalesce ON outbox (coalesce_key);
CREATE TABLE IF NOT EXISTS dead_letter (
    id         INTEGER PRIMARY KEY,
    created_ms INTEGER NOT NULL,
    failed_ms  INTEGER NOT NULL,
    label      TEXT    NOT NULL,
    writes     TEXT    NOT NULL,
    error      TEXT    NOT NULL
);
"""


@dataclass
class FlushResult:
    sent: int = 0
    dead: int = 0
    #: True when items remain because the head is failing / backing off.
    blocked: bool = False
    error: Optional[Exception] = None


@dataclass(frozen=True)
class DeadLetter:
    label: str
    writes: List[Write]
    error: str


class Outbox:
    MAX_BACKOFF_S = 60.0

    def __init__(self, path: str, clock: Callable[[], float] = time.time) -> None:
        self._clock = clock
        self._lock = threading.Lock()
        # One connection shared by the main (enqueue) and sync (flush) threads,
        # serialised by self._lock.
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=FULL")  # the van's ignition can cut power at any moment
        self._db.executescript(_SCHEMA)
        #: Bumped on every non-coalesced enqueue. The state cache uses it to
        #: tell whether local writes happened while it was fetching.
        self.version = 0

    def _now_ms(self) -> int:
        return int(self._clock() * 1000)

    def enqueue(self, writes: Sequence[Write], label: str, coalesce_key: Optional[str] = None) -> None:
        payload = json.dumps(list(writes), separators=(",", ":"))
        with self._lock, self._db:
            if coalesce_key:
                self._db.execute("DELETE FROM outbox WHERE coalesce_key = ?", (coalesce_key,))
            self._db.execute(
                "INSERT INTO outbox (created_ms, label, coalesce_key, writes) VALUES (?, ?, ?, ?)",
                (self._now_ms(), label, coalesce_key, payload),
            )
            if not coalesce_key:
                self.version += 1

    def depth(self, ordered_only: bool = False) -> int:
        """Pending items; ``ordered_only`` skips coalesced state snapshots."""
        sql = "SELECT COUNT(*) FROM outbox" + (" WHERE coalesce_key IS NULL" if ordered_only else "")
        with self._lock:
            return int(self._db.execute(sql).fetchone()[0])

    def flush(self, commit: Callable[[List[Write]], None], max_items: int = 100) -> FlushResult:
        """Send pending items in order until the queue is empty or the head fails."""
        result = FlushResult()
        for _ in range(max_items):
            with self._lock:
                row = self._db.execute(
                    "SELECT id, created_ms, label, writes, attempts, next_attempt_ms FROM outbox ORDER BY id LIMIT 1"
                ).fetchone()
            if row is None:
                break
            item_id, created_ms, label, payload, attempts, next_attempt_ms = row
            if next_attempt_ms > self._now_ms():
                result.blocked = True  # still backing off
                break
            writes: List[Write] = json.loads(payload)
            try:
                commit(writes)
            except PermanentError as err:
                if err.status == "ALREADY_EXISTS":
                    log.info("outbox: %s was already applied by an earlier attempt", label)
                    self._delete(item_id)
                    result.sent += 1
                    continue
                log.error("outbox: dropping %s - Firestore refused it permanently: %s", label, err)
                self._dead_letter(item_id, created_ms, label, payload, str(err))
                result.dead += 1
                continue
            except Exception as err:  # TransientError, or anything unexpected: keep the data, retry later
                if not isinstance(err, TransientError):
                    log.exception("outbox: unexpected error sending %s", label)
                self._retry_later(item_id, attempts + 1, str(err))
                result.blocked = True
                result.error = err
                break
            self._delete(item_id)
            result.sent += 1
        return result

    def dead_letters(self) -> List[DeadLetter]:
        with self._lock:
            rows = self._db.execute("SELECT label, writes, error FROM dead_letter ORDER BY id").fetchall()
        return [DeadLetter(label, json.loads(writes), error) for label, writes, error in rows]

    def close(self) -> None:
        with self._lock:
            self._db.close()

    def _delete(self, item_id: int) -> None:
        with self._lock, self._db:
            self._db.execute("DELETE FROM outbox WHERE id = ?", (item_id,))

    def _retry_later(self, item_id: int, attempts: int, error: str) -> None:
        delay_s = min(self.MAX_BACKOFF_S, 2.0 ** (attempts - 1))
        with self._lock, self._db:
            self._db.execute(
                "UPDATE outbox SET attempts = ?, next_attempt_ms = ?, last_error = ? WHERE id = ?",
                (attempts, self._now_ms() + int(delay_s * 1000), error, item_id),
            )

    def _dead_letter(self, item_id: int, created_ms: int, label: str, payload: str, error: str) -> None:
        with self._lock, self._db:
            self._db.execute(
                "INSERT INTO dead_letter (created_ms, failed_ms, label, writes, error) VALUES (?, ?, ?, ?, ?)",
                (created_ms, self._now_ms(), label, payload, error),
            )
            self._db.execute("DELETE FROM outbox WHERE id = ?", (item_id,))
