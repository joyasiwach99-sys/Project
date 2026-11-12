# SmartRoute Guardian — System Architecture

> RFID-tagged parcel → CHAFON CF591 UHF reader → Raspberry Pi 4 gateway → Firebase Firestore → admin dashboard + driver app + public tracking.

```
 ┌──────────────┐  UHF 865–867 MHz   ┌──────────────────┐ USB/serial ┌──────────────────────────┐
 │ Parcel + EPC │ ─────────────────► │ CHAFON CF591     │ ─────────► │ Raspberry Pi 4           │
 │ RFID label   │                    │ UHF RFID reader  │            │  smartroute_gateway      │
 └──────────────┘                    └──────────────────┘            │  • presence debounce     │
                                     ┌──────────────────┐  UART      │  • verification engine   │
                                     │ GPS (NEO-6M)     │ ─────────► │  • offline queue         │
                                     └──────────────────┘            └────────────┬─────────────┘
                                                                                  │ HTTPS (Firestore REST,
                                                                                  │ Firebase Auth device account)
                                                                                  ▼
                       ┌──────────────────────────── Firebase project `project-e0bb4` ─────────────────────┐
                       │  Auth (email/password, role in users/{uid})   Firestore (rules-enforced)          │
                       │  Hosting: https://project-e0bb4.web.app                                           │
                       └───────────────┬──────────────────────────────┬────────────────────┬──────────────┘
                                       ▼                              ▼                    ▼
                           Admin / operations console        Driver app (mobile)    Public tracking page
```

The **same verification semantics** run in two places:

| Where | Code | Used for |
|---|---|---|
| Raspberry Pi gateway | `device/smartroute_gateway/engine.py` | Real vehicles / pilot |
| Browser simulator | `src/lib/verification.ts` + `src/lib/gateway.ts` | Demos, testing without hardware |

`src/lib/verification.test.ts` and `device/tests/test_engine.py` cover the same scenarios.

---

## 1. Roles

| Role | Who | Can |
|---|---|---|
| `admin` | Operations manager (Joya during the pilot) | Everything |
| `viewer` | Reviewers, judges, pilot partners | Read every dashboard, write nothing |
| `driver` | Delivery driver | Read; act only on their own vehicle + route (verify load, confirm delivery, resolve alerts, share phone GPS, message dispatch) |
| `device` | Raspberry Pi gateway (one Firebase Auth account per vehicle) | Write presence/location for its own vehicle, lifecycle of parcels on its manifest, raise/resolve alerts for its vehicle, append audit events, heartbeat its `devices/{id}` doc |
| `pending` | Someone who signed up | Nothing until an admin approves |

Rules: `firestore.rules`. The audit trail is **append-only** and non-admin writers must stamp `createdAt` with the server clock.

---

## 2. Collections

Field-level types are in `src/lib/types.ts`. Summary:

| Collection | Doc id | Purpose |
|---|---|---|
| `users/{uid}` | Firebase Auth uid | name, email, phone, `role`, `vehicleId` (driver/device), `deviceId` (device) |
| `vehicles/{id}` | e.g. `VAN-01` | name, plate, capacity, `driverId`, `deviceId`, `status` (`idle·loading·en_route·returning·offline`), `location {lat,lng,speedKmh,heading,source,updatedAt}`, `activeRouteId`, **`presentEpcs[]`** (what RFID sees right now), `presentCount`, `lastScanAt`, `readerOnline` |
| `parcels/{id}` | auto | `trackingId`, **`epc`** (24 hex chars), recipient, address, `lat/lng` (destination), `status` (`registered·assigned·loaded·in_transit·delivered·exception·returned`), **`vehicleId`** (manifest — where it *should* be), **`inVehicleId`** (where RFID *detects* it), `lastSeenAt`, `loadedAt`, `leftVehicleAt`, `deliveredAt`, `deliveryProof` |
| `routes/{id}` | auto | `code`, `date`, `vehicleId`, `driverId`, `status` (`planned·loading·in_progress·completed·cancelled`), ordered `parcelIds[]`, `stopCount`, `deliveredCount`, `hub`, `loadVerification`, `startedAt`, `completedAt` |
| `events/{id}` | auto | Audit trail: `type`, `message`, `vehicleId`, `parcelId`, `trackingId`, `routeId`, `alertId`, `epc`, `actor {type,id,name}`, `location`, `deviceTime`, `createdAt` (server) |
| `alerts/{id}` | auto | `type`, `severity`, `status` (`open·acknowledged·resolved`), `title`, `message`, `vehicleId`, `parcelId`, `trackingId`, `routeId`, `epc`, `location`, **`detectedAt`** (physical time), **`createdAt`** (server), ack/resolve fields, `source` |
| `devices/{id}` | e.g. `RDR-01` | `vehicleId`, `model`, `firmware`, `lastHeartbeat`, `stats {readsPerMin, uniqueTags, cpuTempC, uptimeSec, queueDepth}`, `config {txPowerDbm, absenceTimeoutSec, geofenceM, heartbeatSec}` |
| `messages/{id}` | auto | `threadId` (= driver uid), `fromId`, `fromName`, `fromRole`, `text`, `createdAt` |
| `pilotTrials/{id}` | auto | Pilot test runs: scenario, parcels tagged/detected, alerts expected/raised/false, latency, manual vs RFID check time, `isSample` |
| `settings/system` | fixed | thresholds + pilot targets + hub |
| `publicTracking/{trackingId}` | tracking id | Customer-safe mirror: status, area, recipient initials, timeline. Public `get` only (no listing). |

