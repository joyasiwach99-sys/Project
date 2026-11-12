import { useState } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  Flag,
  MapPin,
  Navigation,
  PackageCheck,
  Phone,
  Radio,
  ShieldX,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { useDriver } from "@/components/layout/DriverLayout";
import { useOps } from "@/context/OpsData";
import { useNow } from "@/hooks/useFirestore";
import { FleetMap } from "@/components/map/FleetMap";
import { Badge, Button, Card, CardHeader, Field, Input, LinkButton, Select, Textarea, buttonClass } from "@/components/ui/primitives";
import { ParcelStatusBadge, vehicleHealth } from "@/components/ui/Status";
import { Dialog } from "@/components/ui/Dialog";
import { useAction, useToast } from "@/components/ui/Toast";
import { completeRoute, confirmDelivery, reportIssue } from "@/lib/actions";
import { distanceM } from "@/lib/verification";
import type { AlertType, GeoPoint, Parcel } from "@/lib/types";
import { ago, km } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DriverHeading, NoRoute, PreviewNote, remainingStops, usePageTitle } from "@/components/driver/common";

const ISSUE_TYPES: { value: AlertType; label: string }[] = [
  { value: "delivery_mismatch", label: "Delivery problem (wrong customer, refused, damaged)" },
  { value: "missing_parcel", label: "Parcel missing from the vehicle" },
  { value: "unauthorized_removal", label: "Parcel taken without authorisation" },
];

function RfidEvidence({ p, vehicleId }: { p: Parcel; vehicleId: string }) {
  if (p.status === "delivered") {
    return p.deliveryProof?.method === "rfid+driver" ? (
      <Badge tone="success" icon={Radio}>Verified by RFID + driver</Badge>
    ) : (
      <Badge tone="neutral" icon={CheckCircle2}>Driver confirmed</Badge>
    );
  }
  if (p.leftVehicleAt && p.inVehicleId !== vehicleId) return <Badge tone="primary" icon={Radio}>Left vehicle at stop (RFID)</Badge>;
  if (p.inVehicleId === vehicleId) return <Badge tone="neutral" icon={Radio}>On board (RFID)</Badge>;
  return null;
}

