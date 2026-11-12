/**
 * SmartRoute Guardian — parcel verification engine.
 *
 * Pure logic, no Firebase. Used by the in-browser device simulator and
 * mirrored 1:1 by the Raspberry Pi gateway (device/smartroute_gateway/engine.py).
 *
 *   RFID inventory rounds ──► PresenceTracker ──► arrivals / departures
 *                                                     │
 *               vehicle + route + GPS context ───────►│
 *                                                     ▼
 *                                             Decision[] (what happened)
 *
 * A separate writer turns decisions into Firestore updates, audit events
 * and alerts.
 */
import type { GeoPoint, ParcelStatus, RouteStatus } from "./types";

export interface EngineParcel {
  id: string;
  epc: string;
  trackingId: string;
  vehicleId?: string | null;
  routeId?: string | null;
  status: ParcelStatus;
  inVehicleId?: string | null;
  lat: number;
  lng: number;
}

export interface EngineContext {
  vehicleId: string;
  /** Status of the vehicle's active route, or null when it has none. */
  routeStatus: RouteStatus | null;
  location: GeoPoint | null;
  parcelsByEpc: Map<string, EngineParcel>;
  geofenceM: number;
}

export type Decision =
  | { kind: "loaded"; parcel: EngineParcel; at: number }
  | { kind: "present"; parcel: EngineParcel; at: number }
  | { kind: "redetected"; parcel: EngineParcel; at: number }
  | { kind: "wrong_vehicle"; parcel: EngineParcel; at: number }
  | { kind: "unknown_tag"; epc: string; at: number }
  | { kind: "delivered_but_present"; parcel: EngineParcel; at: number }
  | { kind: "unloaded_at_hub"; parcel: EngineParcel; at: number; lastSeen: number }
  | { kind: "left_at_stop"; parcel: EngineParcel; at: number; lastSeen: number; distanceM: number }
  | { kind: "wrong_stop"; parcel: EngineParcel; at: number; lastSeen: number; nearParcel: EngineParcel; distanceM: number }
  | { kind: "unauthorized_removal"; parcel: EngineParcel; at: number; lastSeen: number; distanceM: number | null }
  | { kind: "wrong_vehicle_cleared"; parcel: EngineParcel; at: number; lastSeen: number };

export type DecisionKind = Decision["kind"];

