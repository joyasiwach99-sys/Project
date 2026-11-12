import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { collection, limit, orderBy, query } from "firebase/firestore";
import { format } from "date-fns";
import {
  ArrowRight,
  Bell,
  CheckCircle2,
  Database,
  FlaskConical,
  Map as MapIcon,
  PackageCheck,
  Radar,
  ScrollText,
  Timer,
  Truck,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useLiveQuery, useNow } from "@/hooks/useFirestore";
import { activeRouteFor, useOps } from "@/context/OpsData";
import { useAuth } from "@/context/AuthContext";
import type { AuditEvent } from "@/lib/types";
import { deliveriesByDay, deliveredOn, latencyStats, loadDetection } from "@/lib/metrics";
import { ago, todayKey } from "@/lib/format";
import { Card, CardHeader, EmptyState, LinkButton, PageHeader, Progress, Skeleton } from "@/components/ui/primitives";
import { Kpi } from "@/components/ui/Kpi";
import { HealthBadge, ReaderBadge, VehicleStatusBadge, readerOnline, vehicleHealth } from "@/components/ui/Status";
import { FleetMap } from "@/components/map/FleetMap";
import { AlertItem } from "@/components/alerts/AlertItem";
import { EventRow } from "@/components/events/EventRow";
import { BarSeries, ChartFrame, useViz } from "@/components/charts/Charts";

