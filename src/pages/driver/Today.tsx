import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { AlertOctagon, ArrowRight, CheckCircle2, ChevronRight, Flag, Info, MapPinned, Package, Play, Radio, Warehouse, type LucideIcon } from "lucide-react";
import { useDriver } from "@/components/layout/DriverLayout";
import { useAuth } from "@/context/AuthContext";
import { Button, Card, CardHeader, LinkButton, Progress } from "@/components/ui/primitives";
import { ReaderBadge, RouteStatusBadge } from "@/components/ui/Status";
import { useAction } from "@/components/ui/Toast";
import { completeRoute, startRoute } from "@/lib/actions";
import { ago } from "@/lib/format";
import { NoRoute, PreviewNote, usePageTitle } from "@/components/driver/common";
import { deriveJourney, JourneyStepper } from "@/components/driver/Journey";
import { PhoneGps } from "@/components/driver/PhoneGps";

/** The single primary call-to-action: either navigate somewhere or perform the next step. */
type PrimaryCta = { label: string; icon: LucideIcon } & (
  | { kind: "link"; to: string; danger?: boolean }
  | { kind: "action"; run: () => Promise<void> }
);

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function Today() {
  usePageTitle("Today");
  const { vehicle, route, manifest, alerts, readerOnline, actor, canAct, isPreview, driverName, device } = useDriver();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const run = useAction();
  const [busy, setBusy] = useState(false);

  const journey = deriveJourney(route, manifest, alerts);
  const delivered = manifest.filter((p) => p.status === "delivered").length;
  const exceptions = manifest.filter((p) => p.status === "exception").length;
  const total = manifest.length;
  const openAlerts = alerts.filter((a) => a.status === "open");
  const firstName = (isPreview ? driverName : profile?.name ?? "").split(" ")[0] || "there";

  const primary = ((): PrimaryCta | null => {
    const n = journey.next;
    switch (n.kind) {
      case "none":
        return null;
      case "load":
        return { kind: "link", label: n.label, icon: ArrowRight, to: "/driver/load" };
      case "stops":
        return { kind: "link", label: n.label, icon: MapPinned, to: "/driver/stops" };
      case "alerts":
        return {
          kind: "link",
          label: `Resolve ${n.count} open alert${n.count === 1 ? "" : "s"}`,
          icon: AlertOctagon,
          to: "/driver/alerts",
          danger: true,
        };
      case "start":
        return {
          kind: "action",
          label: "Start route",
          icon: Play,
          run: async () => {
            if (!route || !vehicle || !actor) return;
            setBusy(true);
            const ok = await run(() => startRoute(route, vehicle, manifest, actor), "Route started", "Drive safely — RFID is watching the cargo.");
            setBusy(false);
            if (ok) navigate("/driver/stops");
          },
        };
      case "complete":
        return {
          kind: "action",
          label: "Complete route",
          icon: Flag,
          run: async () => {
            if (!route || !vehicle || !actor) return;
            setBusy(true);
            await run(() => completeRoute(route, vehicle, actor), "Route completed", "Head back to the hub.");
            setBusy(false);
          },
        };
      case "done":
        return null;
    }
  })();

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[13px] font-semibold uppercase tracking-wider text-primary">{format(new Date(), "EEEE, d MMMM")}</p>
        <h1 className="text-[24px] font-semibold leading-tight">
          {greeting()}, {firstName}
        </h1>
      </div>

      <PreviewNote show={!canAct} />

      {openAlerts.length > 0 && (
        <Link
          to="/driver/alerts"
          className="flex items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft p-3.5 text-danger transition-colors hover:bg-danger-soft/70"
        >
          <AlertOctagon className="h-5 w-5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 text-[14px] font-semibold">
            {openAlerts.length} open alert{openAlerts.length === 1 ? "" : "s"} on {vehicle?.id} — {openAlerts[0]!.title}
          </span>
          <ChevronRight className="h-5 w-5 shrink-0" aria-hidden />
        </Link>
      )}

      {!vehicle ? (
        <Card className="p-5">
          <p className="text-[15px] font-semibold">No vehicle is assigned to your account.</p>
          <p className="mt-1 text-[14px] text-fg-muted">Ask an administrator to link you to a vehicle in People &amp; roles.</p>
        </Card>
      ) : !route ? (
        <NoRoute />
      ) : (
        <Card>
          <div className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[13px] font-semibold text-fg-muted">Today’s route</p>
                <p className="font-display text-[22px] font-semibold leading-tight">{route.code}</p>
              </div>
              <RouteStatusBadge status={route.status} />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-surface-2 px-2 py-2.5">
                <p className="tabular font-display text-[20px] font-semibold">{total}</p>
                <p className="text-[12px] text-fg-muted">Stops</p>
              </div>
              <div className="rounded-lg bg-surface-2 px-2 py-2.5">
                <p className="tabular font-display text-[20px] font-semibold text-success">{delivered}</p>
                <p className="text-[12px] text-fg-muted">Delivered</p>
              </div>
              <div className="rounded-lg bg-surface-2 px-2 py-2.5">
                <p className="tabular font-display text-[20px] font-semibold">{Math.max(0, total - delivered - exceptions)}</p>
                <p className="text-[12px] text-fg-muted">Remaining</p>
              </div>
            </div>
            <div className="mt-4 space-y-1.5">
              <div className="flex justify-between text-[13px] text-fg-muted">
                <span>Progress</span>
                <span className="tabular font-semibold text-fg">
                  {delivered}/{total} delivered{exceptions ? ` · ${exceptions} exception${exceptions === 1 ? "" : "s"}` : ""}
                </span>
              </div>
              <Progress value={total ? (delivered / total) * 100 : 0} tone="success" label="Route delivery progress" />
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-[13px] text-fg-muted">
              <Warehouse className="h-4 w-4" aria-hidden />
              {route.hub.name}
            </p>
          </div>

          {primary ? (
            <div className="border-t border-border p-4">
              {primary.kind === "link" ? (
                <LinkButton
                  to={primary.to}
                  size="lg"
                  variant={primary.danger ? "danger" : "primary"}
                  icon={primary.icon}
                  className="h-12 w-full"
                >
                  {primary.label}
                </LinkButton>
              ) : (
                <Button
                  size="lg"
                  icon={primary.icon}
                  className="h-12 w-full"
                  loading={busy}
                  disabled={!canAct}
                  onClick={() => void primary.run()}
                >
                  {primary.label}
                </Button>
              )}
              {primary.kind === "action" && !canAct && <p className="mt-2 text-center text-[13px] text-fg-muted">Read-only preview — only the assigned driver or an admin can do this.</p>}
            </div>
          ) : journey.phase === "done" ? (
            <div className="flex items-center gap-2 border-t border-border bg-success-soft p-4 text-[14px] font-semibold text-success">
              <CheckCircle2 className="h-5 w-5" aria-hidden />
              Route {route.status === "cancelled" ? "cancelled" : "completed"} — nice work today.
            </div>
          ) : null}
        </Card>
      )}

      {route && (
        <Card>
          <CardHeader title="Your journey" description="Start route → Verify load → Drive route → Confirm delivery → Resolve alert" />
          <div className="p-5">
            <JourneyStepper journey={journey} />
            {journey.next.kind === "start" && !route.loadVerifiedAt && !route.loadVerification?.passed && (
              <p className="mt-3 flex items-start gap-2 text-[13px] text-fg-muted">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                The route can only start after a passing load check.
              </p>
            )}
          </div>
        </Card>
      )}

      {vehicle && (
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <Radio className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[15px] font-semibold">RFID cargo reader</h2>
                <ReaderBadge online={readerOnline} />
              </div>
              <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-fg-muted">
                <span className="inline-flex items-center gap-1">
                  <Package className="h-3.5 w-3.5" aria-hidden />
                  <span className="tabular">{vehicle.presentCount ?? vehicle.presentEpcs?.length ?? 0}</span> tags in cargo
                </span>
                <span>Last scan {ago(vehicle.lastScanAt, "never")}</span>
                {device && <span className="font-mono text-[12px]">{device.id}</span>}
              </p>
              {!readerOnline && (
                <p className="mt-2 text-[13px] text-warning">
                  The reader isn’t reporting. You can still verify the load with a manual check.
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      {vehicle && <PhoneGps vehicle={vehicle} canAct={canAct} />}
    </div>
  );
}
