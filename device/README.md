# SmartRoute Guardian - Raspberry Pi RFID gateway

The edge half of SmartRoute Guardian. A Raspberry Pi 4 in each delivery
vehicle reads the UHF RFID tags on the parcels in its cargo area (CHAFON CF591
reader) and its position (GPS module), decides what happened to each parcel
(loaded, delivered at the right stop, removed somewhere it shouldn't have
been, put in the wrong van...) and writes the result to Cloud Firestore, where
the admin console, driver app and public tracking page pick it up.

```
 parcel + EPC label ─UHF 865–867 MHz─► CF591 reader ─USB/serial─┐
                                                                ▼
 GPS (NEO-6M) ─────────────UART─────────────────────► Raspberry Pi 4: smartroute_gateway
                                                       inventory round (~1 s)
                                                       → presence debounce (6 s)
                                                       → verification engine
                                                       → SQLite outbox ──HTTPS──► Firestore
                                                                                 (device account,
                                                                                  same security rules
                                                                                  as people)
```

- The verification engine (`smartroute_gateway/engine.py`) is a 1:1 port of
  the web app's `src/lib/verification.ts`; the writes it produces follow
  `docs/ARCHITECTURE.md` §3.3 exactly.
- The gateway signs in as a **device account** (`device-van01@smartroute.demo`,
  `users/{uid}.role == "device"`), so `firestore.rules` restrict it to its own
  vehicle, the parcels it physically sees, alerts/events for its vehicle and
  its own `devices/{id}` heartbeat.
- Every write goes through a local SQLite outbox first, so a van driving
  through a dead zone loses nothing.

