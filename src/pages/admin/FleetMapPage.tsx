import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Gauge, Map as MapIcon, Navigation, Package, Radio } from "lucide-react";
import { activeRouteFor, useOps } from "@/context/OpsData";
import { useNow } from "@/hooks/useFirestore";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card, PageHeader, Progress, Segmented } from "@/components/ui/primitives";
import { HEALTH, HealthBadge, VehicleStatusBadge, readerOnline, vehicleHealth, type Health } from "@/components/ui/Status";
import { FleetMap } from "@/components/map/FleetMap";

export default function FleetMapPage() {
  useEffect(() => {
    document.title = "Fleet map · SmartRoute Guardian";
  }, []);
  const { vehicles, routes, parcels, openAlerts, deviceById, userById, settings } = useOps();
  const now = useNow(5000);
  const [filter, setFilter] = useState<"all" | Health>("all");
  const [selected, setSelected] = useState<string | null>(null);

  const fleet = useMemo(
    () =>
      vehicles.map((v) => {
        const device = v.deviceId ? deviceById.get(v.deviceId) : undefined;
        const route = activeRouteFor(v, routes);
        const manifest = route ? parcels.filter((p) => p.routeId === route.id) : [];
        return {
          vehicle: v,
          route,
          manifest,
          health: vehicleHealth(v, openAlerts, device, settings, now),
          online: readerOnline(device, settings, now),
          driver: v.driverId ? userById.get(v.driverId) : undefined,
          alerts: openAlerts.filter((a) => a.vehicleId === v.id).length,
        };
      }),
    [vehicles, routes, parcels, openAlerts, deviceById, userById, settings, now],
  );

  const shown = fleet.filter((f) => filter === "all" || f.health === filter);
  const sel = fleet.find((f) => f.vehicle.id === selected);
  const count = (h: Health) => fleet.filter((f) => f.health === h).length;

  return (
    <>
      <PageHeader
        title="Fleet map"
        description="Live vehicle positions from each gateway’s GPS. Select a vehicle to see its route stops and delivery geofences."
        actions={
          <Segmented
            label="Filter by status"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All", count: fleet.length },
              { value: "critical", label: "Critical", count: count("critical") },
              { value: "warning", label: "Attention", count: count("warning") },
              { value: "ok", label: "Verified", count: count("ok") },
              { value: "offline", label: "Offline", count: count("offline") },
            ]}
          />
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card className="overflow-hidden">
          <FleetMap
            className="h-[60dvh] min-h-[420px] lg:h-[calc(100dvh-220px)]"
            hub={settings.hub}
            vehicles={shown.map((f) => ({ vehicle: f.vehicle, health: f.health, subtitle: `${f.driver?.name ?? "No driver"} · ${f.route?.code ?? "no route"}` }))}
            stops={sel?.manifest ?? []}
            geofenceM={sel ? settings.geofenceM : undefined}
            selectedId={selected}
            onSelect={setSelected}
            fitKey={`map-${selected ?? "all"}-${filter}`}
          />
        </Card>

        <div className="space-y-3 lg:max-h-[calc(100dvh-220px)] lg:overflow-y-auto">
          {shown.length === 0 && (
            <Card className="p-6 text-center text-[14px] text-fg-muted">
              <MapIcon className="mx-auto mb-2 h-6 w-6" aria-hidden />
              No vehicles match this filter.
            </Card>
          )}
          {shown.map((f) => {
            const delivered = f.manifest.filter((p) => p.status === "delivered").length;
            const isSel = f.vehicle.id === selected;
            const loc = f.vehicle.location;
            return (
              <Card key={f.vehicle.id} className={cn("p-0 transition-shadow", isSel && "ring-2 ring-primary")}>
                <button
                  onClick={() => setSelected(isSel ? null : f.vehicle.id)}
                  aria-pressed={isSel}
                  className="w-full rounded-xl p-4 text-left hover:bg-surface-2/50"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: HEALTH[f.health].color }} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{f.vehicle.id}</span>
                        <span className="text-[13px] text-fg-muted">{f.vehicle.plate}</span>
                      </div>
                      <div className="text-[13px] text-fg-muted">{f.driver?.name ?? "No driver"}</div>
                    </div>
                    <HealthBadge health={f.health} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <VehicleStatusBadge status={f.vehicle.status} />
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
                    <div>
                      <dt className="flex items-center gap-1 text-fg-subtle"><Package className="h-3.5 w-3.5" aria-hidden />On board</dt>
                      <dd className="tabular font-semibold">{f.vehicle.presentCount ?? 0}</dd>
                    </div>
                    <div>
                      <dt className="flex items-center gap-1 text-fg-subtle"><Gauge className="h-3.5 w-3.5" aria-hidden />Speed</dt>
                      <dd className="tabular font-semibold">{loc?.speedKmh != null ? `${loc.speedKmh} km/h` : "—"}</dd>
                    </div>
                    <div>
                      <dt className="flex items-center gap-1 text-fg-subtle"><Radio className="h-3.5 w-3.5" aria-hidden />Reader</dt>
                      <dd className="font-semibold">{f.online ? "Online" : "Offline"}</dd>
                    </div>
                  </dl>
                  {f.route && (
                    <div className="mt-3">
                      <div className="mb-1 flex justify-between text-[12px] text-fg-muted">
                        <span>{f.route.code}</span>
                        <span className="tabular">{delivered}/{f.route.stopCount}</span>
                      </div>
                      <Progress value={(delivered / Math.max(1, f.route.stopCount)) * 100} tone="success" label={`${f.vehicle.id} progress`} />
                    </div>
                  )}
                  <p className="mt-2 flex items-center gap-1 text-[12px] text-fg-subtle">
                    <Navigation className="h-3.5 w-3.5" aria-hidden />
                    {loc ? `GPS ${ago(loc.updatedAt)} · ${loc.source ?? "gps"}` : "No GPS fix yet"}
                  </p>
                </button>
                {isSel && (
                  <div className="border-t border-border px-4 py-2.5">
                    <Link to={`/admin/vehicles/${f.vehicle.id}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline">
                      Open vehicle detail <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}
