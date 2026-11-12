import { useMemo } from "react";
import { HelpCircle, ShieldCheck } from "lucide-react";
import { useDriver } from "@/components/layout/DriverLayout";
import { useOps } from "@/context/OpsData";
import { AlertItem } from "@/components/alerts/AlertItem";
import { Card, EmptyState } from "@/components/ui/primitives";
import { ALERT_TYPE } from "@/components/ui/Status";
import { DriverHeading, PreviewNote, sortAlerts, usePageTitle } from "@/components/driver/common";

export default function Alerts() {
  usePageTitle("Alerts");
  const { vehicle, alerts, actor, canAct } = useDriver();
  const { alerts: all } = useOps();

  const open = useMemo(() => sortAlerts(alerts), [alerts]);
  const resolved = useMemo(
    () => all.filter((a) => a.vehicleId === vehicle?.id && a.status === "resolved").slice(0, 10),
    [all, vehicle?.id],
  );
  const openCount = alerts.filter((a) => a.status === "open").length;

  return (
    <div className="space-y-4">
      <DriverHeading
        title="Alerts"
        subtitle={
          alerts.length
            ? `${openCount} open · ${alerts.length - openCount} acknowledged on ${vehicle?.id ?? "your vehicle"}`
            : `Nothing needs your attention on ${vehicle?.id ?? "your vehicle"}`
        }
      />
      <PreviewNote show={!canAct} />

      {open.length === 0 ? (
        <Card>
          <EmptyState icon={ShieldCheck} title="All clear">
            No open exceptions. If RFID spots a missing, misplaced or wrongly removed parcel, it will appear here within seconds.
          </EmptyState>
        </Card>
      ) : (
        <section aria-label="Unresolved alerts" className="space-y-3">
          {open.map((a) => (
            <AlertItem key={a.id} alert={a} actor={actor} canAct={canAct} linkBase="/driver" />
          ))}
        </section>
      )}

      {resolved.length > 0 && (
        <section aria-labelledby="resolved-heading" className="space-y-3">
          <h2 id="resolved-heading" className="pt-2 text-[15px] font-semibold text-fg-muted">
            Recently resolved
          </h2>
          {resolved.map((a) => (
            <AlertItem key={a.id} alert={a} actor={actor} canAct={false} compact linkBase="/driver" />
          ))}
        </section>
      )}

      <details className="card group p-4">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-[15px] font-semibold">
          <HelpCircle className="h-5 w-5 text-primary" aria-hidden />
          What do these alerts mean?
        </summary>
        <dl className="mt-3 space-y-3">
          {Object.entries(ALERT_TYPE).map(([key, m]) => (
            <div key={key} className="flex gap-3">
              <m.icon className="mt-0.5 h-5 w-5 shrink-0 text-fg-muted" aria-hidden />
              <div>
                <dt className="text-[14px] font-semibold">{m.label}</dt>
                <dd className="text-[13px] text-fg-muted">{m.description}</dd>
              </div>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