export default function Overview() {
  useEffect(() => {
    document.title = "Overview · SmartRoute Guardian";
  }, []);
  const { vehicles, parcels, routes, openAlerts, alerts, deviceById, userById, settings, loading } = useOps();
  const { isAdmin, actor, canWrite } = useAuth();
  const now = useNow(5000);
  const viz = useViz();
  const feed = useLiveQuery<AuditEvent>(query(collection(db, "events"), orderBy("createdAt", "desc"), limit(14)), "overview-feed");

  const m = useMemo(() => {
    const today = todayKey();
    const onRoad = vehicles.filter((v) => v.status === "en_route").length;
    const inTransit = parcels.filter((p) => p.status === "in_transit" || p.status === "loaded").length;
    const deliveredToday = deliveredOn(parcels, today);
    const rfidToday = deliveredToday.filter((p) => p.deliveryProof?.method === "rfid+driver").length;
    const critical = openAlerts.filter((a) => a.severity === "critical" && a.status === "open").length;
    const det = loadDetection(routes, format(new Date(now - 7 * 864e5), "yyyy-MM-dd"));
    const lat = latencyStats(alerts, now - 7 * 864e5);
    const exceptions = parcels.filter((p) => p.status === "exception").length;
    return { onRoad, inTransit, deliveredToday: deliveredToday.length, rfidToday, critical, det, lat, exceptions };
  }, [vehicles, parcels, routes, openAlerts, alerts, now]);

  const fleet = vehicles.map((v) => {
    const device = v.deviceId ? deviceById.get(v.deviceId) : undefined;
    const route = activeRouteFor(v, routes);
    return {
      vehicle: v,
      device,
      route,
      health: vehicleHealth(v, openAlerts, device, settings, now),
      online: readerOnline(device, settings, now),
      driver: v.driverId ? userById.get(v.driverId) : undefined,
    };
  });

  const deliveries = deliveriesByDay(parcels, 7);
  const series = [
    { key: "rfid", label: "RFID + driver verified", color: viz.series[0]! },
    { key: "driver", label: "Driver confirmation only", color: viz.series[1]! },
  ];
  const urgent = openAlerts.filter((a) => a.status === "open").slice(0, 4);
  const empty = !loading && vehicles.length === 0;

  return (
    <>
      <PageHeader
        eyebrow={format(new Date(), "EEEE, d MMMM yyyy")}
        title="Operations overview"
        description="Live verification status of every vehicle, parcel and RFID reader in the pilot fleet."
        actions={
          <>
            <LinkButton to="/admin/map" variant="outline" icon={MapIcon}>Fleet map</LinkButton>
            {isAdmin && (
              <LinkButton to="/admin/simulator" variant="navy" icon={FlaskConical}>Device simulator</LinkButton>
            )}
          </>
        }
      />

      {empty && (
        <Card className="mb-6">
          <EmptyState
            icon={Database}
            title="No fleet data yet"
            action={
              isAdmin ? (
                <LinkButton to="/admin/settings" icon={Database}>Load demo dataset</LinkButton>
              ) : undefined
            }
          >
            {isAdmin ? "Load the demo dataset from Settings, or add vehicles and parcels to begin." : "An administrator hasn’t added any vehicles yet."}
          </EmptyState>
        </Card>
      )}

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi loading={loading} label="Vehicles en route" icon={Truck} value={m.onRoad} unit={`/ ${vehicles.length}`} hint={`${fleet.filter((f) => f.online).length} readers online`} tone="primary" />
        <Kpi loading={loading} label="Parcels on board" icon={Radar} value={m.inTransit} hint={`${m.exceptions} exception${m.exceptions === 1 ? "" : "s"}`} tone={m.exceptions ? "warning" : "neutral"} />
        <Kpi loading={loading} label="Delivered today" icon={PackageCheck} value={m.deliveredToday} hint={`${m.rfidToday} RFID-verified handovers`} tone="success" />
        <Kpi
          loading={loading}
          label="Unresolved alerts"
          icon={Bell}
          value={openAlerts.length}
          hint={m.critical ? `${m.critical} critical, unacknowledged` : "No critical alerts"}
          tone={m.critical ? "danger" : openAlerts.length ? "warning" : "success"}
        />
        <Kpi
          loading={loading}
          label="Load detection (7 d)"
          icon={CheckCircle2}
          value={m.det.rate == null ? "—" : m.det.rate.toFixed(1)}
          unit={m.det.rate == null ? undefined : "%"}
          hint={m.det.rate == null ? "No RFID load checks yet" : `${m.det.rate >= settings.targetLoadingDetection ? "Meets" : "Below"} ${settings.targetLoadingDetection}% target · ${m.det.checks} checks`}
          tone={m.det.rate == null ? "neutral" : m.det.rate >= settings.targetLoadingDetection ? "success" : "warning"}
        />
        <Kpi
          loading={loading}
          label="Avg alert latency (7 d)"
          icon={Timer}
          value={m.lat.avg == null ? "—" : m.lat.avg.toFixed(1)}
          unit={m.lat.avg == null ? undefined : "s"}
          hint={m.lat.avg == null ? "No device alerts yet" : `${m.lat.avg < settings.targetLatencySec ? "Under" : "Over"} ${settings.targetLatencySec} s target · ${m.lat.count} alerts`}
          tone={m.lat.avg == null ? "neutral" : m.lat.avg < settings.targetLatencySec ? "success" : "warning"}
        />
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="overflow-hidden xl:col-span-2">
          <CardHeader
            icon={MapIcon}
            title="Fleet status"
            description="Green = verified · amber = needs attention · red = critical alert · grey = reader offline"
            actions={
              <Link to="/admin/map" className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline">
                Full map <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            }
          />
          <FleetMap
            className="h-[340px]"
            hub={settings.hub}
            vehicles={fleet.map((f) => ({ vehicle: f.vehicle, health: f.health, subtitle: f.driver?.name }))}
            fitKey={`ov-${vehicles.length}`}
            label="Fleet status map"
          />
        </Card>

        <Card className="flex flex-col">
          <CardHeader
            icon={Bell}
            title="Needs attention"
            description={`${openAlerts.filter((a) => a.status === "open").length} open · ${openAlerts.filter((a) => a.status === "acknowledged").length} acknowledged`}
            actions={
              <Link to="/admin/alerts" className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline">
                All alerts <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            }
          />
          <div className="flex-1 space-y-3 p-4">
            {urgent.length === 0 ? (
              <EmptyState icon={CheckCircle2} title="All clear">Every parcel is where it should be.</EmptyState>
            ) : (
              urgent.map((a) => <AlertItem key={a.id} alert={a} actor={actor} canAct={canWrite} compact />)
            )}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader icon={Truck} title="Vehicles" description="Manifest vs. what the RFID reader currently detects in each cargo area" />
          <ul className="divide-y divide-border">
            {loading &&
              [0, 1, 2].map((i) => (
                <li key={i} className="p-4">
                  <Skeleton className="h-12 w-full" />
                </li>
              ))}
            {fleet.map(({ vehicle: v, route, health, online, driver }) => {
              const manifest = route ? parcels.filter((p) => p.routeId === route.id) : [];
              const delivered = manifest.filter((p) => p.status === "delivered").length;
              const onBoard = manifest.filter((p) => p.inVehicleId === v.id).length;
              const pending = manifest.filter((p) => p.status !== "delivered" && p.status !== "returned").length;
              return (
                <li key={v.id}>
                  <Link to={`/admin/vehicles/${v.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 transition-colors hover:bg-surface-2/60">
                    <div className="min-w-[150px] flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{v.id}</span>
                        <span className="text-[13px] text-fg-muted">{v.plate}</span>
                      </div>
                      <div className="text-[13px] text-fg-muted">{driver?.name ?? "No driver"} · {v.name}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <VehicleStatusBadge status={v.status} />
                      <HealthBadge health={health} />
                      {v.deviceId && <ReaderBadge online={online} />}
                    </div>
                    <div className="w-full sm:w-56">
                      {route ? (
                        <>
                          <div className="mb-1 flex justify-between text-[12px] text-fg-muted">
                            <span>{route.code}</span>
                            <span className="tabular">
                              {delivered}/{route.stopCount} delivered · {onBoard}/{pending} on board
                            </span>
                          </div>
                          <Progress value={(delivered / Math.max(1, route.stopCount)) * 100} tone="success" label={`${v.id} route progress`} />
                        </>
                      ) : (
                        <span className="text-[13px] text-fg-subtle">No active route</span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card className="flex flex-col">
          <CardHeader
            icon={ScrollText}
            title="Live activity"
            description="Newest audit-trail events"
            actions={
              <Link to="/admin/audit" className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline">
                Audit trail <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            }
          />
          <ul className="flex-1 divide-y divide-border px-4" aria-live="polite">
            {feed.loading && <Skeleton className="my-4 h-40 w-full" />}
            {!feed.loading && feed.data.length === 0 && <EmptyState icon={ScrollText} title="No events yet" />}
            {feed.data.map((e) => (
              <EventRow key={e.id} e={e} />
            ))}
          </ul>
          {feed.data[0] && <p className="border-t border-border px-5 py-2 text-[12px] text-fg-subtle">Last event {ago(feed.data[0].createdAt)}</p>}
        </Card>
      </div>

      <div className="mt-6">
        <ChartFrame
          title="Deliveries — last 7 days"
          description="Handovers confirmed by the driver, split by whether RFID also saw the parcel leave the vehicle at its stop"
          summary={`Deliveries over the last 7 days: ${deliveries.map((d) => `${d.day} ${d.total}`).join(", ")}.`}
          series={series}
          columns={[
            { key: "day", label: "Day" },
            { key: "rfid", label: "RFID + driver", numeric: true },
            { key: "driver", label: "Driver only", numeric: true },
            { key: "total", label: "Total", numeric: true },
          ]}
          rows={deliveries}
          empty={deliveries.every((d) => d.total === 0)}
          actions={
            <Link to="/admin/analytics" className="text-[13px] font-semibold text-primary hover:underline">
              More analytics
            </Link>
          }
        >
          <BarSeries data={deliveries} xKey="day" series={series} stacked height={240} unit="parcels" />
        </ChartFrame>
      </div>
    </>
  );
}