> **Hardware status.** The CHAFON driver implements the serial frame protocol
> widely used by CHAFON UHF readers, but it has **not been verified against a
> real CF591**. Before relying on it, check the command set against the
> protocol manual / SDK CHAFON ships with the reader - see
> [Bringing up the CF591](#bringing-up-the-cf591).

## Contents

```
device/
  README.md                 this file
  HARDWARE.md               bill of materials, wiring, antenna placement, safety
  install.sh                creates .venv, installs requirements, creates config.json
  config.example.json       every setting, with defaults
  requirements.txt          pyserial, requests
  requirements-dev.txt      + pytest
  systemd/smartroute-gateway.service   unit template (install.sh prints how to install it)
  smartroute_gateway/
    __main__.py             CLI: python -m smartroute_gateway --config config.json [--simulate] [--dry-run] [-v]
    app.py                  main loop (inventory rounds) + sync thread (Firestore)
    engine.py               PresenceTracker, decide_arrival/decide_departure, check_load, distance_m
    writer.py               decisions -> Firestore writes (ARCHITECTURE.md §3.3)
    state.py                caches: active route, parcels by EPC, open alerts
    queue.py                durable SQLite outbox with retry/backoff
    firebase_client.py      Firebase Auth + Firestore REST (no SDK)
    memstore.py             in-memory Firestore used by --dry-run and the tests
    gps.py                  NMEA parser + serial GPS, simulated GPS, no GPS
    config.py               config loading/validation
    readers/                chafon.py, lines.py, simulated.py (+ base.py)
    tools/scan.py           print the EPCs the reader sees (tagging parcels)
    demo_fixture.json       demo dataset for --dry-run
  tests/                    pytest suite (offline)
```

## Try it on a laptop first (no hardware, no Firebase)

```bash
cd device
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m smartroute_gateway --config config.example.json --simulate --dry-run
```

`--simulate` swaps in a simulated reader and GPS; `--dry-run` runs against a
small built-in dataset and **logs every Firestore write instead of sending
it**. Type commands for the simulated reader into the terminal:

| Type | What happens in the demo dataset (vehicle `VAN-01`, route `R-DEMO` in progress) |
|---|---|
| `+E28011700000020000000001` | `SRG-DEMO01` (assigned) is loaded → `parcel_loaded`, status `in_transit`, public timeline entry |
| `-E28011700000020000000001` | after 6 s: removed away from its stop → **unauthorized_removal** (critical) |
| `+E28011700000020000000001` again | re-detected → status restored, alert auto-resolved |
| `+E28011700000020000000004` | `SRG-DEMO04` belongs to `VAN-02` → **wrong_vehicle** (warning); removing it auto-resolves |
| `+E28011700000020000000003` | `SRG-DEMO03` is already delivered → **delivery_mismatch** (warning) |
| `+E2801170000002DEADBEEF99` | not registered → looked up, then **unknown_tag** (info) |
| `offline` / `online` | reader stops answering → **reader_offline** after 3 rounds; resolves on recovery |
| `list`, `clear`, `help` | |

The simulated van drives from the hub towards Cyber City at 25 km/h
(`gps.simulated` in the config). Ctrl+C stops it cleanly.

## Setting up a Raspberry Pi

**1. Hardware** - see [HARDWARE.md](HARDWARE.md) for parts, wiring and antenna placement.

**2. OS.** Raspberry Pi OS (Bookworm, Lite is fine; it ships Python 3.11). Set
the timezone and make sure the clock syncs (`timedatectl` should say
`System clock synchronized: yes`) - the gateway stamps physical event times
with the Pi's clock. If the GPS is on the Pi's UART:

```bash
sudo raspi-config          # Interface Options -> Serial Port: login shell NO, serial hardware YES
echo 'dtoverlay=disable-bt' | sudo tee -a /boot/firmware/config.txt   # stable UART for the GPS (turns Bluetooth off)
sudo reboot
```

**3. Install** (as the user the service will run as, not root):

```bash
git clone <this repo> smartroute && cd smartroute/device     # or copy just the device/ folder
./install.sh
sudo usermod -aG dialout "$USER"     # serial port access; log out and back in
```

**4. Create the cloud side** (an admin does this once per vehicle; the device
account cannot create these documents itself):

| What | Value |
|---|---|
| Firebase Auth user | `device-van01@smartroute.demo` with a strong password |
| `users/{uid}` | `role: "device"`, `vehicleId: "VAN-01"`, `deviceId: "RDR-01"`, `name`, `email` |
| `vehicles/VAN-01` | must exist (the gateway updates presence/location on it) |
| `devices/RDR-01` | must exist with `vehicleId: "VAN-01"` (the gateway updates its heartbeat) |

At startup the gateway reads `users/{its uid}` and refuses to send anything
(keeping writes queued, retrying every minute) until `role`, `vehicleId` and
`deviceId` match `config.json`.

**5. Configure** `config.json`: `device.password` (and email/ids for other
vehicles), `reader.port`, `gps.port`. Prefer stable port names such as
`/dev/serial/by-id/usb-...` over `/dev/ttyUSB0`, which can swap between USB
devices after a reboot.

**6. Check the hardware** (nothing is sent to Firebase):

```bash
.venv/bin/python -m smartroute_gateway.tools.scan --config config.json --info   # CHAFON framing/baud/address check
.venv/bin/python -m smartroute_gateway.tools.scan --config config.json          # shows EPCs as tags are read
```

**7. Run** in the foreground, watch the log, then install the service with the
commands `install.sh` printed:

```bash
.venv/bin/python -m smartroute_gateway --config config.json -v
sed -e "s|@DEVICE_DIR@|$PWD|g" -e "s|@USER@|$USER|g" systemd/smartroute-gateway.service \
  | sudo tee /etc/systemd/system/smartroute-gateway.service >/dev/null
sudo systemctl daemon-reload && sudo systemctl enable --now smartroute-gateway
journalctl -u smartroute-gateway -f
```

The service runs as your (non-root) user, starts after the network is up,
restarts automatically, and on stop marks the reader offline and flushes the
outbox.

## Bringing up the CF591

`readers/chafon.py` speaks the frame format used across CHAFON's UHF reader
family:

```
command:  Len | Adr | Cmd | Data...          | CRC16-LSB | CRC16-MSB
response: Len | Adr | Cmd | Status | Data... | CRC16-LSB | CRC16-MSB
Len = bytes after Len; CRC-16/MCRF4XX over Len..Data (poly 0x8408 reflected, init 0xFFFF)
inventory response data: [Ant] Num { EpcLen EPC [RSSI] } x Num
```

Defaults: inventory `0x01`, get-info `0x21`, set-power `0x2F`, address `0xFF`
(broadcast), 57600 baud. **These are the family defaults, not facts about the
CF591** - confirm each one in the manual that came with your reader:

1. **Find the port.** Plug the reader in and run `dmesg | tail` and
   `ls -l /dev/serial/by-id/`. A USB-serial reader shows up as `/dev/ttyUSB*`
   or `/dev/ttyACM*`. If the reader only has RS232 or RS485 terminals you need
   a matching USB adapter (see HARDWARE.md).
2. **Prove the link** with `tools.scan --info`. An answer means baud rate,
   address, framing and CRC are right. No answer: try the baud rate and address
   from the manual (`"0x00"` vs `"0xFF"`), and check the reader with CHAFON's
   own demo software first.
3. **Check the inventory command.** Some models expect parameters with the
   inventory command (Q value, session, antenna, scan time...): put them in
   `reader.commands.inventoryData` as hex (`"04 00"`). Set
   `reader.responseLayout.antennaByte` / `rssiByte` if the manual shows an
   antenna byte before the tag count or an RSSI byte after each EPC.
   Mismatches are logged as `ignoring malformed inventory frame (...)` with the
   raw bytes - compare them with the manual; malformed frames are never turned
   into EPCs.
4. **Set the region** to the Indian band (865–867 MHz) with CHAFON's
   configuration tool. Set RF power there too, or set `reader.txPowerDbm` to
   have the gateway send the set-power command at startup - only once you have
   confirmed the set-power command code (`reader.commands.setPower`) in the
   manual. With `txPowerDbm: null` the gateway never changes reader settings.
5. **Alternative:** if your reader can push tags on its own (active /
   auto-output mode, configured with CHAFON's tool), use
   `"backend": "lines"`: it extracts hex EPCs from whatever text lines arrive on
   the serial port (`"port": "-"` reads stdin; keyboard-wedge readers only work
   that way in an interactive terminal, not under systemd).

## Tagging and registering parcels

1. Stick one UHF EPC Gen2 label on each parcel (flat face, not directly on
   metal or liquid - see HARDWARE.md).
2. Run `.venv/bin/python -m smartroute_gateway.tools.scan --config config.json`
   (stop the service first if it is running: `sudo systemctl stop smartroute-gateway`,
   only one program can own the serial port).
3. Hold **one** parcel near the antenna; the tool prints `NEW  E2801170...`.
   It warns if the EPC is not the 24 hex characters the web app expects.
4. Copy that EPC into the parcel's **EPC** field in the admin console (or
   create the parcel there), assign it to a vehicle/route, repeat.
5. Ctrl+C prints every EPC seen with its read count - a quick way to spot a
   label that reads poorly.

## Simulate and dry-run modes

| Flags | Reader / GPS | Firebase |
|---|---|---|
| *(none)* | from `config.json` | real (device account) |
| `--simulate` | simulated reader (stdin) + simulated GPS | real - drive the live dashboards without hardware |
| `--dry-run` | from `config.json` (e.g. real reader on the Pi) | none: in-memory dataset, writes logged as `DRY-RUN ...` |
| `--simulate --dry-run` | simulated | none - the laptop demo above |

`--dry-run` uses `smartroute_gateway/demo_fixture.json` (vehicle `VAN-01`,
reader `RDR-01`) unless you pass `--fixture my.json`, a file shaped like
`{"parcels": {"P1": {...fields...}}, "vehicles": {...}, "routes": {...}, ...}`.
It never touches `outbox.sqlite`. On a Pi, `--dry-run --fixture` with your
real tag EPCs is a good way to test reader + GPS + engine before the cloud
side exists.

## How it works

**Two threads.** The main thread runs an inventory round every
`inventoryIntervalMs` (~1 s): reader → presence tracker → engine → writer →
outbox. It never touches the network. A sync thread flushes the outbox,
refreshes the caches and enqueues heartbeat/location writes. A stalled HTTPS
request therefore cannot delay inventory rounds (which would make shadowed
tags look like they had left).

**Presence.** A tag *arrives* when first read and *departs* after
`absenceTimeoutSec` (6 s) without a read, so the normal UHF read misses
(parcels shadowing each other, metal, liquids) don't create false removals.

**Decisions → writes.** Exactly the table in `docs/ARCHITECTURE.md` §3.3.
Physical times (`lastSeenAt`, `loadedAt`, `leftVehicleAt`, `deviceTime`,
`detectedAt`) come from the Pi's clock - the arrival round for arrivals, the
last RFID read for departures - and survive any queueing delay; `createdAt`,
`updatedAt` and `resolvedAt` are server timestamps (the rules require
`createdAt == request.time` for events and alerts). Alerts carry readable
titles and messages, e.g. *"Parcel SRG-DEMO01 was removed from VAN-01 764 m
from its destination while the route was in progress."* An alert is never
raised twice for the same `(vehicle, parcel|EPC, type)` while one is open or
acknowledged; `unknown_tag` is raised at most once per EPC per run.

**Unknown EPCs.** Parcels are cached by EPC (this vehicle's manifest plus
anything the cloud places in this cargo), refreshed every `parcelRefreshSec`.
An EPC missing from the cache gets one targeted `epc ==` query before it is
declared `unknown_tag` - the parcel may have been registered a minute ago.

**Dead zones.** Each logical change (e.g. alert + its `alert_raised` event) is
one atomic commit in the outbox, delivered in order with exponential backoff
(1 s … 60 s). Writes Firestore rejects permanently (rules, missing document)
are moved to a `dead_letter` table and logged so they cannot block the queue.
Snapshots (presence, location, heartbeat) are coalesced: only the newest
pending one is kept. Caches are not refreshed from the cloud while local
parcel/alert writes are still queued (the local copy is newer).

**Reader failure.** Rounds where the reader does not answer are not treated
as "no tags" - presence is frozen. After 3 failed rounds the vehicle gets
`readerOnline: false` and one `reader_offline` alert; the reader is reopened
every round, and on recovery the alert is auto-resolved and every tag's
absence timer restarts.

**Restarts.** After the first parcel load the gateway also watches the
parcels the cloud records in this cargo (`inVehicleId == me`), so a parcel
removed while the Pi was off is still reported once the absence timeout
passes.

**Heartbeat & location.** `devices/{id}` every `heartbeatSec` with
`stats {readsPerMin, uniqueTags, cpuTempC, uptimeSec, queueDepth}`, `ip`,
`firmware`. `vehicles/{id}.location` every 5 s while moving (> 10 m), else
every 30 s, with `source: "gps_module"` (or `"simulator"`).

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `firebase.apiKey`, `firebase.projectId` | - | Web API key and project (public values) |
| `device.email`, `device.password` | - | Device account; `CHANGE_ME` is refused outside `--dry-run` |
| `device.deviceId`, `device.vehicleId` | - | Must match `users/{uid}` |
| `reader.backend` | - | `chafon`, `lines` or `simulated` |
| `reader.port`, `reader.baud` | `/dev/ttyUSB0`, 57600 | Serial port (`-` = stdin for `lines`) |
| `reader.address` | `"0xFF"` | CHAFON reader address (0xFF = broadcast) |
| `reader.inventoryIntervalMs` | 1000 | Time between inventory rounds |
| `reader.responseTimeoutMs` | 1000 | Wait for the reader's answer |
| `reader.txPowerDbm` | `null` | If set, sent with `commands.setPower` at startup |
| `reader.commands` | `0x01` / `""` / `0x21` / `0x2F` | `inventory`, `inventoryData` (hex), `getInfo`, `setPower` (`null` disables) |
| `reader.responseLayout` | both `false` | `antennaByte`, `rssiByte` in inventory responses |
| `reader.minEpcBytes` | 12 | `lines` backend: shortest hex run accepted as an EPC |
| `reader.simulated` | `[]`, 0.1 | Initial `tags`, random `missProbability` per round |
| `gps.backend` | `none` | `nmea`, `simulated` or `none` (no GPS: every removal during a route is unauthorized) |
| `gps.port`, `gps.baud` | `/dev/serial0`, 9600 | NEO-6M default is 9600 baud |
| `gps.maxFixAgeSec` | 5 | Older fixes count as "no fix" |
| `gps.simulated` | - | `waypoints` `[[lat, lng], ...]`, `speedKmh` |
| `engine.absenceTimeoutSec`, `engine.geofenceM` | 6, 150 | Same meaning as in the web app |
| `heartbeatSec`, `parcelRefreshSec`, `routeRefreshSec` | 15, 30, 10 | Sync cadence |
| `queuePath` | `outbox.sqlite` | Relative to the config file |

## Firestore usage

Rough numbers for one vehicle with ~40 parcels on its manifest: route refresh
(2 reads / 10 s) + parcel/alert refresh every 30 s (1 read per manifest parcel,
plus 1 more per parcel currently in the cargo, which matches both queries)
≈ **5,000–10,000 reads per hour**; writes ≈ 1,000 per hour (location every 5 s
while moving, heartbeat, presence changes, events). The free Spark plan allows 50k reads
and 20k writes per day, so a full working day with several vans needs either
the Blaze plan or a larger `parcelRefreshSec` (route changes are still picked
up every `routeRefreshSec`). Queries use equality filters only, so no extra
composite indexes are needed.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `device account ... is not set up for this gateway` | `users/{uid}` missing, `role` not `device`, or `vehicleId`/`deviceId` differ from config.json. Writes stay queued; it retries every minute. |
| `Firebase Auth refused ...: INVALID_LOGIN_CREDENTIALS` | Wrong email/password in config.json. Writes stay queued. |
| `outbox: dropping ... PERMISSION_DENIED` | A write broke the rules (e.g. the vehicle/device doc does not exist, or the account is for another vehicle). See dead letters below. |
| `vehicles/VAN-01 does not exist` | Create the vehicle in the admin console. |
| `cannot open /dev/ttyUSB0: Permission denied` | `sudo usermod -aG dialout $USER`, log in again (the systemd unit adds `dialout` itself). |
| `another gateway is already running` / `cannot open ...: Could not exclusively lock port` | The service already owns the outbox / serial port: `sudo systemctl stop smartroute-gateway` before running the gateway or `tools.scan` by hand. |
| `no valid answer to command 0x01` / reader offline alert | Power, cable, port, baud rate, address - see [Bringing up the CF591](#bringing-up-the-cf591). |
| `ignoring malformed inventory frame` | `reader.responseLayout` / inventory command don't match your model. |
| Tags not read / read intermittently | Antenna placement, tag orientation, labels on metal/liquid, RF power - HARDWARE.md. |
| No GPS fix | The antenna needs sky view (not inside a metal cargo box). `sudo cat /dev/serial0` should print `$GP...` lines at 9600 baud; nothing means UART not enabled or TX/RX swapped. |
| Event times are wrong | The Pi has no battery-backed clock: check `timedatectl`, or fit an RTC module (HARDWARE.md). |
| Inspect rejected writes | `sqlite3 outbox.sqlite "select label, error from dead_letter"` |
| See what is waiting | `sqlite3 outbox.sqlite "select id, label, attempts, last_error from outbox"` |
| Logs | `journalctl -u smartroute-gateway -f` (add `-v` to `ExecStart` for debug) |

## Tests

```bash
cd device
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt -r requirements-dev.txt
.venv/bin/python -m pytest -q
```

The suite is fully offline. It ports every scenario of
`src/lib/verification.test.ts`, checks each decision's writes against
ARCHITECTURE.md §3.3 using an in-memory Firestore that **enforces an emulation
of the device rules from `firestore.rules`** (including
`createdAt == request.time`), and covers the outbox, the REST encoding, auth
token refresh, NMEA parsing, CHAFON framing/CRC (check value `0x6F91`) and an
end-to-end run of the main loop.

## Limitations

- CHAFON CF591 command set unverified on hardware (see above).
- One reader per gateway; the gateway trusts the Pi's clock.
- The `lines` backend can't tell which antenna/RSSI a read came from.
- `publicTracking` is only updated on load (delivery confirmation is the driver app's job).
