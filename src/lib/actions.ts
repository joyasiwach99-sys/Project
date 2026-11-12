/**
 * Every write the web app performs lives here, so business rules are in one
 * place and each step is atomic (batched). Field names follow types.ts and
 * are constrained by firestore.rules.
 */
import {
  Timestamp,
  arrayUnion,
  collection,
  deleteField,
  doc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type WriteBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import type {
  Actor,
  Alert,
  AlertSeverity,
  AlertType,
  EventType,
  GeoPoint,
  LoadVerification,
  Parcel,
  ParcelStatus,
  PublicTimelineEntry,
  Route,
  Vehicle,
} from "./types";
import { checkLoad, normalizeEpc } from "./verification";
import { initials, newTrackingId } from "./utils";
import { format } from "date-fns";

/* -------------------------------------------------------------- helpers */

export interface EventInput {
  type: EventType;
  message: string;
  actor: Actor;
  vehicleId?: string | null;
  parcelId?: string | null;
  trackingId?: string | null;
  routeId?: string | null;
  alertId?: string | null;
  epc?: string | null;
  location?: GeoPoint | null;
  deviceTime?: number | null;
}

export function addEvent(batch: WriteBatch, e: EventInput): string {
  const ref = doc(collection(db, "events"));
  batch.set(ref, {
    type: e.type,
    message: e.message,
    actor: e.actor,
    vehicleId: e.vehicleId ?? null,
    parcelId: e.parcelId ?? null,
    trackingId: e.trackingId ?? null,
    routeId: e.routeId ?? null,
    alertId: e.alertId ?? null,
    epc: e.epc ?? null,
    location: e.location ?? null,
    deviceTime: e.deviceTime ? Timestamp.fromMillis(e.deviceTime) : null,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export interface AlertInput {
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  vehicleId: string;
  parcel?: Pick<Parcel, "id" | "trackingId" | "epc" | "routeId"> | null;
  epc?: string | null;
  routeId?: string | null;
  location?: GeoPoint | null;
  detectedAt?: number | null;
  source: Alert["source"];
  actor: Actor;
}

/** Adds an alert + its "alert_raised" audit event to the batch. */
export function addAlert(batch: WriteBatch, a: AlertInput): string {
  const ref = doc(collection(db, "alerts"));
  batch.set(ref, {
    type: a.type,
    severity: a.severity,
    status: "open",
    title: a.title,
    message: a.message,
    vehicleId: a.vehicleId,
    parcelId: a.parcel?.id ?? null,
    trackingId: a.parcel?.trackingId ?? null,
    routeId: a.routeId ?? a.parcel?.routeId ?? null,
    epc: a.epc ?? a.parcel?.epc ?? null,
    location: a.location ?? null,
    detectedAt: Timestamp.fromMillis(a.detectedAt ?? Date.now()),
    createdAt: serverTimestamp(),
    source: a.source,
  });
  addEvent(batch, {
    type: "alert_raised",
    message: `${a.title}: ${a.message}`,
    actor: a.actor,
    vehicleId: a.vehicleId,
    parcelId: a.parcel?.id,
    trackingId: a.parcel?.trackingId,
    routeId: a.routeId ?? a.parcel?.routeId,
    alertId: ref.id,
    epc: a.epc ?? a.parcel?.epc,
    location: a.location,
    deviceTime: a.detectedAt,
  });
  return ref.id;
}

/** True if an unresolved alert of this type already exists for the parcel/EPC on this vehicle. */
export function hasOpenAlert(
  alerts: Alert[],
  vehicleId: string,
  type: AlertType,
  key: { parcelId?: string | null; epc?: string | null },
): boolean {
  return alerts.some(
    (a) =>
      a.status !== "resolved" &&
      a.vehicleId === vehicleId &&
      a.type === type &&
      ((key.parcelId && a.parcelId === key.parcelId) || (!key.parcelId && key.epc && a.epc === key.epc)),
  );
}

export function timelineEntry(status: PublicTimelineEntry["status"], label: string, rfidVerified = false): PublicTimelineEntry {
  return { status, label, at: Timestamp.now(), rfidVerified };
}

export function touchPublicTracking(
  batch: WriteBatch,
  parcel: Pick<Parcel, "trackingId">,
  status: ParcelStatus,
  entry: PublicTimelineEntry,
) {
  batch.set(
    doc(db, "publicTracking", parcel.trackingId),
    { status, timeline: arrayUnion(entry), updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/* --------------------------------------------------------------- alerts */

export async function acknowledgeAlert(alert: Alert, actor: Actor) {
  const b = writeBatch(db);
  b.update(doc(db, "alerts", alert.id), {
    status: "acknowledged",
    acknowledgedAt: serverTimestamp(),
    acknowledgedBy: actor,
  });
  addEvent(b, {
    type: "alert_acknowledged",
    message: `${actor.name} acknowledged “${alert.title}”`,
    actor,
    vehicleId: alert.vehicleId,
    parcelId: alert.parcelId,
    trackingId: alert.trackingId,
    routeId: alert.routeId,
    alertId: alert.id,
  });
  await b.commit();
}

export async function resolveAlert(alert: Alert, actor: Actor, resolution: string) {
  const b = writeBatch(db);
  b.update(doc(db, "alerts", alert.id), {
    status: "resolved",
    resolvedAt: serverTimestamp(),
    resolvedBy: actor,
    resolution: resolution.trim() || "Resolved",
    ...(alert.status === "open" ? { acknowledgedAt: serverTimestamp(), acknowledgedBy: actor } : {}),
  });
  addEvent(b, {
    type: "alert_resolved",
    message: `${actor.name} resolved “${alert.title}”: ${resolution.trim() || "Resolved"}`,
    actor,
    vehicleId: alert.vehicleId,
    parcelId: alert.parcelId,
    trackingId: alert.trackingId,
    routeId: alert.routeId,
    alertId: alert.id,
  });
  await b.commit();
}

/* -------------------------------------------------------------- parcels */

export interface NewParcel {
  recipientName: string;
  recipientPhone?: string;
  address: string;
  area: string;
  city: string;
  lat: number;
  lng: number;
  weightKg: number;
  size: Parcel["size"];
  priority: Parcel["priority"];
  epc: string;
  trackingId?: string;
}

export async function registerParcel(input: NewParcel, actor: Actor): Promise<string> {
  const b = writeBatch(db);
  const ref = doc(collection(db, "parcels"));
  const trackingId = input.trackingId || newTrackingId();
  const epc = normalizeEpc(input.epc);
  b.set(ref, {
    ...input,
    trackingId,
    epc,
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
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  b.set(doc(db, "publicTracking", trackingId), {
    trackingId,
    status: "registered",
    area: input.area,
    city: input.city,
    recipientInitials: initials(input.recipientName),
    timeline: [timelineEntry("registered", "Parcel registered and RFID-tagged at the hub")],
    updatedAt: serverTimestamp(),
  });
  addEvent(b, {
    type: "parcel_registered",
    message: `Parcel ${trackingId} registered for ${input.recipientName} (${input.area}) with tag ${epc}`,
    actor,
    parcelId: ref.id,
    trackingId,
    epc,
  });
  await b.commit();
  return ref.id;
}

export async function updateParcelDetails(parcel: Parcel, patch: Partial<NewParcel>) {
  await updateDoc(doc(db, "parcels", parcel.id), {
    ...patch,
    ...(patch.epc ? { epc: normalizeEpc(patch.epc) } : {}),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteParcel(parcel: Parcel) {
  const b = writeBatch(db);
  b.delete(doc(db, "parcels", parcel.id));
  b.delete(doc(db, "publicTracking", parcel.trackingId));
  await b.commit();
}

export async function setParcelStatus(parcel: Parcel, status: ParcelStatus, actor: Actor, note: string) {
  const b = writeBatch(db);
  b.update(doc(db, "parcels", parcel.id), {
    status,
    ...(status === "returned" || status === "registered"
      ? { vehicleId: null, routeId: null, stopSeq: null, inVehicleId: null }
      : {}),
    updatedAt: serverTimestamp(),
  });
  touchPublicTracking(b, parcel, status, timelineEntry(status, note));
  addEvent(b, {
    type: "note",
    message: `${actor.name} set ${parcel.trackingId} to “${status}”${note ? ` — ${note}` : ""}`,
    actor,
    parcelId: parcel.id,
    trackingId: parcel.trackingId,
    vehicleId: parcel.vehicleId,
  });
  await b.commit();
}

/* --------------------------------------------------------------- routes */

export async function createRoute(opts: {
  vehicle: Vehicle;
  driverId: string | null;
  parcels: Parcel[];
  date: string;
  hub: Route["hub"];
  actor: Actor;
}): Promise<string> {
  const { vehicle, driverId, parcels, date, hub, actor } = opts;
  const b = writeBatch(db);
  const ref = doc(collection(db, "routes"));
  const code = `RT-${format(new Date(date), "MMdd")}-${vehicle.id.replace(/[^0-9]/g, "") || vehicle.id}-${ref.id.slice(0, 3).toUpperCase()}`;
  b.set(ref, {
    code,
    date,
    vehicleId: vehicle.id,
    driverId,
    status: "planned",
    parcelIds: parcels.map((p) => p.id),
    stopCount: parcels.length,
    deliveredCount: 0,
    hub,
    loadVerification: null,
    loadVerifiedAt: null,
    startedAt: null,
    completedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  parcels.forEach((p, i) => {
    b.update(doc(db, "parcels", p.id), {
      status: "assigned",
      vehicleId: vehicle.id,
      routeId: ref.id,
      stopSeq: i + 1,
      updatedAt: serverTimestamp(),
    });
    touchPublicTracking(b, p, "assigned", timelineEntry("assigned", "Assigned to a delivery route"));
  });
  b.update(doc(db, "vehicles", vehicle.id), {
    activeRouteId: ref.id,
    status: "loading",
    ...(driverId ? { driverId } : {}),
    updatedAt: serverTimestamp(),
  });
  addEvent(b, {
    type: "route_created",
    message: `Route ${code} created for ${vehicle.id} with ${parcels.length} stops`,
    actor,
    vehicleId: vehicle.id,
    routeId: ref.id,
  });
  await b.commit();
  return ref.id;
}

export async function cancelRoute(route: Route, parcels: Parcel[], actor: Actor) {
  const b = writeBatch(db);
  b.update(doc(db, "routes", route.id), { status: "cancelled", updatedAt: serverTimestamp() });
  for (const p of parcels) {
    if (p.routeId !== route.id || p.status === "delivered") continue;
    b.update(doc(db, "parcels", p.id), {
      status: "registered",
      vehicleId: null,
      routeId: null,
      stopSeq: null,
      updatedAt: serverTimestamp(),
    });
  }
  b.update(doc(db, "vehicles", route.vehicleId), { activeRouteId: null, status: "idle", updatedAt: serverTimestamp() });
  addEvent(b, { type: "note", message: `Route ${route.code} cancelled`, actor, vehicleId: route.vehicleId, routeId: route.id });
  await b.commit();
}

/**
 * Driver step 2 — compare the manifest with what RFID currently sees.
 * Raises one missing_parcel alert per missing parcel (deduplicated).
 */
export async function verifyLoad(opts: {
  route: Route;
  vehicle: Vehicle;
  manifest: Parcel[];
  alerts: Alert[];
  actor: Actor;
  method: "rfid" | "manual";
  manualPresentIds?: string[];
  durationSec?: number;
}) {
  const { route, vehicle, manifest, alerts, actor, method } = opts;
  const presentEpcs =
    method === "manual"
      ? manifest.filter((p) => opts.manualPresentIds?.includes(p.id)).map((p) => p.epc)
      : vehicle.presentEpcs ?? [];
  const result = checkLoad(manifest, presentEpcs);
  const b = writeBatch(db);
  const verification: LoadVerification = {
    expected: result.expected,
    detected: result.detected,
    missing: result.missing.map((p) => p.id),
    extra: result.extraEpcs,
    passed: result.passed,
    at: Timestamp.now(),
    by: actor,
    method,
    durationSec: opts.durationSec ?? null,
  };
  b.update(doc(db, "routes", route.id), {
    loadVerification: verification,
    ...(result.passed ? { loadVerifiedAt: serverTimestamp() } : {}),
    ...(route.status === "planned" ? { status: "loading" } : {}),
    updatedAt: serverTimestamp(),
  });
  addEvent(b, {
    type: result.passed ? "load_verified" : "load_check_failed",
    message: result.passed
      ? `Load verified for ${route.code}: ${result.detected}/${result.expected} parcels detected (${method === "rfid" ? "RFID" : "manual check"})`
      : `Load check failed for ${route.code}: ${result.missing.length} missing, ${result.extraEpcs.length} unexpected tag(s)`,
    actor,
    vehicleId: vehicle.id,
    routeId: route.id,
  });
  for (const p of result.missing) {
    if (hasOpenAlert(alerts, vehicle.id, "missing_parcel", { parcelId: p.id })) continue;
    addAlert(b, {
      type: "missing_parcel",
      severity: "critical",
      title: "Missing parcel",
      message: `${p.trackingId} (${p.recipientName}, ${p.area}) is on ${route.code}'s manifest but was not detected in ${vehicle.id}.`,
      vehicleId: vehicle.id,
      parcel: p,
      routeId: route.id,
      location: vehicle.location ? { lat: vehicle.location.lat, lng: vehicle.location.lng } : null,
      source: actor.type === "driver" ? "driver" : "admin",
      actor,
    });
  }
  await b.commit();
  return result;
}

/** Driver step 3 — depart. Parcels on board become in_transit. */
export async function startRoute(route: Route, vehicle: Vehicle, manifest: Parcel[], actor: Actor) {
  const b = writeBatch(db);
  b.update(doc(db, "routes", route.id), { status: "in_progress", startedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  b.update(doc(db, "vehicles", vehicle.id), { status: "en_route", activeRouteId: route.id, updatedAt: serverTimestamp() });
  for (const p of manifest) {
    if (p.status === "delivered" || p.status === "returned") continue;
    if (p.status === "loaded" || p.status === "assigned") {
      b.update(doc(db, "parcels", p.id), { status: "in_transit", updatedAt: serverTimestamp() });
    }
    touchPublicTracking(b, p, "in_transit", timelineEntry("out_for_delivery", "Out for delivery"));
  }
  addEvent(b, {
    type: "route_started",
    message: `${actor.name} started ${route.code} with ${manifest.length} stops`,
    actor,
    vehicleId: vehicle.id,
    routeId: route.id,
    location: vehicle.location ? { lat: vehicle.location.lat, lng: vehicle.location.lng } : null,
  });
  await b.commit();
}

export async function completeRoute(route: Route, vehicle: Vehicle, actor: Actor) {
  const b = writeBatch(db);
  b.update(doc(db, "routes", route.id), { status: "completed", completedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  b.update(doc(db, "vehicles", vehicle.id), { status: "returning", activeRouteId: null, updatedAt: serverTimestamp() });
  addEvent(b, {
    type: "route_completed",
    message: `${route.code} completed: ${route.deliveredCount}/${route.stopCount} delivered`,
    actor,
    vehicleId: vehicle.id,
    routeId: route.id,
  });
  await b.commit();
}

export type DeliveryOutcome = { ok: true; method: "rfid+driver" | "driver" } | { ok: false; reason: string };

/**
 * Driver step 4 — confirm a handover. Blocked when the RFID reader still sees
 * the parcel in the cargo area (raises a delivery_mismatch alert instead).
 */
export async function confirmDelivery(opts: {
  parcel: Parcel;
  route: Route;
  vehicle: Vehicle;
  alerts: Alert[];
  actor: Actor;
  receiverName: string;
  note?: string;
  location: GeoPoint | null;
  readerOnline: boolean;
}): Promise<DeliveryOutcome> {
  const { parcel, route, vehicle, alerts, actor, readerOnline } = opts;
  const stillInside = readerOnline && (vehicle.presentEpcs ?? []).includes(parcel.epc);
  if (stillInside) {
    if (!hasOpenAlert(alerts, vehicle.id, "delivery_mismatch", { parcelId: parcel.id })) {
      const b = writeBatch(db);
      addAlert(b, {
        type: "delivery_mismatch",
        severity: "warning",
        title: "Delivery mismatch",
        message: `${actor.name} tried to confirm ${parcel.trackingId} as delivered, but RFID still detects it inside ${vehicle.id}.`,
        vehicleId: vehicle.id,
        parcel,
        routeId: route.id,
        location: opts.location,
        source: actor.type === "driver" ? "driver" : "admin",
        actor,
      });
      await b.commit();
    }
    return { ok: false, reason: "RFID still detects this parcel inside the vehicle. Take it out of the cargo area, then confirm again." };
  }

  const method = parcel.leftVehicleAt && readerOnline ? "rfid+driver" : "driver";
  const b = writeBatch(db);
  b.update(doc(db, "parcels", parcel.id), {
    status: "delivered",
    deliveredAt: serverTimestamp(),
    inVehicleId: null,
    deliveryProof: {
      method,
      by: actor,
      at: Timestamp.now(),
      note: opts.note?.trim() || null,
      receiverName: opts.receiverName.trim(),
      location: opts.location,
    },
    updatedAt: serverTimestamp(),
  });
  b.update(doc(db, "routes", route.id), { deliveredCount: increment(1), updatedAt: serverTimestamp() });
  touchPublicTracking(
    b,
    parcel,
    "delivered",
    timelineEntry(
      "delivered",
      method === "rfid+driver" ? "Delivered — handover verified by RFID and driver" : "Delivered — confirmed by driver",
      method === "rfid+driver",
    ),
  );
  addEvent(b, {
    type: "parcel_delivered",
    message: `${parcel.trackingId} delivered to ${opts.receiverName.trim() || parcel.recipientName} (${method === "rfid+driver" ? "RFID + driver" : "driver only"})`,
    actor,
    vehicleId: vehicle.id,
    parcelId: parcel.id,
    trackingId: parcel.trackingId,
    routeId: route.id,
    epc: parcel.epc,
    location: opts.location,
  });
  await b.commit();
  return { ok: true, method };
}

/** Driver/admin reports a problem with a parcel manually. */
export async function reportIssue(opts: {
  parcel: Parcel | null;
  vehicle: Vehicle;
  routeId: string | null;
  actor: Actor;
  type: AlertType;
  message: string;
  location: GeoPoint | null;
}) {
  const b = writeBatch(db);
  addAlert(b, {
    type: opts.type,
    severity: opts.type === "missing_parcel" || opts.type === "unauthorized_removal" ? "critical" : "warning",
    title: `Reported: ${opts.type.replace(/_/g, " ")}`,
    message: opts.message,
    vehicleId: opts.vehicle.id,
    parcel: opts.parcel,
    routeId: opts.routeId,
    location: opts.location,
    source: opts.actor.type === "driver" ? "driver" : "admin",
    actor: opts.actor,
  });
  await b.commit();
}

/* ------------------------------------------------------------- vehicles */

export async function shareLocation(vehicle: Vehicle, pos: GeolocationPosition) {
  await updateDoc(doc(db, "vehicles", vehicle.id), {
    location: {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      speedKmh: pos.coords.speed != null ? Math.round(pos.coords.speed * 3.6) : null,
      heading: pos.coords.heading ?? null,
      accuracyM: Math.round(pos.coords.accuracy),
      source: "phone",
      updatedAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  });
}

export async function saveVehicle(v: Partial<Vehicle> & { id: string }, isNew: boolean) {
  const ref = doc(db, "vehicles", v.id);
  if (isNew) {
    await setDoc(ref, {
      name: v.name ?? v.id,
      plate: v.plate ?? "",
      type: v.type ?? "van",
      capacity: v.capacity ?? 40,
      driverId: v.driverId ?? null,
      deviceId: v.deviceId ?? null,
      status: "idle",
      location: null,
      activeRouteId: null,
      presentEpcs: [],
      presentCount: 0,
      lastScanAt: null,
      readerOnline: false,
      updatedAt: serverTimestamp(),
    });
  } else {
    const { id: _id, ...rest } = v;
    await updateDoc(ref, { ...rest, updatedAt: serverTimestamp() });
  }
}

/* ------------------------------------------------------------- messages */

export async function sendMessage(threadId: string, text: string, from: { id: string; name: string; role: string }) {
  const ref = doc(collection(db, "messages"));
  await setDoc(ref, {
    threadId,
    fromId: from.id,
    fromName: from.name,
    fromRole: from.role,
    text: text.trim().slice(0, 1000),
    createdAt: serverTimestamp(),
  });
}

export { deleteField };
