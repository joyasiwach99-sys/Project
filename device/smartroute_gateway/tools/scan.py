"""Print every unique EPC the reader sees - used when tagging / registering parcels.

    python -m smartroute_gateway.tools.scan --config config.json
    python -m smartroute_gateway.tools.scan --config config.json --info      # CHAFON bring-up check
    python -m smartroute_gateway.tools.scan --config config.json --simulate  # type +EPC lines

Hold one freshly tagged parcel near the antenna, copy the EPC it prints into
the parcel's "EPC" field in the admin console, repeat. Ctrl+C prints a summary.
Nothing is sent to Firebase.
"""
from __future__ import annotations

import argparse
import logging
import signal
import sys
import time
from typing import Dict, List, Optional

from ..app import build_reader
from ..config import ConfigError, load_config
from ..engine import normalize_epc
from ..readers.base import ReaderError
from ..readers.chafon import ChafonReader

EXPECTED_EPC_HEX = 24  # parcels store 96-bit EPCs (docs/ARCHITECTURE.md)


def _interrupt(*_: object) -> None:
    raise KeyboardInterrupt  # SIGTERM: stop like Ctrl+C and print the summary


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m smartroute_gateway.tools.scan",
        description="Print every unique EPC the reader sees (for tagging / registering parcels).",
    )
    parser.add_argument("--config", default="config.json")
    parser.add_argument("--simulate", action="store_true", help="simulated reader (type +EPC on stdin)")
    parser.add_argument("--info", action="store_true", help="CHAFON only: send the get-info command, print the raw answer and exit")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.WARNING, format="%(levelname)s %(name)s: %(message)s")

    try:
        cfg = load_config(args.config)
    except ConfigError as err:
        print(f"config: {err}", file=sys.stderr)
        return 2
    if args.simulate:
        cfg = cfg.simulated()
    reader = build_reader(cfg.reader)

    if args.info:
        if not isinstance(reader, ChafonReader):
            print("--info needs reader.backend = chafon", file=sys.stderr)
            return 2
        try:
            reader.open()
            frame = reader.reader_info()
        except ReaderError as err:
            print(f"no answer: {err}\nCheck port, baud rate, address and wiring (README: Bringing up the CF591).", file=sys.stderr)
            return 1
        finally:
            reader.close()
        print(f"reader at address 0x{frame.address:02X} answered command 0x{frame.command:02X} "
              f"with status 0x{frame.status:02X}, data: {frame.data.hex(' ').upper() or '(none)'}")
        print("Framing, CRC, baud rate and address are working. Decode the data bytes with the CHAFON manual.")
        return 0

    signal.signal(signal.SIGTERM, _interrupt)
    interval = cfg.reader.inventory_interval_ms / 1000
    counts: Dict[str, int] = {}
    print("Scanning - hold a tag near the antenna. Ctrl+C to stop.", flush=True)
    try:
        while True:
            try:
                if not reader.is_open:
                    reader.open()
                epcs = reader.inventory()
            except ReaderError as err:
                print(f"reader error: {err}", file=sys.stderr, flush=True)
                reader.close()
                time.sleep(1)
                continue
            for raw in epcs:
                epc = normalize_epc(raw)
                if not epc:
                    continue
                if epc not in counts:
                    note = "" if len(epc) == EXPECTED_EPC_HEX else f"  (note: {len(epc)} hex chars, parcels expect {EXPECTED_EPC_HEX})"
                    print(f"{time.strftime('%H:%M:%S')}  NEW  {epc}{note}", flush=True)
                counts[epc] = counts.get(epc, 0) + 1
            time.sleep(interval)
    except KeyboardInterrupt:
        pass
    finally:
        reader.close()
    print(f"\n{len(counts)} unique tag(s):")
    for epc in sorted(counts):
        print(f"  {epc}  read {counts[epc]}x")
    return 0


if __name__ == "__main__":
    sys.exit(main())
