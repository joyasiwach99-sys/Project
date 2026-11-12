import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, CheckCheck, MapPin, Timer } from "lucide-react";
import type { Actor, Alert } from "@/lib/types";
import { acknowledgeAlert, resolveAlert } from "@/lib/actions";
import { ago, dateTime, toMillis } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ALERT_TYPE, AlertStatusBadge, SeverityBadge } from "../ui/Status";
import { Button, Field, Textarea } from "../ui/primitives";
import { Dialog } from "../ui/Dialog";
import { useAction } from "../ui/Toast";

export function alertLatencySec(a: Alert): number | null {
  const d = toMillis(a.detectedAt);
  const c = toMillis(a.createdAt);
  if (d == null || c == null) return null;
  return Math.max(0, (c - d) / 1000);
}

const QUICK_RESOLUTIONS: Record<Alert["type"], string[]> = {
  missing_parcel: ["Found at hub and loaded", "Parcel removed from today’s route", "Tag damaged — replaced"],
  unauthorized_removal: ["Driver moved parcel within cargo", "Recovered and re-loaded", "Escalated to security team"],
  wrong_vehicle: ["Moved to correct vehicle", "Re-assigned to this vehicle"],
  delivery_mismatch: ["Parcel handed over correctly", "Retrieved from wrong customer", "Driver error — re-attempt scheduled"],
  unknown_tag: ["Stray tag removed", "Registered to a parcel"],
  reader_offline: ["Reader power restored", "Cable re-seated"],
};

export function AlertItem({
  alert,
  actor,
  canAct,
  compact,
  linkBase = "/admin",
}: {
  alert: Alert;
  actor: Actor | null;
  canAct: boolean;
  compact?: boolean;
  linkBase?: string;
}) {
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"ack" | "resolve" | null>(null);
  const run = useAction();
  const meta = ALERT_TYPE[alert.type];
  const latency = alertLatencySec(alert);
  const accent =
    alert.status === "resolved"
      ? "border-l-border"
      : alert.severity === "critical"
        ? "border-l-danger"
        : alert.severity === "warning"
          ? "border-l-orange"
          : "border-l-primary";

  return (
    <article className={cn("card border-l-4 p-4", accent, alert.status === "resolved" && "opacity-80")} aria-label={`${alert.title} on ${alert.vehicleId}`}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            alert.severity === "critical" ? "bg-danger-soft text-danger" : alert.severity === "warning" ? "bg-warning-soft text-warning" : "bg-primary-soft text-primary",
          )}
        >
          <meta.icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold">{alert.title}</h3>
            <SeverityBadge severity={alert.severity} />
            <AlertStatusBadge status={alert.status} />
          </div>
          <p className="mt-1 text-[14px] text-fg-muted">{alert.message}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-fg-subtle">
            {linkBase === "/admin" ? (
              <Link to={`/admin/vehicles/${alert.vehicleId}`} className="font-semibold text-primary hover:underline">
                {alert.vehicleId}
              </Link>
            ) : (
              <span className="font-semibold text-fg-muted">{alert.vehicleId}</span>
            )}
            {alert.trackingId && alert.parcelId && linkBase === "/admin" ? (
              <Link to={`/admin/parcels/${alert.parcelId}`} className="font-mono text-[12px] text-primary hover:underline">
                {alert.trackingId}
              </Link>
            ) : alert.trackingId ? (
              <span className="font-mono text-[12px]">{alert.trackingId}</span>
            ) : null}
            <span title={dateTime(alert.createdAt)}>{ago(alert.createdAt)}</span>
            {latency != null && !compact && (
              <span className="inline-flex items-center gap-1" title="Time from the physical event to the alert reaching the cloud">
                <Timer className="h-3.5 w-3.5" aria-hidden />
                <span className="tabular">{latency.toFixed(1)} s latency</span>
              </span>
            )}
            {alert.location && !compact && (
              <a
                className="inline-flex items-center gap-1 hover:text-fg"
                href={`https://www.openstreetmap.org/?mlat=${alert.location.lat}&mlon=${alert.location.lng}#map=17/${alert.location.lat}/${alert.location.lng}`}
                target="_blank"
                rel="noreferrer"
              >
                <MapPin className="h-3.5 w-3.5" aria-hidden />
                Location
              </a>
            )}
            <span>via {alert.source}</span>
          </div>
          {alert.status === "resolved" && alert.resolution && (
            <p className="mt-2 rounded-lg bg-success-soft px-3 py-2 text-[13px] text-success">
              <strong>Resolved</strong> by {alert.resolvedBy?.name ?? "—"} · {alert.resolution}
            </p>
          )}
        {canAct && actor && alert.status !== "resolved" && (
          <div className="mt-3 flex flex-wrap gap-2">
            {alert.status === "open" && (
              <Button
                variant="outline"
                size="sm"
                icon={Check}
                loading={busy === "ack"}
                
                onClick={async () => {
                  setBusy("ack");
                  await run(() => acknowledgeAlert(alert, actor), "Alert acknowledged");
                  setBusy(null);
                }}
              >
                Acknowledge
              </Button>
            )}
            <Button size="sm" icon={CheckCheck} onClick={() => setResolving(true)}>
              Resolve
            </Button>
          </div>
        )}
        </div>
      </div>

      <Dialog
        open={resolving}
        onClose={() => setResolving(false)}
        title={`Resolve: ${alert.title}`}
        description={meta.description}
        footer={
          <>
            <Button variant="ghost" onClick={() => setResolving(false)}>
              Cancel
            </Button>
            <Button
              icon={CheckCheck}
              loading={busy === "resolve"}
              disabled={!note.trim()}
              onClick={async () => {
                if (!actor) return;
                setBusy("resolve");
                const ok = await run(() => resolveAlert(alert, actor, note), "Alert resolved", "Logged to the audit trail.");
                setBusy(null);
                if (ok) setResolving(false);
              }}
            >
              Mark resolved
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Common resolutions">
            {QUICK_RESOLUTIONS[alert.type].map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setNote(q)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
                  note === q ? "border-primary bg-primary-soft text-primary" : "border-border text-fg-muted hover:bg-surface-2",
                )}
              >
                {q}
              </button>
            ))}
          </div>
          <Field label="What happened?" required help="Saved permanently in the audit trail.">
            {(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Parcel was behind the bulkhead; re-scanned and confirmed on board." />}
          </Field>
        </div>
      </Dialog>
    </article>
  );
}
