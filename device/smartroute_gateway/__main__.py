"""CLI: ``python -m smartroute_gateway --config config.json [--simulate] [--dry-run] [-v]``."""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path
from typing import IO, List, Optional

import requests

from .app import Gateway, build_gps, build_reader
from .config import PLACEHOLDER_PASSWORD, ConfigError, load_config
from .firebase_client import DocumentStore, FirebaseAuth, FirestoreClient, database_path
from .memstore import InMemoryFirestore
from .queue import Outbox

DEMO_FIXTURE = Path(__file__).resolve().parent / "demo_fixture.json"


def instance_lock(path: Path) -> Optional[IO[str]]:
    """One gateway per outbox - a second instance would double-report the vehicle.

    Returns the open lock file (keep it open while running; the OS releases
    the lock when the process exits), or None if another instance holds it.
    """
    import fcntl  # POSIX only (Raspberry Pi OS, macOS)

    handle = open(path, "w")
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        return None
    return handle


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m smartroute_gateway", description="SmartRoute Guardian RFID edge gateway")
    parser.add_argument("--config", default="config.json", help="path to config.json (default: %(default)s)")
    parser.add_argument("--simulate", action="store_true", help="use the simulated reader (type +EPC / -EPC on stdin) and simulated GPS")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="fully offline: run against a local dataset (--fixture) and log every Firestore write instead of sending it",
    )
    parser.add_argument("--fixture", type=Path, default=DEMO_FIXTURE, help="dataset for --dry-run (default: bundled demo data)")
    parser.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    log = logging.getLogger("smartroute")
    if not args.verbose:
        logging.getLogger("urllib3").setLevel(logging.WARNING)

    try:
        cfg = load_config(args.config)
    except ConfigError as err:
        log.error("config: %s", err)
        return 2
    if args.simulate:
        cfg = cfg.simulated()

    database = database_path(cfg.firebase.project_id)
    store: DocumentStore
    auth: Optional[FirebaseAuth] = None
    lock: Optional[IO[str]] = None
    if args.dry_run:
        try:
            store = InMemoryFirestore.from_fixture(args.fixture, database, log_writes=True)
        except (OSError, ValueError) as err:
            log.error("cannot load dry-run dataset %s: %s", args.fixture, err)
            return 2
        outbox = Outbox(":memory:")  # never touch the real outbox in a dry run
        log.info("DRY RUN: nothing is sent to Firebase; dataset %s", args.fixture)
    else:
        if cfg.device.password == PLACEHOLDER_PASSWORD:
            log.error("config: set device.password (still %r) or use --dry-run", PLACEHOLDER_PASSWORD)
            return 2
        lock_path = cfg.queue_path.with_suffix(".lock")
        lock = instance_lock(lock_path)
        if lock is None:
            log.error("another gateway is already running with %s (lock %s) - stop it first", cfg.queue_path, lock_path)
            return 2
        session = requests.Session()
        auth = FirebaseAuth(cfg.firebase.api_key, cfg.device.email, cfg.device.password, session)
        store = FirestoreClient(cfg.firebase.project_id, auth, session)
        outbox = Outbox(str(cfg.queue_path))

    gateway = Gateway(cfg, build_reader(cfg.reader), build_gps(cfg.gps), store, outbox, auth)
    try:
        gateway.run()
    finally:
        outbox.close()
        if lock is not None:
            lock.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
