import { format, formatDistanceToNowStrict, isToday, isYesterday } from "date-fns";
import { Timestamp } from "firebase/firestore";

export type TimeLike = Timestamp | Date | number | null | undefined | { seconds: number; nanoseconds: number };

export function toDate(t: TimeLike): Date | null {
  if (t == null) return null;
  if (t instanceof Date) return t;
  if (typeof t === "number") return new Date(t);
  if (t instanceof Timestamp) return t.toDate();
  if (typeof (t as Timestamp).toDate === "function") return (t as Timestamp).toDate();
  if (typeof (t as { seconds: number }).seconds === "number") return new Date((t as { seconds: number }).seconds * 1000);
  return null;
}

export function toMillis(t: TimeLike): number | null {
  return toDate(t)?.getTime() ?? null;
}

export function ago(t: TimeLike, fallback = "—"): string {
  const d = toDate(t);
  if (!d) return fallback;
  const diff = Date.now() - d.getTime();
  if (diff < 0 && diff > -30_000) return "just now";
  if (diff >= 0 && diff < 10_000) return "just now";
  return `${formatDistanceToNowStrict(d)} ago`;
}

export function clock(t: TimeLike, fallback = "—"): string {
  const d = toDate(t);
  return d ? format(d, "HH:mm:ss") : fallback;
}

export function dateTime(t: TimeLike, fallback = "—"): string {
  const d = toDate(t);
  if (!d) return fallback;
  if (isToday(d)) return `Today ${format(d, "HH:mm")}`;
  if (isYesterday(d)) return `Yesterday ${format(d, "HH:mm")}`;
  return format(d, "d MMM yyyy, HH:mm");
}

export function dayKey(t: TimeLike): string {
  const d = toDate(t);
  return d ? format(d, "yyyy-MM-dd") : "";
}

export function todayKey(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function km(m: number | null | undefined): string {
  if (m == null) return "—";
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export function seconds(s: number | null | undefined, digits = 1): string {
  if (s == null || Number.isNaN(s)) return "—";
  return `${s.toFixed(digits)} s`;
}

export function num(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-IN").format(n);
}

export function humanize(s: string | null | undefined): string {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