export default function Stops() {
  usePageTitle("Stops");
  const { vehicle, route, manifest, alerts, device, readerOnline, actor, canAct } = useDriver();
  const { openAlerts, alerts: allAlerts, settings } = useOps();
  const now = useNow(5000);
  const run = useAction();
  const toast = useToast();

  const [delivering, setDelivering] = useState<Parcel | null>(null);
  const [receiver, setReceiver] = useState("");
  const [note, setNote] = useState("");
  const [blocked, setBlocked] = useState<string | null>(null);
  const [reporting, setReporting] = useState<Parcel | null>(null);
  const [issueType, setIssueType] = useState<AlertType>("delivery_mismatch");
  const [issueMsg, setIssueMsg] = useState("");
  const [busy, setBusy] = useState<"deliver" | "report" | "complete" | null>(null);

  if (!vehicle || !route) {
    return (
      <>
        <DriverHeading title="Stops" subtitle="Your delivery stops in order." />
        <NoRoute />
      </>
    );
  }

  const health = vehicleHealth(vehicle, openAlerts, device, settings, now);
  const location: GeoPoint | null = vehicle.location ? { lat: vehicle.location.lat, lng: vehicle.location.lng } : null;
  const remaining = remainingStops(manifest);
  const next = remaining[0];
  const inProgress = route.status === "in_progress";
  const canDeliver = inProgress && canAct;
  const delivered = manifest.filter((p) => p.status === "delivered").length;

  const openDeliver = (p: Parcel) => {
    setDelivering(p);
    setReceiver(p.recipientName);
    setNote("");
    setBlocked(null);
  };
  const openReport = (p: Parcel) => {
    setReporting(p);
    setIssueType("delivery_mismatch");
    setIssueMsg("");
  };

  const submitDelivery = async () => {
    if (!delivering || !actor) return;
    setBusy("deliver");
    let outcome: Awaited<ReturnType<typeof confirmDelivery>> | null = null;
    await run(async () => {
      outcome = await confirmDelivery({
        parcel: delivering,
        route,
        vehicle,
        alerts: allAlerts,
        actor,
        receiverName: receiver,
        note,
        location,
        readerOnline,
      });
    });
    setBusy(null);
    const o = outcome as Awaited<ReturnType<typeof confirmDelivery>> | null;
    if (!o) return;
    if (o.ok) {
      toast({
        tone: "success",
        title: `${delivering.trackingId} delivered`,
        body: o.method === "rfid+driver" ? "Hand-over verified by RFID and your confirmation." : "Confirmed by driver.",
      });
      setDelivering(null);
    } else {
      setBlocked(o.reason);
      toast({ tone: "warning", title: "Delivery blocked", body: "A delivery-mismatch alert was sent to dispatch." });
    }
  };

  const submitReport = async () => {
    if (!reporting || !actor) return;
    setBusy("report");
    const ok = await run(
      () => reportIssue({ parcel: reporting, vehicle, routeId: route.id, actor, type: issueType, message: issueMsg.trim(), location }),
      "Issue reported",
      "Dispatch has been alerted.",
    );
    setBusy(null);
    if (ok) setReporting(null);
  };

  const complete = async () => {
    if (!actor) return;
    setBusy("complete");
    await run(() => completeRoute(route, vehicle, actor), "Route completed", "Head back to the hub.");
    setBusy(null);
  };

  return (
    <div className="space-y-4">
      <DriverHeading
        title="Stops"
        subtitle={`${route.code} · ${delivered}/${manifest.length} delivered`}
        actions={<Badge tone={inProgress ? "navy" : "neutral"} dot pulse={inProgress}>{inProgress ? "En route" : route.status.replace("_", " ")}</Badge>}
      />
      <PreviewNote show={!canAct} />

      <div className="isolate overflow-hidden rounded-xl border border-border shadow-card">
        <FleetMap
          className="h-64"
          vehicles={[{ vehicle, health }]}
          stops={manifest}
          hub={route.hub}
          geofenceM={settings.geofenceM}
          selectedId={vehicle.id}
          fitKey={route.id}
          label={`Route map for ${route.code}`}
        />
      </div>
      {!vehicle.location && (
        <p className="flex items-center gap-1.5 text-[13px] text-fg-muted">
          <MapPin className="h-4 w-4" aria-hidden />
          No GPS position yet — turn on “Share phone GPS” on the Today tab if the vehicle has no GPS module.
        </p>
      )}

      {!inProgress && route.status !== "completed" && route.status !== "cancelled" && (
        <div className="rounded-xl border border-primary/25 bg-primary-soft p-4">
          <p className="flex items-start gap-2 text-[14px] font-medium text-primary">
            <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            Verify the load and start the route before confirming deliveries.
          </p>
          <LinkButton to="/driver/load" size="lg" icon={ClipboardCheck} className="mt-3 h-12 w-full">
            Go to Verify load
          </LinkButton>
        </div>
      )}

      {(route.status === "completed" || route.status === "cancelled") && (
        <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success-soft p-4 text-[14px] font-semibold text-success">
          <CheckCircle2 className="h-5 w-5" aria-hidden />
          Route {route.status}. {delivered}/{manifest.length} parcels delivered.
        </div>
      )}

      {/* Next stop */}
      {inProgress && next && (
        <Card className="border-l-4 border-l-primary">
          <div className="p-5">
            <p className="text-[12px] font-bold uppercase tracking-wider text-primary">Next stop · {next.stopSeq ?? 1} of {manifest.length}</p>
            <h2 className="mt-1 text-[20px] font-semibold leading-tight">{next.recipientName}</h2>
            <p className="mt-0.5 text-[15px] text-fg-muted">{next.address}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-fg-muted">
              <span className="font-mono font-semibold text-fg">{next.trackingId}</span>
              <span>{next.area}</span>
              {location && (
                <span className="tabular inline-flex items-center gap-1">
                  <Navigation className="h-3.5 w-3.5" aria-hidden />
                  {km(distanceM(location, next))} away
                </span>
              )}
              {next.priority === "express" && <Badge tone="warning">Express</Badge>}
              <RfidEvidence p={next} vehicleId={vehicle.id} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${next.lat},${next.lng}`}
                target="_blank"
                rel="noreferrer"
                className={buttonClass("outline", "lg", "h-12")}
              >
                <Navigation className="h-4 w-4" aria-hidden />
                Navigate
              </a>
              {next.recipientPhone ? (
                <a href={`tel:${next.recipientPhone}`} className={buttonClass("outline", "lg", "h-12")}>
                  <Phone className="h-4 w-4" aria-hidden />
                  Call
                </a>
              ) : (
                <Button variant="outline" size="lg" className="h-12" icon={TriangleAlert} disabled={!canDeliver} onClick={() => openReport(next)}>
                  Report issue
                </Button>
              )}
            </div>
            <Button size="lg" icon={PackageCheck} className="mt-2 h-12 w-full" disabled={!canDeliver} onClick={() => openDeliver(next)}>
              Confirm delivery
            </Button>
            {next.recipientPhone && (
              <button
                type="button"
                disabled={!canDeliver}
                onClick={() => openReport(next)}
                className="mt-2 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg text-[14px] font-semibold text-fg-muted hover:bg-surface-2 disabled:opacity-50"
              >
                <TriangleAlert className="h-4 w-4" aria-hidden />
                Report an issue with this stop
              </button>
            )}
          </div>
        </Card>
      )}

      {inProgress && !next && (
        <Card className="p-5">
          <p className="flex items-center gap-2 text-[16px] font-semibold text-success">
            <CheckCircle2 className="h-5 w-5" aria-hidden />
            All stops handled
          </p>
          <p className="mt-1 text-[14px] text-fg-muted">
            {delivered} delivered{manifest.length - delivered ? `, ${manifest.length - delivered} flagged as exceptions` : ""}. Complete the route to head back to the hub.
          </p>
          <Button size="lg" icon={Flag} className="mt-4 h-12 w-full" loading={busy === "complete"} disabled={!canAct} onClick={() => void complete()}>
            Complete route
          </Button>
        </Card>
      )}

      {/* All stops */}
      <Card>
        <CardHeader title="All stops" description={`${remaining.length} remaining · geofence ${settings.geofenceM} m`} />
        <ol className="divide-y divide-border">
          {manifest.map((p, i) => {
            const isNext = inProgress && next?.id === p.id;
            const done = p.status === "delivered";
            const exception = p.status === "exception";
            const actionable = canDeliver && !done && p.status !== "returned";
            return (
              <li key={p.id} className={cn("px-5 py-3.5", isNext && "bg-primary-soft/40")} aria-current={isNext ? "step" : undefined}>
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "tabular mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold",
                      done ? "bg-success text-white dark:text-bg" : exception ? "bg-danger text-white dark:text-bg" : "bg-navy text-white dark:bg-primary dark:text-primary-fg",
                    )}
                    aria-hidden
                  >
                    {done ? <CheckCircle2 className="h-4 w-4" /> : exception ? <XCircle className="h-4 w-4" /> : p.stopSeq ?? i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold">{p.recipientName}</span>
                      <ParcelStatusBadge status={p.status} />
                    </div>
                    <p className="text-[14px] text-fg-muted">{p.address}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-fg-subtle">
                      <span className="font-mono font-semibold text-fg-muted">{p.trackingId}</span>
                      {location && !done && <span className="tabular">{km(distanceM(location, p))}</span>}
                      {done && p.deliveredAt && <span>Delivered {ago(p.deliveredAt)}</span>}
                      <RfidEvidence p={p} vehicleId={vehicle.id} />
                    </div>
                    {actionable && !isNext && (
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" variant="outline" icon={PackageCheck} onClick={() => openDeliver(p)}>
                          Confirm delivery
                        </Button>
                        <Button size="sm" variant="ghost" icon={TriangleAlert} onClick={() => openReport(p)}>
                          Report issue
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </Card>

      {alerts.length > 0 && (
        <LinkButton to="/driver/alerts" variant="danger" size="lg" icon={ShieldX} className="h-12 w-full">
          {alerts.length} unresolved alert{alerts.length === 1 ? "" : "s"} on this vehicle
        </LinkButton>
      )}

      {/* Confirm delivery */}
      <Dialog
        open={!!delivering}
        onClose={() => setDelivering(null)}
        title={`Confirm delivery · ${delivering?.trackingId ?? ""}`}
        description={delivering ? `${delivering.recipientName} — ${delivering.address}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDelivering(null)}>
              Cancel
            </Button>
            <Button icon={PackageCheck} loading={busy === "deliver"} disabled={!receiver.trim()} onClick={() => void submitDelivery()}>
              {blocked ? "Try again" : "Confirm hand-over"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {blocked && (
            <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-[14px] text-danger">
              <p className="flex items-center gap-2 font-semibold">
                <ShieldX className="h-5 w-5" aria-hidden />
                Delivery blocked by RFID
              </p>
              <p className="mt-1">{blocked}</p>
              <p className="mt-1 text-fg-muted">A delivery-mismatch alert has been sent to dispatch.</p>
            </div>
          )}
          <div className="flex items-start gap-2 rounded-lg bg-surface-2 p-3 text-[13px] text-fg-muted">
            <Radio className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            {readerOnline
              ? delivering?.leftVehicleAt
                ? "RFID saw this parcel leave the vehicle at this stop — your confirmation completes a two-factor hand-over."
                : "The reader will check that this parcel is no longer in the cargo area before accepting your confirmation."
              : "The RFID reader is offline, so this delivery will be recorded as driver-confirmed only."}
          </div>
          <Field label="Received by" required help="Name of the person who took the parcel.">
            {(p) => <Input {...p} value={receiver} onChange={(e) => setReceiver(e.target.value)} autoComplete="off" />}
          </Field>
          <Field label="Note" help="Optional — e.g. left with security, gate code.">
            {(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />}
          </Field>
        </div>
      </Dialog>

      {/* Report issue */}
      <Dialog
        open={!!reporting}
        onClose={() => setReporting(null)}
        title={`Report issue · ${reporting?.trackingId ?? ""}`}
        description="Dispatch is alerted immediately and it’s logged in the audit trail."
        footer={
          <>
            <Button variant="ghost" onClick={() => setReporting(null)}>
              Cancel
            </Button>
            <Button variant="danger" icon={TriangleAlert} loading={busy === "report"} disabled={issueMsg.trim().length < 3} onClick={() => void submitReport()}>
              Send report
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="What kind of issue?" required>
            {(p) => (
              <Select {...p} value={issueType} onChange={(e) => setIssueType(e.target.value as AlertType)}>
                {ISSUE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Describe what happened" required>
            {(p) => (
              <Textarea {...p} value={issueMsg} onChange={(e) => setIssueMsg(e.target.value)} maxLength={500} placeholder="e.g. Customer refused the parcel — box is damaged." />
            )}
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
