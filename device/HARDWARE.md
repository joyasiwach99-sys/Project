# Hardware - SmartRoute Guardian vehicle gateway

One kit per vehicle: Raspberry Pi 4 + CHAFON CF591 UHF RFID reader + GPS
module, powered from the vehicle's 12 V system, with UHF EPC Gen2 labels on
the parcels.

> Anything about the CF591's electrical characteristics (supply voltage,
> current draw, RF output power, connector pinout, interfaces fitted on your
> variant) must come from **CHAFON's datasheet and manual** for your unit.
> This document deliberately does not guess them.

## Bill of materials

Prices are **rough estimates** of Indian retail/online prices in rupees and
vary a lot by seller and over time - use them for budgeting only.

| # | Item | Notes | Approx. price (estimate) |
|---|---|---|---|
| 1 | Raspberry Pi 4 Model B | 2 GB RAM is plenty; 4 GB if you also use it for development | ₹4,500 – 6,500 |
| 2 | Case with heatsink (or fan) | A van dashboard / cargo area gets hot | ₹300 – 900 |
| 3 | microSD card, 32 GB, high-endurance | Constant small writes (outbox, logs) | ₹400 – 900 |
| 4 | CHAFON CF591 UHF RFID reader | Get a supplier quote; check which interfaces your variant has (USB / RS232 / RS485) and that it supports the Indian band | ₹8,000 – 25,000 (very rough) |
| 5 | USB adapter for the reader, if needed | USB-RS232 (real RS232 levels) or USB-RS485, matching the reader's port; not needed if the reader has USB | ₹300 – 900 |
| 6 | GPS module, u-blox NEO-6M breakout (e.g. GY-GPS6MV2) with patch antenna | 9600 baud NMEA by default | ₹300 – 700 |
| 7 | Active GPS antenna (optional) | Roof/windscreen mounting when the module can't see the sky | ₹250 – 600 |
| 8 | 12 V → 5 V DC-DC buck converter, ≥ 3 A, wide input range | Automotive-rated input protection; USB-C output or screw terminals + USB-C lead | ₹300 – 1,200 |
| 9 | Inline fuse holder + fuses | At the 12 V tap; size to the wiring and total load | ₹50 – 200 |
| 10 | Wiring, connectors, ring terminals, cable ties, grommets | Automotive-grade wire | ₹200 – 600 |
| 11 | Enclosure, IP54 or better, with cable glands | For the Pi + converter | ₹300 – 1,200 |
| 12 | UHF RFID labels, EPC Class 1 Gen 2 | Packs of 100+; on-metal tags cost more (₹40 – 150 each) | ₹4 – 20 each |
| 13 | RTC module DS3231 (optional) | Keeps correct time with no network at boot | ₹150 – 400 |
| 14 | 4G USB dongle / hotspot (optional) | Or the driver's phone hotspot | ₹1,500 – 3,000 |

Ballpark per vehicle excluding the reader and tags: roughly ₹7,000 – 13,000.

## Wiring overview

```
 Vehicle 12 V (ignition-switched)
   │
   ├─[fuse]─► 12 V→5 V buck (≥3 A) ──USB-C──► Raspberry Pi 4
   │                                            │  USB ───────────► CF591 (USB-serial)
   │                                            │                    or USB-RS232 / USB-RS485 adapter ─► CF591
   │                                            │  GPIO14/15 (UART) ─► NEO-6M GPS   (or USB-TTL adapter)
   └─[fuse]─► CF591 power input  (only if the CHAFON datasheet says it accepts the vehicle supply range)
 Common ground for everything.
```

### Power

- **Pi:** a 12 V → 5 V buck converter rated for at least 3 A continuous,
  delivering ~5.1 V at the Pi (the official Pi 4 supply is 5.1 V / 3 A). Pick
  one with a wide input range and input protection: a vehicle's "12 V" is
  ~14 V with the engine running, dips while cranking and has spikes. Check for
  under-voltage with `vcgencmd get_throttled` (`0x0` is good).
- **Fuse** the 12 V feed as close to the tap point as practical, sized for the
  wire gauge and the total load.
- **Ignition-switched feed** avoids draining the battery but cuts power
  abruptly. The outbox is SQLite with full sync, so queued writes survive; for
  SD-card longevity consider a small UPS/supercap HAT that lets the Pi shut
  down cleanly, or Raspberry Pi OS's read-only overlay file system.
- **CF591:** power it exactly as its datasheet specifies (voltage range,
  current, connector). If it accepts the vehicle's supply range, feed it from
  its own fused branch of the 12 V line; otherwise use a suitable converter.
  Don't power it from the Pi's GPIO 5 V pins.

### RFID reader → Pi

- **USB / USB-serial:** plug into a Pi USB port. It appears as
  `/dev/ttyUSB0` or `/dev/ttyACM0`; use the stable name from
  `ls -l /dev/serial/by-id/` in `reader.port`.