**Alert latency** = `createdAt − detectedAt`. For a removal, `detectedAt` is the last RFID read of the tag, so latency includes the absence timeout + network. Pilot target: **< 10 s**.

---

## 3. Verification engine

### 3.1 Presence

Each inventory round (~1 s) yields a set of EPCs. `PresenceTracker`:

- **arrival** — EPC read and not currently present
- **departure** — EPC not read for `absenceTimeoutSec` (default **6 s**); emitted with `lastSeen`

The debounce is what makes UHF RFID usable in a cargo area: tags are routinely missed for a round or two when shadowed by other parcels.

### 3.2 Decisions

Context: `vehicleId`, active route status, current GPS fix, parcels indexed by EPC, `geofenceM` (default **150 m**).

**On arrival of EPC `e`:**

| Condition | Decision |
|---|---|
| EPC not registered | `unknown_tag` |
| `parcel.vehicleId ≠ this vehicle` | `wrong_vehicle` |
| parcel `delivered`/`returned` | `delivered_but_present` |
| parcel `registered`/`assigned` | `loaded` |
| parcel `exception` | `redetected` |
| parcel `loaded`/`in_transit` but `inVehicleId ≠ this vehicle` | `redetected` |
| otherwise | `present` |

**On departure of EPC `e` (last read at `lastSeen`):**

| Condition | Decision |
|---|---|
| EPC not registered | — |
| `parcel.vehicleId ≠ this vehicle` | `wrong_vehicle_cleared` |
| parcel `delivered`/`returned` | — |
| route not `in_progress` (at the hub) | `unloaded_at_hub` |
| no GPS fix | `unauthorized_removal` (distance null) |
| within `geofenceM` of the parcel's own destination | `left_at_stop` |
| within `geofenceM` of another undelivered stop on the route | `wrong_stop` |
| otherwise | `unauthorized_removal` |

### 3.3 What each decision writes

`now` = server timestamp. `ts(x)` = client timestamp from epoch ms. "Status after load" = `in_transit` if the route is `in_progress`, else `loaded`. Every alert also writes an `alert_raised` event; every auto-resolve writes `alert_resolved`.

| Decision | `parcels/{id}` update | Event | Alert |
|---|---|---|---|
| `loaded` | `status`=status-after-load, `inVehicleId`=me, `lastSeenAt`, `loadedAt`=ts(at) | `parcel_loaded` | — |
| `present` | `inVehicleId`=me, `lastSeenAt` (only if `inVehicleId` changed) | — | — |
| `redetected` | `status`=status-after-load, `inVehicleId`=me, `lastSeenAt`, `leftVehicleAt`=null | `note` "re-detected" | auto-resolve open `unauthorized_removal`/`delivery_mismatch` for this parcel+vehicle |
| `wrong_vehicle` | `inVehicleId`=me, `lastSeenAt` | — | `wrong_vehicle` (**warning**) |
| `unknown_tag` | — | — | `unknown_tag` (**info**), once per EPC per session |
| `delivered_but_present` | — | — | `delivery_mismatch` (**warning**): marked delivered but still in cargo |
| `unloaded_at_hub` | `status`=`assigned`, `inVehicleId`=null, `loadedAt`=null | `parcel_unloaded` | — |
| `left_at_stop` | `inVehicleId`=null, `leftVehicleAt`=ts(lastSeen) | `parcel_left_at_stop` | — |
| `wrong_stop` | `status`=`exception`, `inVehicleId`=null, `leftVehicleAt` | — | `delivery_mismatch` (**critical**): removed at another customer's stop |
| `unauthorized_removal` | `status`=`exception`, `inVehicleId`=null, `leftVehicleAt` | — | `unauthorized_removal` (**critical**) |
| `wrong_vehicle_cleared` | `inVehicleId`=null (only if it was me) | — | auto-resolve open `wrong_vehicle` for this parcel+vehicle |

