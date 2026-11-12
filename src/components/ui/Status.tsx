import {
  AlertOctagon,
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDot,
  Clock,
  Info,
  PackageCheck,
  PackageOpen,
  PackagePlus,
  Radio,
  RadioTower,
  RotateCcw,
  ShieldAlert,
  Tag,
  Truck,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { Badge, type Tone } from "./primitives";
import type {
  Alert,
  AlertSeverity,
  AlertStatus,
  AlertType,
  Device,
  ParcelStatus,
  RouteStatus,
  SystemSettings,
  Vehicle,
  VehicleStatus,
} from "@/lib/types";
import { toMillis } from "@/lib/format";

const PARCEL: Record<ParcelStatus, { label: string; tone: Tone; icon: LucideIcon }> = {
  registered: { label: "Registered", tone: "neutral", icon: Tag },
  assigned: { label: "Assigned", tone: "primary", icon: PackagePlus },
  loaded: { label: "Loaded", tone: "primary", icon: PackageCheck },
  in_transit: { label: "In transit", tone: "navy", icon: Truck },
  delivered: { label: "Delivered", tone: "success", icon: CheckCircle2 },
  exception: { label: "Exception", tone: "danger", icon: AlertOctagon },
  returned: { label: "Returned", tone: "neutral", icon: RotateCcw },
};
export function ParcelStatusBadge({ status }: { status: ParcelStatus }) {
  const m = PARCEL[status] ?? PARCEL.registered;
  return <Badge tone={m.tone} icon={m.icon}>{m.label}</Badge>;
}
export const parcelStatusLabel = (s: ParcelStatus) => PARCEL[s]?.label ?? s;

const VEHICLE: Record<VehicleStatus, { label: string; tone: Tone }> = {
  idle: { label: "At hub", tone: "neutral" },
  loading: { label: "Loading", tone: "primary" },
  en_route: { label: "En route", tone: "navy" },
  returning: { label: "Returning", tone: "primary" },
  offline: { label: "Offline", tone: "neutral" },
};
export function VehicleStatusBadge({ status }: { status: VehicleStatus }) {
  const m = VEHICLE[status] ?? VEHICLE.idle;
  return <Badge tone={m.tone} dot pulse={status === "en_route"}>{m.label}</Badge>;
}

const ROUTE: Record<RouteStatus, { label: string; tone: Tone }> = {
  planned: { label: "Planned", tone: "neutral" },
  loading: { label: "Loading", tone: "primary" },
  in_progress: { label: "In progress", tone: "navy" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};
export function RouteStatusBadge({ status }: { status: RouteStatus }) {
  const m = ROUTE[status] ?? ROUTE.planned;
  return <Badge tone={m.tone} dot>{m.label}</Badge>;
}

export const ALERT_TYPE: Record<AlertType, { label: string; icon: LucideIcon; description: string }> = {
  missing_parcel: { label: "Missing parcel", icon: PackageOpen, description: "On the manifest but not detected in the vehicle at load check." },
  unauthorized_removal: { label: "Unauthorized removal", icon: ShieldAlert, description: "Left the vehicle away from its delivery stop while en route." },
  wrong_vehicle: { label: "Wrong vehicle", icon: Truck, description: "Detected inside a vehicle it is not assigned to." },
  delivery_mismatch: { label: "Delivery mismatch", icon: Ban, description: "Delivery status and RFID evidence disagree (or wrong stop)." },
  unknown_tag: { label: "Unknown tag", icon: Tag, description: "An RFID tag that is not registered to any parcel." },
  reader_offline: { label: "Reader offline", icon: WifiOff, description: "The RFID gateway stopped reporting." },
};

const SEVERITY: Record<AlertSeverity, { label: string; tone: Tone; icon: LucideIcon }> = {
  critical: { label: "Critical", tone: "danger", icon: AlertOctagon },
  warning: { label: "Warning", tone: "warning", icon: AlertTriangle },
  info: { label: "Info", tone: "primary", icon: Info },
};
export function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const m = SEVERITY[severity] ?? SEVERITY.info;
  return <Badge tone={m.tone} icon={m.icon}>{m.label}</Badge>;
}

const ASTATUS: Record<AlertStatus, { label: string; tone: Tone; icon: LucideIcon }> = {
  open: { label: "Open", tone: "danger", icon: CircleDot },
  acknowledged: { label: "Acknowledged", tone: "warning", icon: Clock },
  resolved: { label: "Resolved", tone: "success", icon: CheckCircle2 },
};
export function AlertStatusBadge({ status }: { status: AlertStatus }) {
  const m = ASTATUS[status] ?? ASTATUS.open;
  return <Badge tone={m.tone} icon={m.icon}>{m.label}</Badge>;
}

/* ---------------------------------------------------------- health logic */

export type Health = "ok" | "warning" | "critical" | "offline";

export function readerOnline(device: Device | undefined, settings: SystemSettings, now: number): boolean {
  const hb = toMillis(device?.lastHeartbeat);
  return hb != null && now - hb < settings.offlineAfterSec * 1000;
}

/** Map-marker colour logic: red = open critical alert, amber = warning/ack'd, grey = reader offline, green = OK. */
export function vehicleHealth(
  v: Vehicle,
  openAlerts: Alert[],
  device: Device | undefined,
  settings: SystemSettings,
  now: number,
): Health {
  const mine = openAlerts.filter((a) => a.vehicleId === v.id);
  if (mine.some((a) => a.severity === "critical" && a.status === "open")) return "critical";
  if (mine.some((a) => a.severity !== "info")) return "warning";
  if (v.deviceId && !readerOnline(device, settings, now)) return "offline";
  return "ok";
}

export const HEALTH: Record<Health, { label: string; tone: Tone; color: string; icon: LucideIcon }> = {
  ok: { label: "Verified", tone: "success", color: "#16A34A", icon: CheckCircle2 },
  warning: { label: "Attention", tone: "warning", color: "#EA580C", icon: AlertTriangle },
  critical: { label: "Critical", tone: "danger", color: "#DC2626", icon: AlertOctagon },
  offline: { label: "Reader offline", tone: "neutral", color: "#64748B", icon: WifiOff },
};

export function HealthBadge({ health }: { health: Health }) {
  const m = HEALTH[health];
  return <Badge tone={m.tone} icon={m.icon}>{m.label}</Badge>;
}

export function ReaderBadge({ online }: { online: boolean }) {
  return online ? (
    <Badge tone="success" icon={RadioTower}>Reader online</Badge>
  ) : (
    <Badge tone="neutral" icon={Radio}>Reader offline</Badge>
  );
}
