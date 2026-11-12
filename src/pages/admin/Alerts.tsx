import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertOctagon, AlertTriangle, BellRing, CheckCircle2, Download, Hourglass, Timer } from "lucide-react";
import { useOps } from "@/context/OpsData";
import { useAuth } from "@/context/AuthContext";
import type { AlertSeverity, AlertType } from "@/lib/types";
import { alertLatency, latencyStats, resolutionMinutes } from "@/lib/metrics";
import { dateTime } from "@/lib/format";
import { downloadCsv } from "@/lib/utils";
import { Button, Card, EmptyState, PageHeader, Segmented, Select } from "@/components/ui/primitives";
import { Kpi } from "@/components/ui/Kpi";
import { ALERT_TYPE } from "@/components/ui/Status";
import { AlertItem } from "@/components/alerts/AlertItem";

type StatusTab = "active" | "open" | "acknowledged" | "resolved" | "all";

export default function Alerts() {
  useEffect(() => {
    document.title = "Exception alerts · SmartRoute Guardian";
  }, []);
  const { alerts, vehicles, settings, loading } = useOps();
  const { actor, canWrite } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("status") as StatusTab) || "active";
  const severity = (params.get("severity") as AlertSeverity | "") || "";
  const type = (params.get("type") as AlertType | "") || "";
  const vehicle = params.get("vehicle") ?? "";
  const [limit, setLimit] = useState(40);
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
  };

  const filtered = useMemo(
    () =>
      alerts
        .filter((a) => (tab === "active" ? a.status !== "resolved" : tab === "all" ? true : a.status === tab))
        .filter((a) => !severity || a.severity === severity)
        .filter((a) => !type || a.type === type)
        .filter((a) => !vehicle || a.vehicleId === vehicle)
        .sort((a, b) => {
          const rank = { critical: 0, warning: 1, info: 2 };
          if (tab === "active" && a.severity !== b.severity) return rank[a.severity] - rank[b.severity];
          return (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0);
        }),
    [alerts, tab, severity, type, vehicle],
  );

  const stats = useMemo(() => {
    const lat = latencyStats(alerts);
    const res = alerts.map(resolutionMinutes).filter((x): x is number => x != null);
    return {
      openCritical: alerts.filter((a) => a.status === "open" && a.severity === "critical").length,
      openWarning: alerts.filter((a) => a.status !== "resolved" && a.severity === "warning").length,
      lat,
      mttr: res.length ? res.reduce((s, x) => s + x, 0) / res.length : null,
      resolved: alerts.filter((a) => a.status === "resolved").length,
    };
  }, [alerts]);

  const exportCsv = () =>
    downloadCsv(
      `alerts-${new Date().toISOString().slice(0, 10)}.csv`,
      filtered.map((a) => ({
        id: a.id,
        type: a.type,
        severity: a.severity,
        status: a.status,
        vehicle: a.vehicleId,
        parcel: a.trackingId ?? "",
        title: a.title,
        message: a.message,
        detectedAt: dateTime(a.detectedAt, ""),
        createdAt: dateTime(a.createdAt, ""),
        latencySec: alertLatency(a)?.toFixed(2) ?? "",
        resolvedAt: dateTime(a.resolvedAt, ""),
        resolvedBy: a.resolvedBy?.name ?? "",
        resolution: a.resolution ?? "",
        source: a.source,
      })),
    );

  return (
    <>
      <PageHeader
        title="Exception alerts"
        description="Raised automatically by RFID gateways (or by drivers) when parcel evidence and the plan disagree. Every action is logged."
        actions={<Button variant="outline" icon={Download} onClick={exportCsv} disabled={!filtered.length}>Export CSV</Button>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi loading={loading} label="Open critical" icon={AlertOctagon} value={stats.openCritical} tone={stats.openCritical ? "danger" : "success"} hint={stats.openCritical ? "Need action now" : "None open"} />
        <Kpi loading={loading} label="Warnings active" icon={AlertTriangle} value={stats.openWarning} tone={stats.openWarning ? "warning" : "neutral"} hint="Open + acknowledged" />
        <Kpi
          loading={loading}
          label="Detection → alert latency"
          icon={Timer}
          value={stats.lat.avg == null ? "—" : stats.lat.avg.toFixed(1)}
          unit={stats.lat.avg == null ? undefined : "s avg"}
          tone={stats.lat.avg == null ? "neutral" : stats.lat.avg < settings.targetLatencySec ? "success" : "warning"}
          hint={stats.lat.p95 == null ? "No device alerts yet" : `p95 ${stats.lat.p95.toFixed(1)} s · target < ${settings.targetLatencySec} s`}
        />
        <Kpi loading={loading} label="Mean time to resolve" icon={Hourglass} value={stats.mttr == null ? "—" : stats.mttr < 90 ? Math.round(stats.mttr) : (stats.mttr / 60).toFixed(1)} unit={stats.mttr == null ? undefined : stats.mttr < 90 ? "min" : "h"} hint={`${stats.resolved} resolved`} />
      </div>

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Segmented
            label="Alert status"
            value={tab}
            onChange={(v) => set("status", v === "active" ? "" : v)}
            options={[
              { value: "active", label: "Active", count: alerts.filter((a) => a.status !== "resolved").length },
              { value: "open", label: "Open", count: alerts.filter((a) => a.status === "open").length },
              { value: "acknowledged", label: "Acknowledged", count: alerts.filter((a) => a.status === "acknowledged").length },
              { value: "resolved", label: "Resolved", count: stats.resolved },
              { value: "all", label: "All", count: alerts.length },
            ]}
          />
          <div className="ml-auto flex flex-wrap gap-3">
            <div>
              <label htmlFor="f-sev" className="label mb-1.5 block">Severity</label>
              <Select id="f-sev" value={severity} onChange={(e) => set("severity", e.target.value)} className="w-36">
                <option value="">All</option>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
              </Select>
            </div>
            <div>
              <label htmlFor="f-type" className="label mb-1.5 block">Type</label>
              <Select id="f-type" value={type} onChange={(e) => set("type", e.target.value)} className="w-48">
                <option value="">All types</option>
                {(Object.keys(ALERT_TYPE) as AlertType[]).map((t) => <option key={t} value={t}>{ALERT_TYPE[t].label}</option>)}
              </Select>
            </div>
            <div>
              <label htmlFor="f-veh" className="label mb-1.5 block">Vehicle</label>
              <Select id="f-veh" value={vehicle} onChange={(e) => set("vehicle", e.target.value)} className="w-36">
                <option value="">All</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}
              </Select>
            </div>
          </div>
        </div>
      </Card>

      <div className="space-y-3" aria-live="polite">
        {!loading && filtered.length === 0 && (
          <Card>
            <EmptyState icon={tab === "resolved" ? BellRing : CheckCircle2} title={tab === "active" ? "No active alerts" : "Nothing matches"}>
              {tab === "active" ? "Every parcel is where the plan says it should be." : "Try other filters."}
            </EmptyState>
          </Card>
        )}
        {filtered.slice(0, limit).map((a) => (
          <AlertItem key={a.id} alert={a} actor={actor} canAct={canWrite} />
        ))}
        {filtered.length > limit && (
          <div className="text-center">
            <Button variant="ghost" onClick={() => setLimit((l) => l + 40)}>Show more ({filtered.length - limit})</Button>
          </div>
        )}
      </div>

      <Card className="mt-8 p-5">
        <h2 className="mb-3 text-[15px] font-semibold">What each alert means</h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(ALERT_TYPE) as AlertType[]).map((t) => {
            const m = ALERT_TYPE[t];
            return (
              <div key={t} className="flex gap-3">
                <m.icon className="mt-0.5 h-5 w-5 shrink-0 text-fg-muted" aria-hidden />
                <div>
                  <dt className="text-[14px] font-semibold">{m.label}</dt>
                  <dd className="text-[13px] text-fg-muted">{m.description}</dd>
                </div>
              </div>
            );
          })}
        </dl>
      </Card>
    </>
  );
}
