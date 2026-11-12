# Pilot Protocol — SmartRoute Guardian

How to run the validation tests in the project scope and record them so the **Pilot report** (`/admin/pilot`) can be shared with confidence.

> **Before the first real test:** Admin → Settings → **Clear all operational data**. This removes the demo dataset and its "simulated data" banner, so demo numbers can never mix with measured ones. Also delete the sample trials on the Pilot report page.

## Targets (from the scope document)

| Metric | Target | Where it comes from |
|---|---|---|
| Detection, static test | **≥ 95 %** | Trial log: `parcelsDetected / parcelsTagged` for *Static read* trials |
| Detection, realistic loading | **≥ 90 %** | Trial log (*Realistic loading*, *Live route*) and the automatic RFID load checks |
| Alert latency | **< 10 s** | Each alert stores `detectedAt` (last RFID read) and `createdAt` (cloud time) — see Alerts page |
| Parcels tested | **30–50** | Trial log |
| Alerts caught in drills | **100 %**, 0 false alarms | Trial log |
| Time saved vs manual | Report the % | Driver app times both manual and RFID load checks |

## Equipment checklist

- Gateway installed (see `device/HARDWARE.md`), `config.json` filled in, `python -m smartroute_gateway.tools.scan` shows tags
- 30–50 parcels (or boxes, library books, lab kits) with UHF RFID labels, each **registered** in Admin → Parcels (EPC from the scan tool)
- A phone signed in to the driver app (driver account linked to the vehicle)
- A stopwatch for manual checks; a notebook for observations
- An adult supervisor for any vehicle test; the vehicle parked with the engine off for static tests

## Test 1 — Static read (target ≥ 95 %)

1. Place all tagged parcels in the cargo area, packed as they would be on a real route.
2. Start the gateway; wait 30 seconds.
3. Read the vehicle detail page: **Detected / expected on board**.
4. Repeat 3 times with the parcels re-shuffled (tags facing different directions, heavy items on top).
5. Log each run as a *Static read test* trial: tagged, detected, notes on which tags were missed and why (metal, liquids, tag behind other parcels).

**Tuning if below target:** raise reader power (within the legal limit), move or angle the antenna toward the stack, place labels on the side facing the antenna, avoid labels directly on metal or liquid containers.

## Test 2 — Realistic loading + manual comparison (target ≥ 90 %, time saved)

1. Create a route for the vehicle with all test parcels (Admin → Routes → Plan route).
2. **Manual baseline:** the driver opens *Verify load*, switches to **Manual check**, and ticks each parcel by reading its label. The app times it.
3. Unload, reload normally, then run **Verify load** in RFID mode (also timed).
4. Log a *Realistic loading* trial with tagged/detected and both times.

## Test 3 — Alert drills (target 100 % caught, < 10 s)

Run each drill 3 times; note how many alerts appeared, how long they took, and any false alarms.

| Drill | How | Expected alert |
|---|---|---|
| Missing parcel | Leave one manifest parcel on the hub shelf, run *Verify load* | **Missing parcel** (critical) |
| Wrong vehicle | Put a parcel assigned to another vehicle into this one | **Wrong vehicle** (warning) |
| Unauthorized removal | Route started, vehicle parked away from any stop, remove a parcel | **Unauthorized removal** (critical) |
| Delivery mismatch | Driver confirms delivery while the parcel is still in the cargo | **Delivery mismatch** (warning), confirmation blocked |

Latency for each alert is shown on the Alerts page and in the CSV export (`latencySec` column).

## Test 4 — Live route (adoption evidence)

With the partner's permission: run a short real route (5–10 stops). Record deliveries verified by RFID + driver, any alerts and how they were resolved, and the partner's feedback. Export the audit trail CSV as evidence.

## After each session

- Admin → Pilot report → **Log a trial** for every test run
- Export Alerts and Audit-trail CSVs and keep them with photos/video
- Tick the adoption milestones as they happen
- Use **Print / PDF** on the Pilot report for the partner testimonial pack and competition submissions

## Honesty rules for the write-up

- Report every run, including failed ones, and explain fixes made between runs.
- State the sample size (number of parcels, number of runs) next to every percentage.
- Never present demo-dataset or simulator numbers as pilot results. The simulator is for demonstrations and software testing only.
