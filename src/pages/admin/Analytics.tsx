import { useEffect, useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { Bell, CheckCircle2, PackageCheck, ShieldCheck, Timer, Truck } from "lucide-react";
import { useOps } from "@/context/OpsData";
import { alertsByDay, alertsByType, deliveriesByDay, latencyHistogram, latencyStats, loadDetection } from "@/lib/metrics";
import { dayKey, toMillis } from "@/lib/format";
import { pct } from "@/lib/utils";
import { Card, CardHeader, PageHeader, Segmented, Table, Td, Th } from "@/components/ui/primitives";
import { Kpi } from "@/components/ui/Kpi";
import { ALERT_TYPE } from "@/components/ui/Status";
import { BarSeries, ChartFrame, LineSeries, useViz } from "@/components/charts/Charts";

type Range = "7" | "14" | "30";

export default function Analytics() {
  useEffect(() => {
    document.title = "Analytics · SmartRoute Guardian";
  }, []);
  const { parcels, alerts, routes, vehicles, settings, loading } = useOps();
  const viz = useViz();
  const [range, setRange] = useState<Range>("7");
  const days = Number(range);
  const sinceMs = subDays(new Date(), days - 1).setHours(0, 0, 0, 0);
  const sinceKey = format(sinceMs, "yyyy-MM-dd");

  const d = useMemo(() => {
    const inRange = alerts.filter((a) => (toMillis(a.createdAt) ?? 0) >= sinceMs);
    const delivered = parcels.filter((p) => p.status === "delivered" && dayKey(p.deliveredAt) >= sinceKey);
    const rfid = delivered.filter((p) => p.deliveryProof?.method === "rfid+driver").length;
    const lat = latencyStats(alerts, sinceMs);
    const det = loadDetection(routes, sinceKey);
    const typeRows = alertsByType(inRange).map((r) => ({ ...r, label: ALERT_TYPE[r.type].label }));
    const perVehicle = vehicles.map((v) => {
      const vr = routes.filter((r) => r.vehicleId === v.id && r.date >= sinceKey);
      const vd = delivered.filter((p) => p.vehicleId === v.id);
      const va = inRange.filter((a) => a.vehicleId === v.id);
      const vdet = loadDetection(vr);
      return {
        vehicle: v.id,
        routes: vr.length,
        delivered: vd.length,
        rfidPct: vd.length ? pct(vd.filter((p) => p.deliveryProof?.method === "rfid+driver").length, vd.length, 0) : null,
        alerts: va.length,
        critical: va.filter((a) => a.severity === "critical").length,
        detection: vdet.rate,
      };
    });
    return {
      inRange,
      delivered: delivered.length,
      rfid,
      lat,
      det,
      byDay: deliveriesByDay(parcels, days),
      alertDays: alertsByDay(alerts, days),
      hist: latencyHistogram(lat.values),
      typeRows,
      perVehicle,
    };
  }, [alerts, parcels, routes, vehicles, sinceMs, sinceKey, days]);

  const deliverySeries = [
    { key: "rfid", label: "RFID + driver verified", color: viz.series[0]! },
    { key: "driver", label: "Driver confirmation only", color: viz.series[1]! },
  ];
  const severitySeries = [
    { key: "critical", label: "Critical", color: viz.critical },
    { key: "warning", label: "Warning", color: viz.serious },
    { key: "info", label: "Info", color: viz.neutral },
  ];

  return (
    <>
      <PageHeader
        title="Analytics"
        description="How well RFID verification is working across the fleet — computed live from the audit data."
        actions={
          <Segmented
            label="Time range"
            value={range}
            onChange={setRange}
            options={[
              { value: "7", label: "7 days" },
              { value: "14", label: "14 days" },
              { value: "30", label: "30 days" },
            ]}
          />
        }
      />

      <section aria-label="Summary" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi loading={loading} label="Deliveries" icon={PackageCheck} value={d.delivered} hint={`Last ${days} days`} tone="primary" />
        <Kpi loading={loading} label="RFID-verified handovers" icon={ShieldCheck} value={d.delivered ? pct(d.rfid, d.delivered, 0) : "—"} unit={d.delivered ? "%" : undefined} hint={`${d.rfid} of ${d.delivered} deliveries`} tone="success" />
        <Kpi
          loading={loading}
          label="Load-check detection"
          icon={CheckCircle2}
          value={d.det.rate == null ? "—" : d.det.rate.toFixed(1)}
          unit={d.det.rate == null ? undefined : "%"}
          hint={`${d.det.detected}/${d.det.expected} parcels over ${d.det.checks} RFID checks`}
          tone={d.det.rate == null ? "neutral" : d.det.rate >= settings.targetLoadingDetection ? "success" : "warning"}
        />
        <Kpi
          loading={loading}
          label="Alert latency"
          icon={Timer}
          value={d.lat.avg == null ? "—" : d.lat.avg.toFixed(1)}
          unit={d.lat.avg == null ? undefined : "s avg"}
          hint={d.lat.p95 == null ? "No device alerts" : `p50 ${d.lat.p50!.toFixed(1)} s · p95 ${d.lat.p95.toFixed(1)} s`}
          tone={d.lat.avg == null ? "neutral" : d.lat.avg < settings.targetLatencySec ? "success" : "warning"}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartFrame
          title="Deliveries per day"
          description="Stacked by how the handover was verified"
          summary={`Daily deliveries for the last ${days} days. Total ${d.delivered}, of which ${d.rfid} were RFID-verified.`}
          series={deliverySeries}
          columns={[{ key: "day", label: "Day" }, { key: "rfid", label: "RFID + driver", numeric: true }, { key: "driver", label: "Driver only", numeric: true }, { key: "total", label: "Total", numeric: true }]}
          rows={d.byDay}
          empty={d.byDay.every((x) => x.total === 0)}
        >
          <BarSeries data={d.byDay} xKey="day" series={deliverySeries} stacked unit="parcels" />
        </ChartFrame>

        <ChartFrame
          title="Alerts per day"
          description="By severity (critical alerts need immediate action)"
          summary={`Alerts per day for the last ${days} days, ${d.inRange.length} in total.`}
          series={severitySeries}
          columns={[{ key: "day", label: "Day" }, { key: "critical", label: "Critical", numeric: true }, { key: "warning", label: "Warning", numeric: true }, { key: "info", label: "Info", numeric: true }]}
          rows={d.alertDays}
          empty={d.alertDays.every((x) => x.total === 0)}
        >
          <BarSeries data={d.alertDays} xKey="day" series={severitySeries} stacked unit="alerts" />
        </ChartFrame>

        <ChartFrame
          title="RFID load-check detection rate"
          description={`Each point is one RFID load verification · dashed lines = pilot targets (${settings.targetLoadingDetection}% loading, ${settings.targetStaticDetection}% static)`}
          summary={`Detection rate across ${d.det.checks} RFID load checks; overall ${d.det.rate?.toFixed(1) ?? "n/a"} percent.`}
          columns={[{ key: "label", label: "Check" }, { key: "route", label: "Route" }, { key: "rate", label: "Detection %", numeric: true }]}
          rows={d.det.series}
          empty={d.det.series.length === 0}
        >
          <LineSeries
            data={d.det.series}
            xKey="label"
            series={[{ key: "rate", label: "Detection rate", color: viz.series[0]! }]}
            unit="%"
            yDomain={[Math.min(70, ...d.det.series.map((s) => s.rate ?? 100)), 100]}
            references={[
              { value: settings.targetLoadingDetection, label: `${settings.targetLoadingDetection}% target` },
              { value: settings.targetStaticDetection, label: `${settings.targetStaticDetection}%` },
            ]}
          />
        </ChartFrame>

        <ChartFrame
          title="Detection → alert latency"
          description={`Time from the physical event (last RFID read) to the alert reaching Firestore · target under ${settings.targetLatencySec} s`}
          summary={`Latency distribution of ${d.lat.count} device alerts. Average ${d.lat.avg?.toFixed(1) ?? "n/a"} seconds.`}
          columns={[{ key: "bucket", label: "Latency" }, { key: "count", label: "Alerts", numeric: true }]}
          rows={d.hist}
          empty={d.lat.count === 0}
        >
          <BarSeries data={d.hist} xKey="bucket" series={[{ key: "count", label: "Alerts", color: viz.series[0]! }]} unit="alerts" />
        </ChartFrame>

        <ChartFrame
          title="Alerts by type"
          description={`Last ${days} days`}
          summary={d.typeRows.map((r) => `${r.label}: ${r.count}`).join(", ")}
          columns={[{ key: "label", label: "Type" }, { key: "count", label: "Alerts", numeric: true }]}
          rows={d.typeRows}
          empty={d.typeRows.every((r) => r.count === 0)}
        >
          <BarSeries data={d.typeRows} xKey="label" layout="vertical" series={[{ key: "count", label: "Alerts", color: viz.series[0]! }]} unit="alerts" height={260} />
        </ChartFrame>

        <Card>
          <CardHeader icon={Truck} title="Per-vehicle performance" description={`Last ${days} days`} />
          <Table label="Per-vehicle performance">
            <thead>
              <tr>
                <Th>Vehicle</Th>
                <Th className="text-right">Routes</Th>
                <Th className="text-right">Delivered</Th>
                <Th className="text-right">RFID-verified</Th>
                <Th className="text-right">Detection</Th>
                <Th className="text-right"><span className="inline-flex items-center gap-1"><Bell className="h-3.5 w-3.5" aria-hidden />Alerts</span></Th>
              </tr>
            </thead>
            <tbody>
              {d.perVehicle.map((r) => (
                <tr key={r.vehicle}>
                  <Td className="font-semibold">{r.vehicle}</Td>
                  <Td className="tabular text-right">{r.routes}</Td>
                  <Td className="tabular text-right">{r.delivered}</Td>
                  <Td className="tabular text-right">{r.rfidPct == null ? "—" : `${r.rfidPct}%`}</Td>
                  <Td className="tabular text-right">{r.detection == null ? "—" : `${r.detection.toFixed(1)}%`}</Td>
                  <Td className="tabular text-right">
                    {r.alerts}
                    {r.critical ? <span className="text-danger"> ({r.critical} critical)</span> : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
