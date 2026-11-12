# SmartRoute Guardian

**RFID-verified last-mile logistics intelligence** — a low-cost, retrofit-friendly system that confirms the right parcels are in the right vehicle at the right time. Built by **Joya Siwach**.

Each parcel carries a UHF RFID label. A Raspberry Pi 4 with a CHAFON CF591 reader in each delivery vehicle continuously checks which parcels are in the cargo area, compares that with the route manifest and GPS position, and raises alerts in seconds when a parcel is missing, in the wrong vehicle, removed away from its stop, or "delivered" while still on board.

```
RFID-tagged parcel → CF591 reader → Raspberry Pi 4 gateway → Firebase Firestore → dashboards
                                     (+ GPS module)                              ├ Admin / operations console
                                                                                 ├ Driver app (mobile)
                                                                                 └ Public parcel tracking
```

- **Live site:** https://project-e0bb4.web.app (Firebase project `project-e0bb4`)
- **Explore without an account:** “Explore as a reviewer” on the sign-in page — a read-only role enforced by the security rules.

## What's in this repository

| Path | What |
|---|---|
| `src/pages/public` | Project website, customer tracking, sign-in/up |
| `src/pages/admin` | Operations console: overview, fleet map, vehicles, parcels, routes & dispatch, exception alerts, audit trail, analytics, pilot report, RFID readers, people & roles, messages, device simulator, settings |
| `src/pages/driver` | Mobile driver app: Start route → Verify load → Drive route → Confirm delivery → Resolve alert |
| `src/lib/verification.ts` | The verification engine (presence debounce + decision rules) — unit-tested |
| `src/lib/gateway.ts`, `src/lib/actions.ts` | Every Firestore write, batched and rule-compliant |
| `device/` | Raspberry Pi gateway (Python): CF591 reader driver, GPS, engine, offline queue, systemd service — see `device/README.md` and `device/HARDWARE.md` |
| `firestore.rules` | Role-based security rules (admin, viewer, driver, device, pending); append-only audit trail |
| `docs/ARCHITECTURE.md` | Data model, decision table, what each decision writes |
| `docs/PILOT_PROTOCOL.md` | How to run and record the pilot tests honestly |
| `scripts/` | Account/demo-data setup and the security-rules test suite |

## Quick start (local)

```bash
npm install
npm run dev                # http://localhost:5173 — uses the live Firebase project
```

### Fully local, with emulators (recommended for development)

```bash
firebase emulators:start --only auth,firestore             # terminal 1
SRG_EMULATOR=1 npx vite-node scripts/setup-demo.ts --seed  # accounts + demo dataset
VITE_USE_EMULATORS=true npm run dev                        # terminal 2
npm run test:rules                                          # 28 security-rule checks
```

Passwords for generated accounts are written to `demo-accounts.emulator.local.json` (git-ignored).

## Accounts and roles

| Role | Can | Demo account |
|---|---|---|
| Admin | Everything | `admin@smartroute.demo` (password in `demo-accounts.local.json`) |
| Viewer | Read every dashboard | `reviewer@smartroute.demo` / `Reviewer#2026` (public, read-only) |
| Driver | Act on own vehicle/route only | `driver@smartroute.demo` → VAN-01 |
| Device | One per Raspberry Pi, scoped to its vehicle | `device-van01…04@smartroute.demo` |
| Pending | Nothing until approved | anyone who signs up |

New sign-ups appear under **Admin → People** for approval. To bootstrap a different first admin, add the email to `bootstrapAdmin()` in `firestore.rules`.

## Deploying (Firebase project `project-e0bb4`)

```bash
npm run deploy:backend        # enable Email/Password auth, deploy rules + indexes
npm run setup:seed            # create accounts + load the demo dataset (optional)
npm run deploy                # build and deploy the website to Firebase Hosting
```

## Demo without hardware

**Admin → Device simulator** runs the same verification engine as the Raspberry Pi, in the browser: move tags in and out of the cargo area, drive the van between stops, and watch alerts, the fleet map and the driver app react in real time. A suggested demo script is on that page.

## Tests

```bash
npm test                 # verification engine unit tests (vitest)
npm run test:rules       # Firestore security rules against the emulator
cd device && .venv/bin/python -m pytest -q   # gateway tests
```

## Data honesty

The demo dataset is simulated and clearly flagged: a banner on every dashboard says so, and sample pilot trials are labelled **SAMPLE**. Before running the real pilot, clear it from **Admin → Settings**. Pilot numbers should only come from the protocol in `docs/PILOT_PROTOCOL.md`.

## Tech

React 18 · TypeScript · Vite · Tailwind CSS · Firebase Auth + Firestore + Hosting · Leaflet/OpenStreetMap · Recharts · Python 3 (gateway).
