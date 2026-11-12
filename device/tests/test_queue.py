"""The SQLite outbox: order, retry/backoff, dead letters, coalescing, durability."""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

import pytest
from support import DATABASE, FakeClock

from smartroute_gateway.firebase_client import PermanentError, TransientError, Write, create_write, server_timestamp, ts
from smartroute_gateway.queue import Outbox


def write(n: int) -> Write:
    return create_write(f"{DATABASE}/events/e{n}", {"n": n, "deviceTime": ts(1_767_225_600_000 + n)}, [server_timestamp("createdAt")])


class Recorder:
    """A commit function that records what it was sent and fails on demand."""

    def __init__(self) -> None:
        self.sent: List[List[Write]] = []
        self.fail_with: List[Exception] = []

    def __call__(self, writes: List[Write]) -> None:
        if self.fail_with:
            raise self.fail_with.pop(0)
        self.sent.append(writes)

    def numbers(self) -> List[Any]:
        return [w["update"]["fields"]["n"]["integerValue"] for c in self.sent for w in c]


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def outbox(clock: FakeClock) -> Outbox:
    return Outbox(":memory:", clock=clock)


def test_flushes_in_fifo_order_and_keeps_commits_together(outbox: Outbox) -> None:
    outbox.enqueue([write(1), write(2)], "pair")
    outbox.enqueue([write(3)], "single")
    rec = Recorder()
    result = outbox.flush(rec)
    assert (result.sent, result.dead, result.blocked) == (2, 0, False)
    assert [len(c) for c in rec.sent] == [2, 1]
    assert rec.numbers() == ["1", "2", "3"]
    assert outbox.depth() == 0


def test_transient_failure_blocks_the_queue_with_exponential_backoff(outbox: Outbox, clock: FakeClock) -> None:
    outbox.enqueue([write(1)], "first")
    outbox.enqueue([write(2)], "second")
    rec = Recorder()
    rec.fail_with = [TransientError("offline"), TransientError("offline")]

    first = outbox.flush(rec)
    assert first.blocked and isinstance(first.error, TransientError) and first.sent == 0
    assert outbox.flush(rec).blocked  # still inside the 1 s backoff: nothing attempted
    assert len(rec.fail_with) == 1

    clock.advance(1.0)
    assert outbox.flush(rec).blocked  # second failure -> 2 s backoff
    clock.advance(1.0)
    assert outbox.flush(rec).sent == 0
    clock.advance(1.0)
    assert outbox.flush(rec).sent == 2
    assert rec.numbers() == ["1", "2"]  # order preserved across the outage


def test_backoff_is_capped(outbox: Outbox, clock: FakeClock) -> None:
    outbox.enqueue([write(1)], "x")
    rec = Recorder()
    rec.fail_with = [TransientError("offline")] * 12
    for _ in range(12):
        outbox.flush(rec)
        clock.advance(Outbox.MAX_BACKOFF_S)
    assert rec.fail_with == []  # every attempt happened within the cap


def test_permanent_failure_is_dead_lettered_and_the_queue_moves_on(outbox: Outbox) -> None:
    outbox.enqueue([write(1)], "rejected")
    outbox.enqueue([write(2)], "fine")
    rec = Recorder()
    rec.fail_with = [PermanentError("PERMISSION_DENIED: nope", "PERMISSION_DENIED", 403)]
    result = outbox.flush(rec)
    assert (result.sent, result.dead, result.blocked) == (1, 1, False)
    assert rec.numbers() == ["2"]
    (dead,) = outbox.dead_letters()
    assert dead.label == "rejected"
    assert "PERMISSION_DENIED" in dead.error
    assert dead.writes == [write(1)]


def test_already_exists_counts_as_delivered(outbox: Outbox) -> None:
    outbox.enqueue([write(1)], "retried create")
    rec = Recorder()
    rec.fail_with = [PermanentError("ALREADY_EXISTS", "ALREADY_EXISTS", 409)]
    result = outbox.flush(rec)
    assert (result.sent, result.dead) == (1, 0)
    assert outbox.dead_letters() == []
    assert outbox.depth() == 0


def test_unexpected_errors_keep_the_data(outbox: Outbox) -> None:
    outbox.enqueue([write(1)], "x")
    rec = Recorder()
    rec.fail_with = [RuntimeError("bug")]
    assert outbox.flush(rec).blocked
    assert outbox.depth() == 1 and outbox.dead_letters() == []


def test_coalesced_items_replace_pending_snapshots(outbox: Outbox) -> None:
    outbox.enqueue([write(1)], "presence", coalesce_key="vehicle-presence")
    outbox.enqueue([write(2)], "event")
    outbox.enqueue([write(3)], "presence", coalesce_key="vehicle-presence")
    rec = Recorder()
    outbox.flush(rec)
    assert rec.numbers() == ["2", "3"]


def test_depth_and_version_track_ordered_writes_only(outbox: Outbox) -> None:
    outbox.enqueue([write(1)], "heartbeat", coalesce_key="heartbeat")
    assert (outbox.depth(), outbox.depth(ordered_only=True), outbox.version) == (1, 0, 0)
    outbox.enqueue([write(2)], "event")
    assert (outbox.depth(), outbox.depth(ordered_only=True), outbox.version) == (2, 1, 1)


def test_survives_a_restart_and_preserves_device_times(tmp_path: Path, clock: FakeClock) -> None:
    path = str(tmp_path / "outbox.sqlite")
    first = Outbox(path, clock=clock)
    first.enqueue([write(7)], "queued in a dead zone")
    first.close()

    clock.advance(3600)  # an hour later, after a power cycle
    second = Outbox(path, clock=clock)
    rec = Recorder()
    assert second.flush(rec).sent == 1
    sent: Dict[str, Any] = rec.sent[0][0]
    assert sent == write(7)
    assert sent["update"]["fields"]["deviceTime"] == {"timestampValue": "2026-01-01T00:00:00.007000Z"}
    second.close()
