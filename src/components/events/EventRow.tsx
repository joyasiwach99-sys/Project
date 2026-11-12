import { Link } from "react-router-dom";
import {
  AlertOctagon,
  BellOff,
  CheckCheck,

  ClipboardCheck,
  ClipboardX,
  Cpu,
  Flag,
  LogIn,
  LogOut,
  MapPinned,
  PackageCheck,

  PackagePlus,
  Play,
  Route,
  StickyNote,
  Tag,
  type LucideIcon,
} from "lucide-react";
import type { AuditEvent, EventType } from "@/lib/types";
import { clock, dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const EVENT_META: Record<EventType, { label: string; icon: LucideIcon; tone: "ok" | "info" | "warn" | "crit" | "muted" }> = {
  parcel_registered: { label: "Parcel registered", icon: Tag, tone: "muted" },
  parcel_assigned: { label: "Parcel assigned", icon: PackagePlus, tone: "info" },
  parcel_loaded: { label: "Loaded (RFID)", icon: LogIn, tone: "ok" },
  parcel_unloaded: { label: "Unloaded", icon: LogOut, tone: "info" },
  parcel_left_at_stop: { label: "Left at stop (RFID)", icon: MapPinned, tone: "ok" },
  parcel_delivered: { label: "Delivered", icon: PackageCheck, tone: "ok" },
  route_created: { label: "Route created", icon: Route, tone: "info" },
  route_started: { label: "Route started", icon: Play, tone: "info" },
  load_verified: { label: "Load verified", icon: ClipboardCheck, tone: "ok" },
  load_check_failed: { label: "Load check failed", icon: ClipboardX, tone: "crit" },
  route_completed: { label: "Route completed", icon: Flag, tone: "ok" },
  alert_raised: { label: "Alert raised", icon: AlertOctagon, tone: "crit" },
  alert_acknowledged: { label: "Alert acknowledged", icon: BellOff, tone: "warn" },
  alert_resolved: { label: "Alert resolved", icon: CheckCheck, tone: "ok" },
  device_online: { label: "Reader online", icon: Cpu, tone: "ok" },
  device_offline: { label: "Reader offline", icon: Cpu, tone: "warn" },
  note: { label: "Note", icon: StickyNote, tone: "muted" },
};

const TONE = {
  ok: "bg-success-soft text-success",
  info: "bg-primary-soft text-primary",
  warn: "bg-warning-soft text-warning",
  crit: "bg-danger-soft text-danger",
  muted: "bg-surface-2 text-fg-muted",
};

export function EventRow({ e, showTime = "clock", links = true }: { e: AuditEvent; showTime?: "clock" | "full"; links?: boolean }) {
  const meta = EVENT_META[e.type] ?? EVENT_META.note;
  return (
    <li className="flex gap-3 py-2.5">
      <span className={cn("mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", TONE[meta.tone])}>
        <meta.icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-snug text-fg" style={{ overflowWrap: "anywhere" }}>
          {e.message}
        </p>
        <p className="mt-0.5 flex flex-wrap gap-x-2 text-[12px] text-fg-subtle">
          <span className="font-semibold text-fg-muted">{meta.label}</span>
          <span aria-hidden>·</span>
          <span>{e.actor?.name ?? "system"}</span>
          {links && e.vehicleId && (
            <>
              <span aria-hidden>·</span>
              <Link className="text-primary hover:underline" to={`/admin/vehicles/${e.vehicleId}`}>{e.vehicleId}</Link>
            </>
          )}
          {links && e.parcelId && e.trackingId && (
            <>
              <span aria-hidden>·</span>
              <Link className="font-mono text-primary hover:underline" to={`/admin/parcels/${e.parcelId}`}>{e.trackingId}</Link>
            </>
          )}
        </p>
      </div>
      <time className="tabular shrink-0 text-[12px] text-fg-subtle" title={dateTime(e.createdAt)}>
        {showTime === "clock" ? clock(e.createdAt, "…") : dateTime(e.createdAt, "…")}
      </time>
    </li>
  );
}