/* ------------------------------------------------------------------ geo */

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres (haversine). */
export function distanceM(a: GeoPoint, b: GeoPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ------------------------------------------------------------- presence */

/**
 * Debounces raw RFID reads into stable presence.
 * A tag "arrives" the first time it is read and "departs" once it has not
 * been read for `absenceTimeoutMs` — this tolerates the read misses that are
 * normal for UHF RFID (tags shadowed by other parcels, metal, water, angle).
 */
export class PresenceTracker {
  private lastSeen = new Map<string, number>();

  constructor(public absenceTimeoutMs = 6000) {}

  ingest(epcs: Iterable<string>, now: number): { arrived: string[]; departed: { epc: string; lastSeen: number }[] } {
    const arrived: string[] = [];
    for (const raw of epcs) {
      const epc = normalizeEpc(raw);
      if (!epc) continue;
      if (!this.lastSeen.has(epc)) arrived.push(epc);
      this.lastSeen.set(epc, now);
    }
    const departed: { epc: string; lastSeen: number }[] = [];
    for (const [epc, seen] of this.lastSeen) {
      if (now - seen > this.absenceTimeoutMs) {
        departed.push({ epc, lastSeen: seen });
        this.lastSeen.delete(epc);
      }
    }
    return { arrived, departed };
  }

  present(): string[] {
    return [...this.lastSeen.keys()].sort();
  }

  has(epc: string): boolean {
    return this.lastSeen.has(normalizeEpc(epc));
  }

  reset(): void {
    this.lastSeen.clear();
  }
}

export function normalizeEpc(raw: string): string {
  return raw.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

/* ------------------------------------------------------------ decisions */

const DONE: ParcelStatus[] = ["delivered", "returned"];

export function decideArrival(epc: string, ctx: EngineContext, now: number): Decision[] {
  const parcel = ctx.parcelsByEpc.get(epc);
  if (!parcel) return [{ kind: "unknown_tag", epc, at: now }];

  if (parcel.vehicleId !== ctx.vehicleId) return [{ kind: "wrong_vehicle", parcel, at: now }];

  if (DONE.includes(parcel.status)) return [{ kind: "delivered_but_present", parcel, at: now }];

  if (parcel.status === "registered" || parcel.status === "assigned") return [{ kind: "loaded", parcel, at: now }];

  if (parcel.status === "exception") return [{ kind: "redetected", parcel, at: now }];

  // loaded / in_transit: if it had been taken out (e.g. customer not home) and
  // put back, clear the "left at stop" marker; otherwise just refresh presence.
  if (parcel.inVehicleId !== ctx.vehicleId) return [{ kind: "redetected", parcel, at: now }];
  return [{ kind: "present", parcel, at: now }];
}

export function decideDeparture(
  epc: string,
  lastSeen: number,
  ctx: EngineContext,
  now: number,
  routeParcels: EngineParcel[] = [],
): Decision[] {
  const parcel = ctx.parcelsByEpc.get(epc);
  if (!parcel) return [];

  if (parcel.vehicleId !== ctx.vehicleId) return [{ kind: "wrong_vehicle_cleared", parcel, at: now, lastSeen }];

  if (DONE.includes(parcel.status)) return [];

  if (ctx.routeStatus !== "in_progress") return [{ kind: "unloaded_at_hub", parcel, at: now, lastSeen }];

  if (!ctx.location) return [{ kind: "unauthorized_removal", parcel, at: now, lastSeen, distanceM: null }];

  const own = distanceM(ctx.location, parcel);
  if (own <= ctx.geofenceM) return [{ kind: "left_at_stop", parcel, at: now, lastSeen, distanceM: own }];

  // Removed at somebody else's stop → likely handed to the wrong customer.
  let best: { p: EngineParcel; d: number } | null = null;
  for (const p of routeParcels) {
    if (p.id === parcel.id || DONE.includes(p.status)) continue;
    const d = distanceM(ctx.location, p);
    if (d <= ctx.geofenceM && (!best || d < best.d)) best = { p, d };
  }
  if (best) return [{ kind: "wrong_stop", parcel, at: now, lastSeen, nearParcel: best.p, distanceM: best.d }];

  return [{ kind: "unauthorized_removal", parcel, at: now, lastSeen, distanceM: own }];
}

/* -------------------------------------------------------- load checking */

export interface LoadCheckResult<P extends EngineParcel = EngineParcel> {
  expected: number;
  detected: number;
  missing: P[];
  extraEpcs: string[];
  passed: boolean;
  /** Detection rate for this manifest, 0–100. */
  rate: number;
}

/**
 * Compares the route manifest with what the RFID reader currently sees.
 * Parcels already delivered/returned are excluded from the expectation.
 */
export function checkLoad<P extends EngineParcel>(manifest: P[], presentEpcs: Iterable<string>): LoadCheckResult<P> {
  const present = new Set([...presentEpcs].map(normalizeEpc));
  const expected = manifest.filter((p) => !DONE.includes(p.status));
  const expectedEpcs = new Set(expected.map((p) => normalizeEpc(p.epc)));
  const missing = expected.filter((p) => !present.has(normalizeEpc(p.epc)));
  const extraEpcs = [...present].filter((e) => !expectedEpcs.has(e));
  const detected = expected.length - missing.length;
  return {
    expected: expected.length,
    detected,
    missing,
    extraEpcs,
    passed: missing.length === 0 && extraEpcs.length === 0,
    rate: expected.length ? Math.round((detected / expected.length) * 1000) / 10 : 100,
  };
}

/* ---------------------------------------------------- alert vocabulary */

export const ALERT_META = {
  missing_parcel: { label: "Missing parcel", severity: "critical" },
  unauthorized_removal: { label: "Unauthorized removal", severity: "critical" },
  wrong_vehicle: { label: "Wrong vehicle", severity: "warning" },
  delivery_mismatch: { label: "Delivery mismatch", severity: "warning" },
  unknown_tag: { label: "Unknown tag", severity: "info" },
  reader_offline: { label: "Reader offline", severity: "warning" },
} as const;