Customer tracking (`publicTracking`): the browser simulator also marks the customer page "exception" on `wrong_stop`/`unauthorized_removal` and restores it on `redetected`; the Pi gateway currently updates it on load only. Drivers and gateways may change only `status`, `timeline`, `updatedAt` there.

After every round where the present set changed: `vehicles/{me}` ← `presentEpcs`, `presentCount`, `lastScanAt`, `readerOnline: true`.

Alert de-duplication: never open a second alert with the same `(vehicleId, parcelId|epc, type)` while one is `open`/`acknowledged`.

### 3.4 Load verification (driver "Verify Load")

`checkLoad(manifest, vehicle.presentEpcs)` → `missing[]`, `extraEpcs[]`, `rate`. Pass = nothing missing and nothing extra.

- Pass → `routes/{id}.loadVerification`, `loadVerifiedAt`, event `load_verified`. Driver may start the route.
- Fail → one `missing_parcel` (**critical**) alert per missing parcel, event `load_check_failed`. Admin can override.

### 3.5 Delivery confirmation (driver)

- If the parcel's EPC is still in `vehicle.presentEpcs` and the reader is online → **blocked**, raise `delivery_mismatch` ("driver confirmed delivery but RFID still detects the parcel in the cargo").
- Otherwise → `status=delivered`, `deliveredAt`, `deliveryProof.method = "rfid+driver"` when RFID saw it leave (`leftVehicleAt` set), else `"driver"`. Event `parcel_delivered`, `publicTracking` timeline updated, `routes.deliveredCount++`.

---

## 4. Device gateway ↔ Firebase

- Authenticates as a **device account** (`device-van01@smartroute.demo` etc.) through the Firebase Auth REST API (`accounts:signInWithPassword`, refresh via `securetoken.googleapis.com`).
- Talks to Firestore through the REST API (`projects/project-e0bb4/databases/(default)/documents`) with the ID token, so **the same security rules apply to the hardware** as to people.
- Writes are queued locally (SQLite) and retried, so a vehicle driving through a dead zone loses nothing; `deviceTime`/`detectedAt` preserve when things physically happened.
- Heartbeat every `heartbeatSec` (15 s) to `devices/{id}.lastHeartbeat`; dashboards mark a reader offline after `offlineAfterSec` (45 s).

---

## 5. Front-end map

| Area | Route | Roles |
|---|---|---|
| Project website | `/` | public |
| Customer tracking | `/track/:trackingId?` | public |
| Sign in / sign up / pending | `/login`, `/signup`, `/pending` | public |
| Operations overview | `/admin` | admin, viewer |
| Fleet map | `/admin/map` | admin, viewer |
| Vehicles + vehicle detail | `/admin/vehicles`, `/admin/vehicles/:id` | admin, viewer |
| Parcels + parcel detail | `/admin/parcels`, `/admin/parcels/:id` | admin, viewer |
| Routes / dispatch | `/admin/routes` | admin, viewer |
| Exception alerts | `/admin/alerts` | admin, viewer |
| Audit trail | `/admin/audit` | admin, viewer |
| Analytics | `/admin/analytics` | admin, viewer |
| Pilot report | `/admin/pilot` | admin, viewer |
| RFID readers | `/admin/devices` | admin, viewer |
| People & roles | `/admin/people` | admin, viewer |
| Messages | `/admin/messages` | admin, viewer |
| Device simulator | `/admin/simulator` | admin |
| Settings + demo data | `/admin/settings` | admin |
| Driver app | `/driver`, `/driver/load`, `/driver/stops`, `/driver/alerts`, `/driver/messages`, `/driver/profile` | driver (admin/viewer can preview any vehicle) |
