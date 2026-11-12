import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Cpu, MapPin, Package, Pencil, Plus, Truck, User } from "lucide-react";
import { activeRouteFor, useOps } from "@/context/OpsData";
import { useAuth } from "@/context/AuthContext";
import { useNow } from "@/hooks/useFirestore";
import { ago } from "@/lib/format";
import type { Vehicle } from "@/lib/types";
import { Button, Card, EmptyState, IconButton, PageHeader, Progress, Skeleton } from "@/components/ui/primitives";
import { HealthBadge, ReaderBadge, VehicleStatusBadge, readerOnline, vehicleHealth } from "@/components/ui/Status";
import { VehicleDialog } from "@/components/admin/VehicleDialog";

export default function Vehicles() {
  useEffect(() => {
    document.title = "Vehicles · SmartRoute Guardian";
  }, []);
  const { vehicles, routes, parcels, openAlerts, deviceById, userById, settings, loading } = useOps();
  const { isAdmin } = useAuth();
  const now = useNow(5000);
  const [editing, setEditing] = useState<Vehicle | undefined>();
  const [open, setOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Vehicles"
        description="Each vehicle carries an RFID gateway that continuously verifies which parcels are in its cargo area."
        actions={
          isAdmin && (
            <Button icon={Plus} onClick={() => { setEditing(undefined); setOpen(true); }}>
              Add vehicle
            </Button>
          )
        }
      />

      {loading && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
        </div>
      )}
      {!loading && vehicles.length === 0 && (
        <Card>
          <EmptyState icon={Truck} title="No vehicles yet" action={isAdmin && <Button icon={Plus} onClick={() => setOpen(true)}>Add vehicle</Button>}>
            Add your first delivery vehicle, then install an RFID gateway in it.
          </EmptyState>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {vehicles.map((v) => {
          const device = v.deviceId ? deviceById.get(v.deviceId) : undefined;
          const online = readerOnline(device, settings, now);
          const health = vehicleHealth(v, openAlerts, device, settings, now);
          const route = activeRouteFor(v, routes);
          const manifest = route ? parcels.filter((p) => p.routeId === route.id) : [];
          const delivered = manifest.filter((p) => p.status === "delivered").length;
          const expected = manifest.filter((p) => p.status !== "delivered" && p.status !== "returned").length;
          const detected = manifest.filter((p) => (v.presentEpcs ?? []).includes(p.epc)).length;
          const driver = v.driverId ? userById.get(v.driverId) : undefined;
          return (
            <Card key={v.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-3 border-b border-border p-4">
                <div className="min-w-0">
                  <Link to={`/admin/vehicles/${v.id}`} className="font-display text-lg font-semibold hover:text-primary">
                    {v.id}
                  </Link>
                  <p className="text-[13px] text-fg-muted">
                    {v.plate} · {v.name}
                  </p>
                </div>
                {isAdmin && <IconButton label={`Edit ${v.id}`} icon={Pencil} onClick={() => { setEditing(v); setOpen(true); }} />}
              </div>
              <div className="flex flex-1 flex-col gap-3 p-4">
                <div className="flex flex-wrap gap-2">
                  <VehicleStatusBadge status={v.status} />
                  <HealthBadge health={health} />
                  {v.deviceId && <ReaderBadge online={online} />}
                </div>
                <dl className="grid grid-cols-2 gap-3 text-[13px]">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-fg-subtle" aria-hidden />
                    <div><dt className="sr-only">Driver</dt><dd>{driver?.name ?? "No driver"}</dd></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-fg-subtle" aria-hidden />
                    <div><dt className="sr-only">Reader</dt><dd>{v.deviceId ?? "No reader"}</dd></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-fg-subtle" aria-hidden />
                    <div><dt className="sr-only">Detected on board</dt><dd className="tabular">{v.presentCount ?? 0} tags in cargo</dd></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-fg-subtle" aria-hidden />
                    <div><dt className="sr-only">Last GPS</dt><dd>{v.location ? ago(v.location.updatedAt) : "No GPS"}</dd></div>
                  </div>
                </dl>
                {route ? (
                  <div className="mt-auto space-y-2 rounded-lg bg-surface-2/60 p-3">
                    <div className="flex justify-between text-[13px]">
                      <span className="font-semibold">{route.code}</span>
                      <span className="tabular text-fg-muted">{delivered}/{route.stopCount} delivered</span>
                    </div>
                    <Progress value={(delivered / Math.max(1, route.stopCount)) * 100} tone="success" label={`${v.id} delivery progress`} />
                    <p className="tabular text-[12px] text-fg-muted">
                      RFID sees {detected} of {expected} undelivered parcels on board
                    </p>
                  </div>
                ) : (
                  <p className="mt-auto rounded-lg bg-surface-2/60 p-3 text-[13px] text-fg-muted">No active route</p>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <VehicleDialog open={open} onClose={() => setOpen(false)} vehicle={editing} />
    </>
  );
}