- **RS232 port:** use a USB-RS232 adapter with real RS232 levels. Never wire
  RS232 directly to the Pi's GPIO - the ±12 V levels will damage it.
- **RS485 port:** USB-RS485 adapter; connect A/B per the manual, common
  ground, terminate the line if the manual asks for it.
- Wiegand outputs are not supported by the gateway.
- Baud rate / address: from the CHAFON manual; then run
  `python -m smartroute_gateway.tools.scan --info` (README: Bringing up the CF591).

### GPS (NEO-6M) → Pi UART

| NEO-6M pin | Raspberry Pi 4 (physical pin) |
|---|---|
| VCC | 3.3 V (pin 1) or 5 V (pin 2) - **per your breakout board's rating**; many GY-GPS6MV2 boards have a regulator and accept either, check yours |
| GND | GND (pin 6) |
| TX | GPIO15 / RXD (pin 10) |
| RX | GPIO14 / TXD (pin 8) - optional, only needed to reconfigure the module |

- The Pi's GPIO is **3.3 V logic and not 5 V tolerant**. The NEO-6M itself
  uses 3.3 V logic; if your breakout's TX line is 5 V, add a level shifter.
- Enable the UART: `sudo raspi-config` → Interface Options → Serial Port →
  login shell **No**, serial hardware **Yes**; add `dtoverlay=disable-bt` to
  `/boot/firmware/config.txt` so `/dev/serial0` is the full UART, reboot.
  `sudo cat /dev/serial0` should then show `$GPRMC...` lines.
- Alternative: a 3.3 V USB-TTL adapter (GPS TX → adapter RX) and set
  `gps.port` to its `/dev/serial/by-id/...` name.
- The patch antenna needs sky view: a metal van body blocks GPS, so mount the
  module (or an active antenna) under the windscreen or on the roof, not in the
  cargo area.

## Reader / antenna placement

The goal: every parcel inside the cargo area is read reliably, and parcels
outside the van are not.

- Mount the reader (or its antenna) **inside the cargo area, near the cargo
  door**, high up (ceiling or upper wall), **angled down and inward toward the
  shelves where parcels sit**, so parcels in the van and parcels passing
  through the door are both in the field.
- Keep the clearance from metal surfaces the CHAFON manual recommends; a
  reader face pressed against the van wall performs badly.
- Metal cargo walls reflect UHF. That usually helps coverage inside, but an
  open door can let the field reach a parcel a few metres outside. Test with a
  tagged parcel on the ground outside the open door; if it is still read,
  lower the RF power or re-aim the antenna.
- Check coverage before a pilot: load a full set of tagged parcels, run
  `tools.scan` for a minute and confirm every EPC appears, including parcels at
  the bottom of stacks and at the back. The `readsPerMin` heartbeat stat
  shows the same thing remotely.
- The gateway tolerates short read misses (`absenceTimeoutSec`, 6 s), but a
  parcel that is *never* read in a corner of the van will look absent.

## Enclosure and mounting

- Pi + buck converter in a ventilated enclosure out of direct sun; the Pi
  throttles when hot (the heartbeat reports `cpuTempC`).
- Vibration: screw the enclosure down, strain-relieve every cable, and secure
  USB plugs (they can work loose on rough roads).
- Dust and water: IP54 or better, cable glands, drip loops.
- Keep cables out of the way of cargo handling and doors; nothing near airbags
  or the driver's controls.

## Tags

- **UHF EPC Class 1 Gen 2** (ISO/IEC 18000-63) labels. The system expects a
  96-bit EPC (24 hex characters), the common default.
- Choose inlays that perform well in the **865–867 MHz** band (ETSI-tuned or
  "global" 860–960 MHz inlays).
- The factory EPC printed by `tools.scan` is what you register on the parcel;
  re-programming EPCs (with CHAFON's software) is optional.
- Put the label on a flat face, away from metal and liquids (use on-metal tags
  for metal items), not under metallic tape, and ideally on the same face of
  every parcel. Linear-polarised antennas are orientation-sensitive; check
  your reader's antenna type.

## Regulatory and safety notes

- **Radio:** in India, UHF RFID uses the **865–867 MHz** licence-exempt band.
  Set the reader's region/frequency to it with CHAFON's configuration tool and
  check the current WPC rules for permitted transmit power before choosing
  `txPowerDbm`. Never operate in another region's band (e.g. 902–928 MHz).
  (The system diagram in `docs/ARCHITECTURE.md` says 865–868 MHz; that is the
  European band - the Indian band is the narrower 865–867 MHz.)
- **RF exposure:** mount the antenna in the cargo area facing the parcels,
  not toward the cab; use no more power than needed for reliable reads.
- **Electrical:** disconnect the battery while wiring, fuse at the source,
  use correctly rated wire, insulate every joint, and get the vehicle owner's
  / fleet's permission before modifying a vehicle.
- **Driving:** the gateway needs no interaction; nobody should operate it
  while driving.
