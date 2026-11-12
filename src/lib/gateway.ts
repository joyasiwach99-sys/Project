/**
 * Browser twin of the Raspberry Pi gateway writer
 * (device/smartroute_gateway/writer.py). Turns engine decisions into
 * Firestore writes exactly as documented in docs/ARCHITECTURE.md §3.3.
 */
import { Timestamp, doc, serverTimestamp, writeBatch, type WriteBatch } from "firebase/firestore";
import { db } from "./firebase";
import { addAlert, addEvent, hasOpenAlert, timelineEntry, touchPublicTracking } from "./actions";
import type { Actor, Alert, GeoPoint, Parcel, Route, Vehicle } from "./types";
import type { Decision } from "./verification";
import { km } from "./format";

export interface GatewayContext {
  vehicle: Vehicle;
  route: Route | undefined;
  location: GeoPoint | null;
  /** Unresolved alerts from Firestore (used for de-duplication and auto-resolve). */
  alerts: Alert[];
  /** Alerts this gateway raised moments ago that Firestore hasn't echoed back yet — de-dup only, never resolved. */
  recentlyRaised?: Alert[];
  parcelById: Map<string, Parcel>;
  actor: Actor;
  source: Alert["source"];
}

export interface AppliedDecision {
  kind: Decision["kind"];
  summary: string;
  tone: "ok" | "info" | "warn" | "crit";
}

/** Applies a batch of decisions in one Firestore commit. Returns a human log of what happened. */
export async function applyDecisions(decisions: Decision[], ctx: GatewayContext): Promise<AppliedDecision[]> {
  if (!decisions.length) return [];
  const b = writeBatch(db);
  const log: AppliedDecision[] = [];
  // Alerts raised in this batch, so two decisions in one round don't duplicate.
  const pending: Alert[] = [...ctx.alerts, ...(ctx.recentlyRaised ?? [])];

  for (const d of decisions) {
    const entry = applyOne(b, d, ctx, pending);
    if (entry) log.push(entry);
  }
  await b.commit();
  return log;
}

