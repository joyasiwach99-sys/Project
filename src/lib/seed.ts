/**
 * Demo dataset for SmartRoute Guardian (Gurugram pilot scenario).
 *
 * Deterministic (seeded PRNG) so every reset looks the same. Every document
 * is flagged `demo: true` and settings/system.demoDataLoadedAt is set, which
 * puts a "simulated data" banner on the dashboards. Reset removes it all.
 *
 * Takes the Firestore instance as a parameter so it runs both in the browser
 * (Settings → Load demo dataset) and from Node (scripts/setup-demo.ts).
 */
import { Timestamp, collection, deleteField, doc, getDocs, limit, query, setDoc, writeBatch, type Firestore } from "firebase/firestore";
import { format, subDays } from "date-fns";
import type { Actor, Alert, AlertType, AuditEvent, EventType, Hub, Parcel, PublicTimelineEntry, Route } from "./types";

/* ------------------------------------------------------------ helpers */

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HUB: Hub = { name: "SmartRoute Hub · Udyog Vihar, Gurugram", lat: 28.5011, lng: 77.0838 };

const AREAS: [string, number, number][] = [
  ["DLF Phase 3", 28.4925, 77.0937],
  ["Cyber City", 28.4951, 77.0889],
  ["Sector 29", 28.4686, 77.064],
  ["MG Road", 28.4798, 77.0802],
  ["Sector 14", 28.4723, 77.0444],
  ["Palam Vihar", 28.5094, 77.03],
  ["Sector 56", 28.423, 77.1015],
  ["Golf Course Road", 28.4376, 77.1009],
  ["Sohna Road", 28.4131, 77.0463],
  ["South City 1", 28.4569, 77.0581],
  ["Sushant Lok 1", 28.4622, 77.0778],
  ["DLF Phase 1", 28.4718, 77.0956],
  ["Sector 45", 28.443, 77.064],
  ["Sector 23", 28.5129, 77.0614],
  ["Nirvana Country", 28.4161, 77.0656],
  ["Sector 31", 28.4519, 77.0503],
  ["DLF Phase 4", 28.4652, 77.086],
  ["Ardee City", 28.439, 77.079],
];

const FIRST = ["Aarav", "Ananya", "Vihaan", "Diya", "Kabir", "Ishita", "Reyansh", "Meera", "Arjun", "Saanvi", "Rohan", "Kavya", "Aditya", "Tara", "Nikhil", "Pooja", "Siddharth", "Riya", "Karan", "Neha", "Yash", "Aisha", "Dev", "Simran"];
const LAST = ["Sharma", "Verma", "Gupta", "Mehta", "Kapoor", "Malhotra", "Bansal", "Chopra", "Yadav", "Singh", "Jain", "Arora", "Khanna", "Saini", "Dahiya", "Rathi", "Nair", "Iyer"];
const BUILDINGS = ["Tower A", "Tower C", "Block B", "Villa", "House", "Flat", "Shop", "Office"];

const VEHICLES = [
  { id: "VAN-01", name: "Tata Ace Gold", plate: "HR 26 EX 4471", type: "mini_truck", capacity: 40, device: "RDR-01" },
  { id: "VAN-02", name: "Mahindra Supro Van", plate: "HR 26 FB 2093", type: "van", capacity: 45, device: "RDR-02" },
  { id: "VAN-03", name: "Maruti Eeco Cargo", plate: "HR 26 DK 7718", type: "van", capacity: 35, device: "RDR-03" },
  { id: "VAN-04", name: "Ashok Leyland Dost", plate: "HR 26 GC 1155", type: "mini_truck", capacity: 50, device: "RDR-04" },
] as const;

const DEMO_DRIVERS = [
  { id: "demo-driver-01", name: "Arjun Dahiya", phone: "+91 98110 21001", vehicle: "VAN-01" },
  { id: "demo-driver-02", name: "Priya Rathi", phone: "+91 98110 21002", vehicle: "VAN-02" },
  { id: "demo-driver-03", name: "Rahul Saini", phone: "+91 98110 21003", vehicle: "VAN-03" },
  { id: "demo-driver-04", name: "Sneha Yadav", phone: "+91 98110 21004", vehicle: "VAN-04" },
];

type Doc = { path: string; data: Record<string, unknown> };

class Batcher {
  private ops: Doc[] = [];
  constructor(private db: Firestore) {}
  set(path: string, data: Record<string, unknown>) {
    this.ops.push({ path, data });
  }
  get size() {
    return this.ops.length;
  }
  async commit(onProgress?: (done: number, total: number) => void) {
    const total = this.ops.length;
    for (let i = 0; i < total; i += 400) {
      const chunk = this.ops.slice(i, i + 400);
      const b = writeBatch(this.db);
      for (const op of chunk) b.set(doc(this.db, op.path), op.data, { merge: true });
      try {
        await b.commit();
      } catch (e) {
        // Find the exact document the rules rejected so the error is actionable.
        for (const op of chunk) {
          try {
            await setDoc(doc(this.db, op.path), op.data, { merge: true });
          } catch (inner) {
            throw new Error(`Write rejected for ${op.path}: ${(inner as Error).message}`);
          }
        }
        throw e;
      }
      onProgress?.(Math.min(i + 400, total), total);
    }
  }
}

