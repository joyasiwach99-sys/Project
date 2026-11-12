/** Operational metrics computed from live Firestore data (shared by Overview, Analytics, Pilot). */
import { format, subDays } from "date-fns";
import type { Alert, AlertSeverity, AlertType, Parcel, Route } from "./types";
import { dayKey, toDate, toMillis } from "./format";

export function lastNDays(n: number): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = subDays(new Date(), i);
    out.push({ key: format(d, "yyyy-MM-dd"), label: format(d, "EEE d") });
  }
  return out;
}

export function alertLatency(a: Alert): number | null {
  const d = toMillis(a.detectedAt);
  const c = toMillis(a.createdAt);
  if (d == null || c == null) return null;
  return Math.max(0, (c - d) / 1000);
}

export function deliveredOn(parcels: Parcel[], key: string): Parcel[] {
  return parcels.filter((p) => p.status === "delivered" && dayKey(p.deliveredAt) === key);
}

export function deliveriesByDay(parcels: Parcel[], days = 7) {
  return lastNDays(days).map(({ key, label }) => {
    const ds = deliveredOn(parcels, key);
    const rfid = ds.filter((p) => p.deliveryProof?.method === "rfid+driver").length;
    return { day: label, key, rfid, driver: ds.length - rfid, total: ds.length };
  });
}

export function alertsByDay(alerts: Alert[], days = 7) {
  return lastNDays(days).map(({ key, label }) => {
    const xs = alerts.filter((a) => dayKey(a.createdAt) === key);
    const by = (s: AlertSeverity) => xs.filter((a) => a.severity === s).length;
    return { day: label, key, critical: by("critical"), warning: by("warning"), info: by("info"), total: xs.length };
  });
}

export function alertsByType(alerts: Alert[]) {
  const types: AlertType[] = ["missing_parcel", "unauthorized_removal", "wrong_vehicle", "delivery_mismatch", "unknown_tag", "reader_offline"];
  return types.map((t) => ({ type: t, count: alerts.filter((a) => a.type === t).length }));
}

export function latencyStats(alerts: Alert[], sinceMs?: number) {
  const xs = alerts
    .filter((a) => a.source === "device" || a.source === "simulator")
    .filter((a) => (sinceMs ? (toMillis(a.createdAt) ?? 0) >= sinceMs : true))
    .map(alertLatency)
    .filter((x): x is number => x != null)
    .sort((a, b) => a - b);
  if (!xs.length) return { count: 0, avg: null as number | null, p50: null as number | null, p95: null as number | null, max: null as number | null, values: xs };
  const q = (p: number) => xs[Math.min(xs.length - 1, Math.floor(p * (xs.length - 1)))]!;
  return { count: xs.length, avg: xs.reduce((s, x) => s + x, 0) / xs.length, p50: q(0.5), p95: q(0.95), max: xs[xs.length - 1]!, values: xs };
}

export function latencyHistogram(values: number[]) {
  const buckets = [
    { label: "0–2 s", lo: 0, hi: 2 },
    { label: "2–4 s", lo: 2, hi: 4 },
    { label: "4–6 s", lo: 4, hi: 6 },
    { label: "6–8 s", lo: 6, hi: 8 },
    { label: "8–10 s", lo: 8, hi: 10 },
    { label: "10–15 s", lo: 10, hi: 15 },
    { label: "15 s+", lo: 15, hi: Infinity },
  ];
  return buckets.map((b) => ({ bucket: b.label, count: values.filter((v) => v >= b.lo && v < b.hi).length }));
}

/** RFID load-check detection rate across verifications (RFID method only). */
export function loadDetection(routes: Route[], sinceKey?: string) {
  const checks = routes
    .filter((r) => r.loadVerification && r.loadVerification.method !== "manual")
    .filter((r) => (sinceKey ? r.date >= sinceKey : true));
  const expected = checks.reduce((s, r) => s + (r.loadVerification?.expected ?? 0), 0);
  const detected = checks.reduce((s, r) => s + (r.loadVerification?.detected ?? 0), 0);
  return {
    checks: checks.length,
    expected,
    detected,
    rate: expected ? (detected / expected) * 100 : null,
    series: checks
      .slice()
      .sort((a, b) => (toMillis(a.loadVerification?.at) ?? 0) - (toMillis(b.loadVerification?.at) ?? 0))
      .map((r) => ({
        label: `${format(toDate(r.loadVerification?.at) ?? new Date(r.date), "d MMM")} ${r.vehicleId}`,
        rate: r.loadVerification?.expected ? Math.round((r.loadVerification.detected / r.loadVerification.expected) * 1000) / 10 : null,
        route: r.code,
      })),
  };
}

export function resolutionMinutes(a: Alert): number | null {
  const c = toMillis(a.createdAt);
  const r = toMillis(a.resolvedAt);
  if (c == null || r == null) return null;
  return (r - c) / 60000;
}