function applyOne(b: WriteBatch, d: Decision, ctx: GatewayContext, pending: Alert[]): AppliedDecision | null {
  const { vehicle, route, location, actor } = ctx;
  const me = vehicle.id;
  const afterLoad = route?.status === "in_progress" ? "in_transit" : "loaded";
  const loc = location ? { lat: location.lat, lng: location.lng } : null;

  const raise = (
    type: Alert["type"],
    severity: Alert["severity"],
    title: string,
    message: string,
    parcel: Parcel | null,
    epc: string | null,
    detectedAt: number,
  ) => {
    if (hasOpenAlert(pending, me, type, { parcelId: parcel?.id, epc })) return false;
    addAlert(b, {
      type,
      severity,
      title,
      message,
      vehicleId: me,
      parcel,
      epc,
      routeId: parcel?.routeId ?? route?.id ?? null,
      location: loc,
      detectedAt,
      source: ctx.source,
      actor,
    });
    pending.push({ id: "pending", type, severity, status: "open", title, message, vehicleId: me, parcelId: parcel?.id ?? null, epc, source: ctx.source });
    return true;
  };

  const autoResolve = (types: Alert["type"][], parcel: Parcel, why: string) => {
    for (const a of ctx.alerts) {
      if (a.status === "resolved" || a.vehicleId !== me || a.parcelId !== parcel.id || !types.includes(a.type)) continue;
      b.update(doc(db, "alerts", a.id), {
        status: "resolved",
        resolvedAt: serverTimestamp(),
        resolvedBy: actor,
        resolution: why,
      });
      addEvent(b, {
        type: "alert_resolved",
        message: `Auto-resolved “${a.title}” for ${parcel.trackingId}: ${why}`,
        actor,
        vehicleId: me,
        parcelId: parcel.id,
        trackingId: parcel.trackingId,
        alertId: a.id,
      });
    }
  };

  const full = (id: string) => ctx.parcelById.get(id);

  switch (d.kind) {
    case "loaded": {
      const p = full(d.parcel.id);
      if (!p) return null;
      b.update(doc(db, "parcels", p.id), {
        status: afterLoad,
        inVehicleId: me,
        lastSeenAt: Timestamp.fromMillis(d.at),
        loadedAt: Timestamp.fromMillis(d.at),
        updatedAt: serverTimestamp(),
      });
      touchPublicTracking(b, p, afterLoad, timelineEntry("loaded", "Loaded into the delivery vehicle — verified by RFID", true));
      addEvent(b, {
        type: "parcel_loaded",
        message: `${p.trackingId} loaded into ${me} (RFID)`,
        actor, vehicleId: me, parcelId: p.id, trackingId: p.trackingId, routeId: p.routeId, epc: p.epc, location: loc, deviceTime: d.at,
      });
      return { kind: d.kind, summary: `${p.trackingId} loaded`, tone: "ok" };
    }
    case "present": {
      const p = full(d.parcel.id);
      if (!p || p.inVehicleId === me) return null;
      b.update(doc(db, "parcels", p.id), { inVehicleId: me, lastSeenAt: Timestamp.fromMillis(d.at), updatedAt: serverTimestamp() });
      return null;
    }
    case "redetected": {
      const p = full(d.parcel.id);
      if (!p) return null;
      b.update(doc(db, "parcels", p.id), {
        status: afterLoad,
        inVehicleId: me,
        lastSeenAt: Timestamp.fromMillis(d.at),
        leftVehicleAt: null,
        updatedAt: serverTimestamp(),
      });
      autoResolve(["unauthorized_removal", "delivery_mismatch"], p, "Parcel re-detected inside the vehicle by RFID");
      if (p.status === "exception") {
        // Undo the customer-facing exception raised by a false alarm.
        touchPublicTracking(b, p, afterLoad, timelineEntry(afterLoad === "in_transit" ? "out_for_delivery" : "loaded", "Back on board — verified by RFID", true));
      }
      addEvent(b, {
        type: "note",
        message: `${p.trackingId} re-detected inside ${me}`,
        actor, vehicleId: me, parcelId: p.id, trackingId: p.trackingId, routeId: p.routeId, epc: p.epc, location: loc, deviceTime: d.at,
      });
      return { kind: d.kind, summary: `${p.trackingId} back in cargo`, tone: "info" };
    }
    case "wrong_vehicle": {
      const p = full(d.parcel.id);
      if (!p) return null;
      b.update(doc(db, "parcels", p.id), { inVehicleId: me, lastSeenAt: Timestamp.fromMillis(d.at), updatedAt: serverTimestamp() });
      raise(
        "wrong_vehicle",
        "warning",
        "Wrong vehicle",
        `${p.trackingId} is assigned to ${p.vehicleId ?? "no vehicle"} but was detected inside ${me}.`,
        p,
        p.epc,
        d.at,
      );
      return { kind: d.kind, summary: `${p.trackingId} is in the wrong vehicle`, tone: "warn" };
    }
    case "unknown_tag": {
      raise("unknown_tag", "info", "Unknown tag", `Tag ${d.epc} was read inside ${me} but is not registered to any parcel.`, null, d.epc, d.at);
      return { kind: d.kind, summary: `Unknown tag ${d.epc.slice(-6)}`, tone: "info" };
    }
    case "delivered_but_present": {
      const p = full(d.parcel.id);
      if (!p) return null;
      raise(
        "delivery_mismatch",
        "warning",
        "Delivery mismatch",
        `${p.trackingId} is marked delivered but RFID still detects it inside ${me}.`,
        p,
        p.epc,
        d.at,
      );
      return { kind: d.kind, summary: `${p.trackingId} delivered but still on board`, tone: "warn" };
    }
    case "unloaded_at_hub": {
      const p = full(d.parcel.id);
      if (!p) return null;
      b.update(doc(db, "parcels", p.id), { status: "assigned", inVehicleId: null, loadedAt: null, updatedAt: serverTimestamp() });
      addEvent(b, {
        type: "parcel_unloaded",
        message: `${p.trackingId} unloaded from ${me} at the hub`,
        actor, vehicleId: me, parcelId: p.id, trackingId: p.trackingId, routeId: p.routeId, epc: p.epc, location: loc, deviceTime: d.lastSeen,
      });
      return { kind: d.kind, summary: `${p.trackingId} unloaded at hub`, tone: "info" };
    }
    case "left_at_stop": {
      const p = full(d.parcel.id);
      if (!p) return null;
      b.update(doc(db, "parcels", p.id), { inVehicleId: null, leftVehicleAt: Timestamp.fromMillis(d.lastSeen), updatedAt: serverTimestamp() });
      addEvent(b, {
        type: "parcel_left_at_stop",
        message: `${p.trackingId} left ${me} at its destination (${km(d.distanceM)} away) — awaiting driver confirmation`,
        actor, vehicleId: me, parcelId: p.id, trackingId: p.trackingId, routeId: p.routeId, epc: p.epc, location: loc, deviceTime: d.lastSeen,
      });
      return { kind: d.kind, summary: `${p.trackingId} taken out at its stop`, tone: "ok" };
    }
    case "wrong_stop": {
      const p = full(d.parcel.id);
      if (!p) return null;
      b.update(doc(db, "parcels", p.id), {
        status: "exception",
        inVehicleId: null,
        leftVehicleAt: Timestamp.fromMillis(d.lastSeen),
        updatedAt: serverTimestamp(),
      });
      raise(
        "delivery_mismatch",
        "critical",
        "Wrong stop",
        `${p.trackingId} (for ${p.area}) was removed at the stop for ${d.nearParcel.trackingId} — possible hand-over to the wrong customer.`,
        p,
        p.epc,
        d.lastSeen,
      );
      touchPublicTracking(b, p, "exception", timelineEntry("exception", "Delivery exception — our team is checking your parcel"));
      return { kind: d.kind, summary: `${p.trackingId} removed at the wrong stop`, tone: "crit" };
    }
    case "unauthorized_removal": {
      const p = full(d.parcel.id);
      if (!p) return null;
      b.update(doc(db, "parcels", p.id), {
        status: "exception",
        inVehicleId: null,
        leftVehicleAt: Timestamp.fromMillis(d.lastSeen),
        updatedAt: serverTimestamp(),
      });
      raise(
        "unauthorized_removal",
        "critical",
        "Unauthorized removal",
        d.distanceM == null
          ? `${p.trackingId} left ${me} while the route was in progress and no GPS fix was available.`
          : `${p.trackingId} was removed from ${me} ${km(d.distanceM)} from its destination while the route was in progress.`,
        p,
        p.epc,
        d.lastSeen,
      );
      touchPublicTracking(b, p, "exception", timelineEntry("exception", "Delivery exception — our team is checking your parcel"));
      return { kind: d.kind, summary: `${p.trackingId} removed away from its stop`, tone: "crit" };
    }
    case "wrong_vehicle_cleared": {
      const p = full(d.parcel.id);
      if (!p) return null;
      if (p.inVehicleId === me) b.update(doc(db, "parcels", p.id), { inVehicleId: null, updatedAt: serverTimestamp() });
      autoResolve(["wrong_vehicle"], p, `Removed from ${me}`);
      return { kind: d.kind, summary: `${p.trackingId} removed from wrong vehicle`, tone: "info" };
    }
  }
}

/** Publishes the current RFID presence set for a vehicle. */
export async function publishPresence(vehicle: Vehicle, epcs: string[], readerOnline: boolean) {
  const b = writeBatch(db);
  b.update(doc(db, "vehicles", vehicle.id), {
    presentEpcs: epcs,
    presentCount: epcs.length,
    lastScanAt: serverTimestamp(),
    readerOnline,
    updatedAt: serverTimestamp(),
  });
  await b.commit();
}

export async function publishLocation(vehicle: Vehicle, loc: GeoPoint & { speedKmh?: number; heading?: number }) {
  const b = writeBatch(db);
  b.update(doc(db, "vehicles", vehicle.id), {
    location: { ...loc, source: "simulator", accuracyM: 5, updatedAt: serverTimestamp() },
    updatedAt: serverTimestamp(),
  });
  await b.commit();
}

export async function heartbeat(deviceId: string, stats: Record<string, number>) {
  const b = writeBatch(db);
  b.update(doc(db, "devices", deviceId), { lastHeartbeat: serverTimestamp(), stats, updatedAt: serverTimestamp() });
  await b.commit();
}