/* -------------------------------------------------------- generation */

export interface SeedOptions {
  actor: Actor;
  /** Real driver account to put in VAN-01 instead of the profile-only demo driver. */
  driverUid?: string | null;
  now?: number;
  onProgress?: (done: number, total: number) => void;
}

export async function seedDemoData(db: Firestore, opts: SeedOptions): Promise<{ docs: number }> {
  const rnd = mulberry32(20261112);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const now = opts.now ?? Date.now();
  const ts = (ms: number) => Timestamp.fromMillis(Math.round(ms));
  const W = new Batcher(db);
  const ids = { n: 0 };
  const autoId = (prefix: string) => `${prefix}-${(ids.n++).toString(36).padStart(4, "0")}-${Math.floor(rnd() * 1e9).toString(36)}`;
  const usedTracking = new Set<string>();
  const ALPH = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const tracking = () => {
    let t = "";
    do t = `SRG-${Array.from({ length: 6 }, () => ALPH[Math.floor(rnd() * ALPH.length)]).join("")}`;
    while (usedTracking.has(t));
    usedTracking.add(t);
    return t;
  };
  const epc = () => `E280${Array.from({ length: 20 }, () => "0123456789ABCDEF"[Math.floor(rnd() * 16)]).join("")}`;
  const driverFor = (vid: string) => (vid === "VAN-01" && opts.driverUid ? opts.driverUid : DEMO_DRIVERS.find((d) => d.vehicle === vid)!.id);
  const devActor = (vid: string): Actor => {
    const v = VEHICLES.find((x) => x.id === vid)!;
    return { type: "device", id: v.device, name: `Reader ${v.device} (${vid})` };
  };

  /* ---- settings, vehicles, devices, people ---- */
  W.set("settings/system", {
    absenceTimeoutSec: 6,
    geofenceM: 150,
    heartbeatSec: 15,
    offlineAfterSec: 45,
    targetStaticDetection: 95,
    targetLoadingDetection: 90,
    targetLatencySec: 10,
    targetParcels: 40,
    hub: HUB,
    orgName: "SmartRoute Guardian Pilot",
    demoDataLoadedAt: ts(now),
  });
  for (const d of DEMO_DRIVERS) {
    if (d.vehicle === "VAN-01" && opts.driverUid) continue;
    W.set(`users/${d.id}`, { name: d.name, email: "", phone: d.phone, role: "driver", vehicleId: d.vehicle, active: true, demo: true, createdAt: ts(now - 30 * 864e5), updatedAt: ts(now) });
  }
  if (opts.driverUid) W.set(`users/${opts.driverUid}`, { vehicleId: "VAN-01", updatedAt: ts(now) });

  const events: Omit<AuditEvent, "id">[] = [];
  const ev = (type: EventType, at: number, message: string, actor: Actor, extra: Partial<AuditEvent> = {}) =>
    events.push({ type, message, actor, vehicleId: null, parcelId: null, trackingId: null, routeId: null, alertId: null, epc: null, location: null, deviceTime: ts(at), createdAt: ts(at + 600), demo: true, ...extra });

  const alerts: (Omit<Alert, "id"> & { id: string })[] = [];
  const parcels: (Omit<Parcel, "id"> & { id: string })[] = [];
  const routes: (Omit<Route, "id"> & { id: string })[] = [];
  const timelines = new Map<string, PublicTimelineEntry[]>();
  const tl = (tid: string, status: PublicTimelineEntry["status"], label: string, at: number, rfid = false) => {
    const xs = timelines.get(tid) ?? [];
    xs.push({ status, label, at: ts(at), rfidVerified: rfid });
    timelines.set(tid, xs);
  };

  const makeParcel = (createdAt: number, over: Partial<Parcel> = {}) => {
    const [area, alat, alng] = pick(AREAS);
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const p: Omit<Parcel, "id"> & { id: string } = {
      id: autoId("p"),
      trackingId: tracking(),
      epc: epc(),
      recipientName: name,
      recipientPhone: `+91 9${int(100000000, 999999999)}`,
      address: `${pick(BUILDINGS)} ${int(1, 40)}${rnd() > 0.5 ? `, Flat ${int(101, 1904)}` : ""}, ${area}`,
      area,
      city: "Gurugram",
      lat: +(alat + (rnd() - 0.5) * 0.008).toFixed(6),
      lng: +(alng + (rnd() - 0.5) * 0.008).toFixed(6),
      weightKg: +(0.3 + rnd() * 6).toFixed(1),
      size: pick(["S", "M", "M", "L"] as const),
      priority: rnd() > 0.82 ? "express" : "standard",
      status: "registered",
      vehicleId: null,
      routeId: null,
      stopSeq: null,
      inVehicleId: null,
      lastSeenAt: null,
      loadedAt: null,
      leftVehicleAt: null,
      deliveredAt: null,
      deliveryProof: null,
      demo: true,
      createdAt: ts(createdAt),
      updatedAt: ts(createdAt),
      ...over,
    };
    tl(p.trackingId, "registered", "Parcel registered and RFID-tagged at the hub", createdAt);
    parcels.push(p);
    return p;
  };

  const order = (ps: typeof parcels) => {
    const left = [...ps];
    const out: typeof parcels = [];
    let cur = { lat: HUB.lat, lng: HUB.lng };
    while (left.length) {
      let bi = 0;
      let bd = Infinity;
      left.forEach((p, i) => {
        const d = (p.lat - cur.lat) ** 2 + (p.lng - cur.lng) ** 2;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      const n = left.splice(bi, 1)[0]!;
      out.push(n);
      cur = n;
    }
    return out;
  };

  const addAlert = (a: Partial<Alert> & { type: AlertType; vehicleId: string; createdAtMs: number; latencySec: number; resolvedAfterMin?: number | null; ack?: boolean }) => {
    const id = autoId("a");
    const created = a.createdAtMs;
    const detected = created - a.latencySec * 1000;
    const sev = a.severity ?? (a.type === "missing_parcel" || a.type === "unauthorized_removal" ? "critical" : a.type === "unknown_tag" ? "info" : "warning");
    const resolved = a.resolvedAfterMin != null ? created + a.resolvedAfterMin * 60000 : null;
    const admin: Actor = opts.actor;
    alerts.push({
      id,
      type: a.type,
      severity: sev,
      status: resolved ? "resolved" : a.ack ? "acknowledged" : "open",
      title: a.title ?? a.type.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
      message: a.message ?? "",
      vehicleId: a.vehicleId,
      parcelId: a.parcelId ?? null,
      trackingId: a.trackingId ?? null,
      routeId: a.routeId ?? null,
      epc: a.epc ?? null,
      location: a.location ?? null,
      detectedAt: ts(detected),
      createdAt: ts(created),
      acknowledgedAt: resolved || a.ack ? ts(created + 90_000) : null,
      acknowledgedBy: resolved || a.ack ? admin : null,
      resolvedAt: resolved ? ts(resolved) : null,
      resolvedBy: resolved ? admin : null,
      resolution: resolved ? a.resolution ?? "Resolved" : null,
      source: a.source ?? "device",
      demo: true,
    });
    ev("alert_raised", detected, `${a.title}: ${a.message}`, devActor(a.vehicleId), { vehicleId: a.vehicleId, parcelId: a.parcelId ?? null, trackingId: a.trackingId ?? null, routeId: a.routeId ?? null, alertId: id, location: a.location ?? null });
    if (resolved) ev("alert_resolved", resolved, `${admin.name} resolved “${a.title}”: ${a.resolution}`, admin, { vehicleId: a.vehicleId, parcelId: a.parcelId ?? null, trackingId: a.trackingId ?? null, alertId: id });
    return id;
  };

  /* ---- history: the last 6 days, completed routes ---- */
  for (let back = 6; back >= 1; back--) {
    const day = subDays(new Date(now), back);
    const dayKey = format(day, "yyyy-MM-dd");
    const dayStart = new Date(day).setHours(0, 0, 0, 0);
    const fleet = VEHICLES.filter((v) => v.id !== "VAN-04" || back % 2 === 0);
    fleet.forEach((v, vi) => {
      const n = int(6, 9);
      const created = dayStart + 7.5 * 3600e3 + vi * 600e3;
      const ps = order(Array.from({ length: n }, () => makeParcel(created - int(2, 20) * 3600e3)));
      const routeId = autoId("r");
      const driver = driverFor(v.id);
      const verifiedAt = dayStart + 9 * 3600e3 + vi * 420e3 + int(0, 600) * 1000;
      const missed = rnd() < 0.25 ? 1 : 0;
      const startedAt = verifiedAt + int(4, 12) * 60e3;
      let t = startedAt;
      let delivered = 0;
      ps.forEach((p, i) => {
        p.vehicleId = v.id;
        p.routeId = routeId;
        p.stopSeq = i + 1;
        tl(p.trackingId, "assigned", "Assigned to a delivery route", created);
        const loadedAt = verifiedAt - int(5, 25) * 60e3;
        p.loadedAt = ts(loadedAt);
        tl(p.trackingId, "loaded", "Loaded into the delivery vehicle — verified by RFID", loadedAt, true);
        ev("parcel_loaded", loadedAt, `${p.trackingId} loaded into ${v.id} (RFID)`, devActor(v.id), { vehicleId: v.id, parcelId: p.id, trackingId: p.trackingId, routeId, epc: p.epc });
        tl(p.trackingId, "out_for_delivery", "Out for delivery", startedAt);
        t += int(9, 26) * 60e3;
        const returned = rnd() < 0.04;
        const rfid = rnd() < 0.86;
        if (returned) {
          p.status = "returned";
          p.updatedAt = ts(t);
          tl(p.trackingId, "returned", "Customer unavailable — returned to hub", t);
          return;
        }
        delivered++;
        p.status = "delivered";
        p.deliveredAt = ts(t);
        p.lastSeenAt = ts(t - 60e3);
        if (rfid) p.leftVehicleAt = ts(t - 60e3);
        p.deliveryProof = {
          method: rfid ? "rfid+driver" : "driver",
          by: { type: "driver", id: driver, name: DEMO_DRIVERS.find((d) => d.vehicle === v.id)!.name },
          at: ts(t),
          receiverName: rnd() > 0.2 ? p.recipientName : `${pick(FIRST)} (family)`,
          location: { lat: p.lat, lng: p.lng },
        };
        p.updatedAt = ts(t);
        if (rfid) ev("parcel_left_at_stop", t - 60e3, `${p.trackingId} left ${v.id} at its destination — awaiting driver confirmation`, devActor(v.id), { vehicleId: v.id, parcelId: p.id, trackingId: p.trackingId, routeId, epc: p.epc, location: { lat: p.lat, lng: p.lng } });
        ev("parcel_delivered", t, `${p.trackingId} delivered to ${p.deliveryProof.receiverName} (${rfid ? "RFID + driver" : "driver only"})`, { type: "driver", id: driver, name: p.deliveryProof.by.name }, { vehicleId: v.id, parcelId: p.id, trackingId: p.trackingId, routeId, location: { lat: p.lat, lng: p.lng } });
        tl(p.trackingId, "delivered", rfid ? "Delivered — handover verified by RFID and driver" : "Delivered — confirmed by driver", t, rfid);
      });
      const drvActor: Actor = { type: "driver", id: driver, name: DEMO_DRIVERS.find((d) => d.vehicle === v.id)!.name };
      routes.push({
        id: routeId,
        code: `RT-${format(day, "MMdd")}-${v.id.slice(-2)}`,
        date: dayKey,
        vehicleId: v.id,
        driverId: driver,
        status: "completed",
        parcelIds: ps.map((p) => p.id),
        stopCount: n,
        deliveredCount: delivered,
        hub: HUB,
        loadVerification: { expected: n, detected: n - missed, missing: missed ? [ps[0]!.id] : [], extra: [], passed: !missed, at: ts(verifiedAt), by: drvActor, method: "rfid", durationSec: int(3, 9) },
        loadVerifiedAt: ts(verifiedAt + (missed ? 6 * 60e3 : 0)),
        startedAt: ts(startedAt),
        completedAt: ts(t + 25 * 60e3),
        demo: true,
        createdAt: ts(created),
        updatedAt: ts(t + 25 * 60e3),
      });
      ev("route_created", created, `Route RT-${format(day, "MMdd")}-${v.id.slice(-2)} created for ${v.id} with ${n} stops`, opts.actor, { vehicleId: v.id, routeId });
      ev(missed ? "load_check_failed" : "load_verified", verifiedAt, missed ? `Load check failed: 1 missing` : `Load verified: ${n}/${n} parcels detected (RFID)`, drvActor, { vehicleId: v.id, routeId });
      ev("route_started", startedAt, `${drvActor.name} started the route with ${n} stops`, drvActor, { vehicleId: v.id, routeId });
      ev("route_completed", t + 25 * 60e3, `Route completed: ${delivered}/${n} delivered`, drvActor, { vehicleId: v.id, routeId });
      if (missed) {
        const p = ps[0]!;
        addAlert({ type: "missing_parcel", vehicleId: v.id, parcelId: p.id, trackingId: p.trackingId, routeId, epc: p.epc, title: "Missing parcel", message: `${p.trackingId} is on the manifest but was not detected in ${v.id}.`, createdAtMs: verifiedAt + 800, latencySec: 0.8, resolvedAfterMin: int(4, 9), resolution: "Found at hub and loaded", source: "driver" });
      }
      // 0–2 device alerts per route per day, latency mostly 6.4–9.5 s (absence timeout + uplink)
      const k = rnd() < 0.55 ? int(1, 2) : 0;
      for (let j = 0; j < k; j++) {
        const type = pick(["wrong_vehicle", "wrong_vehicle", "delivery_mismatch", "unauthorized_removal", "unknown_tag"] as const);
        const p = pick(ps);
        const at = startedAt + int(10, 200) * 60e3;
        const lat = rnd() < 0.88 ? 6.3 + rnd() * 3.2 : 10 + rnd() * 3.5;
        const msg: Record<string, [string, string, string]> = {
          wrong_vehicle: ["Wrong vehicle", `${p.trackingId} was detected inside ${v.id} but is assigned elsewhere.`, "Moved to correct vehicle"],
          delivery_mismatch: ["Delivery mismatch", `${p.trackingId} is marked delivered but RFID still detects it inside ${v.id}.`, "Parcel handed over correctly"],
          unauthorized_removal: ["Unauthorized removal", `${p.trackingId} was removed from ${v.id} away from its destination.`, "Driver moved parcel within cargo"],
          unknown_tag: ["Unknown tag", `A tag not registered to any parcel was read inside ${v.id}.`, "Stray tag removed"],
        };
        const [title, message, resolution] = msg[type]!;
        addAlert({ type, vehicleId: v.id, parcelId: type === "unknown_tag" ? null : p.id, trackingId: type === "unknown_tag" ? null : p.trackingId, routeId, epc: type === "unknown_tag" ? epc() : p.epc, title, message, createdAtMs: at, latencySec: lat, resolvedAfterMin: int(3, 45), resolution, location: { lat: p.lat + 0.01, lng: p.lng - 0.008 } });
      }
    });
  }

  /* ---- today ---- */
  const today = format(new Date(now), "yyyy-MM-dd");
  const morning = new Date(now).setHours(0, 0, 0, 0) + 7.5 * 3600e3;
  const t0 = Math.min(morning, now - 4 * 3600e3);
  const todayRoute = (v: (typeof VEHICLES)[number], n: number) => {
    const ps = order(Array.from({ length: n }, () => makeParcel(t0 - int(1, 12) * 3600e3)));
    const routeId = autoId("r");
    ps.forEach((p, i) => {
      p.vehicleId = v.id;
      p.routeId = routeId;
      p.stopSeq = i + 1;
      p.status = "assigned";
      tl(p.trackingId, "assigned", "Assigned to a delivery route", t0);
    });
    ev("route_created", t0, `Route RT-${format(new Date(now), "MMdd")}-${v.id.slice(-2)} created for ${v.id} with ${n} stops`, opts.actor, { vehicleId: v.id, routeId });
    return { ps, routeId, code: `RT-${format(new Date(now), "MMdd")}-${v.id.slice(-2)}` };
  };
  const load = (v: (typeof VEHICLES)[number], p: (typeof parcels)[number], at: number, inTransit: boolean) => {
    p.status = inTransit ? "in_transit" : "loaded";
    p.inVehicleId = v.id;
    p.loadedAt = ts(at);
    p.lastSeenAt = ts(now - 2000);
    p.updatedAt = ts(at);
    tl(p.trackingId, "loaded", "Loaded into the delivery vehicle — verified by RFID", at, true);
    ev("parcel_loaded", at, `${p.trackingId} loaded into ${v.id} (RFID)`, devActor(v.id), { vehicleId: v.id, parcelId: p.id, trackingId: p.trackingId, routeId: p.routeId, epc: p.epc });
  };
  const deliver = (v: (typeof VEHICLES)[number], p: (typeof parcels)[number], at: number, rfid: boolean) => {
    const d = DEMO_DRIVERS.find((x) => x.vehicle === v.id)!;
    p.status = "delivered";
    p.inVehicleId = null;
    p.deliveredAt = ts(at);
    if (rfid) p.leftVehicleAt = ts(at - 50e3);
    p.deliveryProof = { method: rfid ? "rfid+driver" : "driver", by: { type: "driver", id: driverFor(v.id), name: d.name }, at: ts(at), receiverName: p.recipientName, location: { lat: p.lat, lng: p.lng } };
    p.updatedAt = ts(at);
    if (rfid) ev("parcel_left_at_stop", at - 50e3, `${p.trackingId} left ${v.id} at its destination — awaiting driver confirmation`, devActor(v.id), { vehicleId: v.id, parcelId: p.id, trackingId: p.trackingId, routeId: p.routeId, epc: p.epc, location: { lat: p.lat, lng: p.lng } });
    ev("parcel_delivered", at, `${p.trackingId} delivered to ${p.recipientName} (${rfid ? "RFID + driver" : "driver only"})`, { type: "driver", id: driverFor(v.id), name: d.name }, { vehicleId: v.id, parcelId: p.id, trackingId: p.trackingId, routeId: p.routeId, location: { lat: p.lat, lng: p.lng } });
    tl(p.trackingId, "delivered", rfid ? "Delivered — handover verified by RFID and driver" : "Delivered — confirmed by driver", at, rfid);
  };
  const [V1, V2, V3, V4] = VEHICLES;
  const vehicleState: Record<string, Record<string, unknown>> = {};

  // VAN-01: loading at the hub — 7 of 10 parcels already on board. Ready for the live demo.
  {
    const { ps, routeId, code } = todayRoute(V1, 10);
    ps.slice(0, 7).forEach((p, i) => load(V1, p, now - (40 - i * 3) * 60e3, false));
    routes.push({ id: routeId, code, date: today, vehicleId: V1.id, driverId: driverFor(V1.id), status: "loading", parcelIds: ps.map((p) => p.id), stopCount: 10, deliveredCount: 0, hub: HUB, loadVerification: null, loadVerifiedAt: null, startedAt: null, completedAt: null, demo: true, createdAt: ts(t0), updatedAt: ts(now) });
    vehicleState[V1.id] = { status: "loading", activeRouteId: routeId, presentEpcs: ps.slice(0, 7).map((p) => p.epc), location: { lat: HUB.lat, lng: HUB.lng, speedKmh: 0, heading: 0, accuracyM: 4, source: "gps_module", updatedAt: ts(now - 5000) } };
  }

  // VAN-02 and VAN-03 share a story: one VAN-02 parcel was loaded into VAN-03 by mistake.
  const r2 = todayRoute(V2, 12);
  const r3 = todayRoute(V3, 10);
  const strayed = r2.ps[9]!;
  {
    const ps = r2.ps;
    const start = now - 150 * 60e3;
    ps.forEach((p, i) => p !== strayed && load(V2, p, start - (30 - i) * 60e3, true));
    ps.slice(0, 6).forEach((p, i) => deliver(V2, p, start + (i + 1) * 18 * 60e3, i !== 3));
    ps.forEach((p) => tl(p.trackingId, "out_for_delivery", "Out for delivery", start));
    const drv: Actor = { type: "driver", id: driverFor(V2.id), name: DEMO_DRIVERS[1]!.name };
    routes.push({ id: r2.routeId, code: r2.code, date: today, vehicleId: V2.id, driverId: driverFor(V2.id), status: "in_progress", parcelIds: ps.map((p) => p.id), stopCount: 12, deliveredCount: 6, hub: HUB, loadVerification: { expected: 12, detected: 11, missing: [strayed.id], extra: [], passed: false, at: ts(start - 9 * 60e3), by: drv, method: "rfid", durationSec: 5 }, loadVerifiedAt: null, startedAt: ts(start), completedAt: null, demo: true, createdAt: ts(t0), updatedAt: ts(now) });
    ev("load_check_failed", start - 9 * 60e3, `Load check failed for ${r2.code}: 1 missing, 0 unexpected tag(s)`, drv, { vehicleId: V2.id, routeId: r2.routeId });
    ev("route_started", start, `${opts.actor.name} approved departure of ${r2.code} with 1 parcel located in VAN-03`, opts.actor, { vehicleId: V2.id, routeId: r2.routeId });
    addAlert({ type: "missing_parcel", vehicleId: V2.id, parcelId: strayed.id, trackingId: strayed.trackingId, routeId: r2.routeId, epc: strayed.epc, title: "Missing parcel", message: `${strayed.trackingId} (${strayed.recipientName}, ${strayed.area}) is on ${r2.code}'s manifest but was not detected in VAN-02.`, createdAtMs: start - 9 * 60e3 + 700, latencySec: 0.7, ack: true, source: "driver", location: { lat: HUB.lat, lng: HUB.lng } });
    const next = ps[6]!;
    vehicleState[V2.id] = {
      status: "en_route",
      activeRouteId: r2.routeId,
      presentEpcs: ps.slice(6).filter((p) => p !== strayed).map((p) => p.epc),
      location: { lat: (ps[5]!.lat + next.lat) / 2, lng: (ps[5]!.lng + next.lng) / 2, speedKmh: 27, heading: 140, accuracyM: 5, source: "gps_module", updatedAt: ts(now - 4000) },
    };
    // Memorable tracking IDs for the public tracking demo.
    for (const [p, id] of [[next, "SRG-DEMO42"], [ps[0]!, "SRG-DEMO07"]] as const) {
      const old = p.trackingId;
      p.trackingId = id;
      timelines.set(id, timelines.get(old) ?? []);
      timelines.delete(old);
      for (const e of events) if (e.trackingId === old) { e.trackingId = id; e.message = e.message.replace(old, id); }
      for (const a of alerts) if (a.trackingId === old) { a.trackingId = id; a.message = a.message.replace(old, id); }
    }
  }
  {
    const ps = r3.ps;
    const start = now - 110 * 60e3;
    ps.forEach((p, i) => load(V3, p, start - (25 - i) * 60e3, true));
    ps.forEach((p) => tl(p.trackingId, "out_for_delivery", "Out for delivery", start));
    ps.slice(0, 3).forEach((p, i) => deliver(V3, p, start + (i + 1) * 22 * 60e3, true));
    const drv: Actor = { type: "driver", id: driverFor(V3.id), name: DEMO_DRIVERS[2]!.name };
    routes.push({ id: r3.routeId, code: r3.code, date: today, vehicleId: V3.id, driverId: driverFor(V3.id), status: "in_progress", parcelIds: ps.map((p) => p.id), stopCount: 10, deliveredCount: 3, hub: HUB, loadVerification: { expected: 10, detected: 10, missing: [], extra: [strayed.epc], passed: false, at: ts(start - 8 * 60e3), by: drv, method: "rfid", durationSec: 4 }, loadVerifiedAt: ts(start - 6 * 60e3), startedAt: ts(start), completedAt: null, demo: true, createdAt: ts(t0), updatedAt: ts(now) });
    ev("route_started", start, `${drv.name} started ${r3.code} with 10 stops`, drv, { vehicleId: V3.id, routeId: r3.routeId });
    // The strayed VAN-02 parcel sits in VAN-03.
    strayed.status = "loaded";
    strayed.inVehicleId = V3.id;
    strayed.lastSeenAt = ts(now - 3000);
    strayed.loadedAt = ts(start - 20 * 60e3);
    addAlert({ type: "wrong_vehicle", vehicleId: V3.id, parcelId: strayed.id, trackingId: strayed.trackingId, routeId: r2.routeId, epc: strayed.epc, title: "Wrong vehicle", message: `${strayed.trackingId} is assigned to VAN-02 but was detected inside VAN-03.`, createdAtMs: start - 20 * 60e3 + 1400, latencySec: 1.4, location: { lat: HUB.lat, lng: HUB.lng } });
    // Unauthorized removal 4 minutes ago, ~1 km from the parcel's stop.
    const gone = ps[5]!;
    const roadside = { lat: +(ps[3]!.lat + 0.0062).toFixed(6), lng: +(ps[3]!.lng - 0.0071).toFixed(6) };
    gone.status = "exception";
    gone.inVehicleId = null;
    gone.leftVehicleAt = ts(now - 4 * 60e3 - 7200);
    gone.updatedAt = ts(now - 4 * 60e3);
    tl(gone.trackingId, "exception", "Delivery exception — our team is checking your parcel", now - 4 * 60e3);
    addAlert({ type: "unauthorized_removal", vehicleId: V3.id, parcelId: gone.id, trackingId: gone.trackingId, routeId: r3.routeId, epc: gone.epc, title: "Unauthorized removal", message: `${gone.trackingId} was removed from VAN-03 1.1 km from its destination while the route was in progress.`, createdAtMs: now - 4 * 60e3, latencySec: 7.2, location: roadside });
    vehicleState[V3.id] = {
      status: "en_route",
      activeRouteId: r3.routeId,
      presentEpcs: [...ps.slice(3).filter((p) => p !== gone).map((p) => p.epc), strayed.epc],
      location: { ...roadside, speedKmh: 0, heading: 90, accuracyM: 6, source: "gps_module", updatedAt: ts(now - 6000) },
    };
    addAlert({ type: "unknown_tag", vehicleId: V3.id, epc: epc(), title: "Unknown tag", message: "A tag not registered to any parcel was read inside VAN-03.", createdAtMs: now - 35 * 60e3, latencySec: 1.1, location: roadside });
  }

  // VAN-04: finished early, back at the hub.
  {
    const { ps, routeId, code } = todayRoute(V4, 8);
    const start = now - 230 * 60e3;
    ps.forEach((p, i) => load(V4, p, start - (20 - i) * 60e3, true));
    ps.forEach((p) => tl(p.trackingId, "out_for_delivery", "Out for delivery", start));
    ps.slice(0, 7).forEach((p, i) => deliver(V4, p, start + (i + 1) * 17 * 60e3, i !== 2));
    const ret = ps[7]!;
    ret.status = "returned";
    ret.inVehicleId = null;
    ret.updatedAt = ts(now - 50 * 60e3);
    tl(ret.trackingId, "returned", "Customer unavailable — returned to hub", now - 50 * 60e3);
    const drv: Actor = { type: "driver", id: driverFor(V4.id), name: DEMO_DRIVERS[3]!.name };
    routes.push({ id: routeId, code, date: today, vehicleId: V4.id, driverId: driverFor(V4.id), status: "completed", parcelIds: ps.map((p) => p.id), stopCount: 8, deliveredCount: 7, hub: HUB, loadVerification: { expected: 8, detected: 8, missing: [], extra: [], passed: true, at: ts(start - 7 * 60e3), by: drv, method: "rfid", durationSec: 4 }, loadVerifiedAt: ts(start - 7 * 60e3), startedAt: ts(start), completedAt: ts(now - 45 * 60e3), demo: true, createdAt: ts(t0), updatedAt: ts(now - 45 * 60e3) });
    ev("load_verified", start - 7 * 60e3, `Load verified for ${code}: 8/8 parcels detected (RFID)`, drv, { vehicleId: V4.id, routeId });
    ev("route_completed", now - 45 * 60e3, `${code} completed: 7/8 delivered`, drv, { vehicleId: V4.id, routeId });
    vehicleState[V4.id] = { status: "idle", activeRouteId: null, presentEpcs: [], location: { lat: HUB.lat + 0.0004, lng: HUB.lng - 0.0003, speedKmh: 0, heading: 0, accuracyM: 4, source: "gps_module", updatedAt: ts(now - 9000) } };
  }

  // Unassigned pool for the "Plan route" demo.
  for (let i = 0; i < 12; i++) makeParcel(now - int(10, 180) * 60e3);

  /* ---- write ---- */
  for (const v of VEHICLES) {
    const s = vehicleState[v.id]!;
    const present = (s.presentEpcs as string[]) ?? [];
    W.set(`vehicles/${v.id}`, {
      name: v.name, plate: v.plate, type: v.type, capacity: v.capacity, driverId: driverFor(v.id), deviceId: v.device,
      status: s.status, location: s.location, activeRouteId: s.activeRouteId, presentEpcs: present, presentCount: present.length,
      lastScanAt: ts(now - 2000), readerOnline: true, demo: true, updatedAt: ts(now),
    });
    W.set(`devices/${v.device}`, {
      vehicleId: v.id, model: "CHAFON CF591 UHF + Raspberry Pi 4", firmware: "srg-gw 1.0.0", lastHeartbeat: ts(now - 5000),
      stats: { readsPerMin: present.length * 55, uniqueTags: present.length, cpuTempC: int(46, 58), uptimeSec: int(3600, 30000), queueDepth: 0 },
      config: { txPowerDbm: 26, absenceTimeoutSec: 6, geofenceM: 150, heartbeatSec: 15 }, demo: true, updatedAt: ts(now),
    });
  }
  for (const p of parcels) {
    const { id, ...data } = p;
    W.set(`parcels/${id}`, data);
    W.set(`publicTracking/${p.trackingId}`, {
      trackingId: p.trackingId, status: p.status, area: p.area, city: p.city,
      recipientInitials: p.recipientName.split(" ").map((s) => s[0]).join(""),
      timeline: (timelines.get(p.trackingId) ?? []).sort((a, b) => a.at.toMillis() - b.at.toMillis()),
      updatedAt: p.updatedAt ?? ts(now),
    });
  }
  for (const r of routes) {
    const { id, ...data } = r;
    W.set(`routes/${id}`, data);
  }
  for (const a of alerts) {
    const { id, ...data } = a;
    W.set(`alerts/${id}`, data);
  }
  events.forEach((e) => W.set(`events/${autoId("e")}`, e as unknown as Record<string, unknown>));

  const msgs: [string, number, "driver" | "admin", string][] = [
    ["demo-driver-02", 140, "admin", "Priya — VAN-02 left with one parcel short. RFID shows it in VAN-03. Rahul will hand it over at Sector 29."],
    ["demo-driver-02", 136, "driver", "Got it. I'll do stops 7–9 first."],
    ["demo-driver-03", 4, "admin", "Rahul, the reader says a parcel left your van away from any stop. Can you check?"],
    ["demo-driver-04", 50, "driver", "Last customer not home, bringing the parcel back to the hub."],
    ["demo-driver-04", 48, "admin", "Thanks Sneha, marked as returned."],
  ];
  msgs.forEach(([thread, minsAgo, who, text]) => {
    const d = DEMO_DRIVERS.find((x) => x.id === thread)!;
    W.set(`messages/${autoId("m")}`, {
      threadId: thread,
      fromId: who === "driver" ? thread : opts.actor.id,
      fromName: who === "driver" ? d.name : opts.actor.name,
      fromRole: who === "driver" ? "driver" : "admin",
      text,
      createdAt: ts(now - minsAgo * 60e3),
      demo: true,
    });
  });

  const trials: [string, number, string, string, number, number, number, number, number, number | null, number | null, number | null][] = [
    ["SAMPLE · Static read test, 40 parcels", 5, "static", "Hub shelf", 40, 39, 0, 0, 0, null, 412, 6],
    ["SAMPLE · Realistic loading, 40 parcels", 4, "loading", "Hub → VAN-01", 40, 37, 0, 0, 1, null, 455, 8],
    ["SAMPLE · Wrong-vehicle drill", 3, "wrong_vehicle", "VAN-02 / VAN-03", 12, 12, 3, 3, 0, 7.4, null, null],
    ["SAMPLE · Missing-parcel drill", 2, "missing_parcel", "VAN-01", 30, 29, 3, 3, 0, 1.2, 380, 5],
  ];
  trials.forEach(([name, back, scenario, site, tagged, det, exp, raised, falseA, lat, manual, rfidT]) =>
    W.set(`pilotTrials/${autoId("t")}`, {
      name, date: format(subDays(new Date(now), back), "yyyy-MM-dd"), scenario, site, parcelsTagged: tagged, parcelsDetected: det,
      alertsExpected: exp, alertsRaised: raised, falseAlerts: falseA, avgAlertLatencySec: lat, manualCheckSec: manual, rfidCheckSec: rfidT,
      notes: "Illustrative sample shipped with the demo dataset — not a measured result.", isSample: true, createdAt: ts(now), demo: true,
    }),
  );

  await W.commit(opts.onProgress);
  return { docs: W.size };
}

/* -------------------------------------------------------------- reset */

const WIPE = ["vehicles", "devices", "parcels", "routes", "events", "alerts", "messages", "pilotTrials"] as const;

/** Deletes all operational data (keeps real user accounts and system settings). */
export async function resetDemoData(db: Firestore, onProgress?: (msg: string) => void): Promise<number> {
  let total = 0;
  for (const name of WIPE) {
    for (;;) {
      const snap = await getDocs(query(collection(db, name), limit(400)));
      if (snap.empty) break;
      const b = writeBatch(db);
      snap.docs.forEach((d) => {
        b.delete(d.ref);
        if (name === "parcels") {
          const tid = d.get("trackingId") as string | undefined;
          if (tid) b.delete(doc(db, "publicTracking", tid));
        }
      });
      await b.commit();
      total += snap.size;
      onProgress?.(`Deleted ${total} documents…`);
    }
  }
  const users = await getDocs(collection(db, "users"));
  const b = writeBatch(db);
  users.docs.filter((d) => d.get("demo") === true).forEach((d) => b.delete(d.ref));
  b.set(doc(db, "settings", "system"), { demoDataLoadedAt: deleteField() }, { merge: true });
  b.delete(doc(db, "settings", "pilotMilestones"));
  await b.commit();
  return total;
}
