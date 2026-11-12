import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, limit, orderBy, query, where } from "firebase/firestore";
import { ArrowLeft, Bell, CheckCircle2, CircleSlash, Cpu, Map as MapIcon, Package, Pencil, ScrollText, Smartphone, TriangleAlert } from "lucide-react";
import { db } from "@/lib/firebase";
import { useLiveQuery, useNow } from "@/hooks/useFirestore";
import { activeRouteFor, useOps } from "@/context/OpsData";
import { useAuth } from "@/context/AuthContext";
import type { AuditEvent } from "@/lib/types";
import { ago, dateTime, seconds } from "@/lib/format";
import { checkLoad } from "@/lib/verification";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, CardHeader, EmptyState, LinkButton, PageHeader, Progress, Table, Td, Th } from "@/components/ui/primitives";
import { HealthBadge, ParcelStatusBadge, ReaderBadge, RouteStatusBadge, VehicleStatusBadge, readerOnline, vehicleHealth } from "@/components/ui/Status";
import { FleetMap } from "@/components/map/FleetMap";
import { AlertItem } from "@/components/alerts/AlertItem";
import { EventRow } from "@/components/events/EventRow";
import { VehicleDialog } from "@/components/admin/VehicleDialog";

export default function VehicleDetail() {
  const { vehicleId = "" } = useParams();
  const { vehicleById, routes, parcels, parcelByEpc, openAlerts, deviceById, userById, settings, loading } = useOps();
  const { isAdmin, actor, canWrite } = useAuth();
  const now = useNow(3000);
  const [editOpen, setEditOpen] = useState(false);
  const v = vehicleById.get(vehicleId);
  useEffect(() => {
    document.title = `${vehicleId} · Vehicles · SmartRoute Guardian`;
  }, [vehicleId]);

  const events = useLiveQuery<AuditEvent>(
    vehicleId ? query(collection(db, "events"), where("vehicleId", "==", vehicleId), orderBy("createdAt", "desc"), limit(40)) : null,
    `veh-events:${vehicleId}`,
  );

  const route = activeRouteFor(v, routes);
  const manifest = useMemo(
    () => (route ? parcels.filter((p) => p.routeId === route.id).sort((a, b) => (a.stopSeq ?? 0) - (b.stopSeq ?? 0)) : []),
    [route, parcels],
  );
  const present = new Set(v?.presentEpcs ?? []);
  const check = checkLoad(manifest, present);
  const foreign = [...present].filter((e) => !manifest.some((p) => p.epc === e));
  const device = v?.deviceId ? deviceById.get(v.deviceId) : undefined;
  const online = readerOnline(device, settings, now);
  const alerts = openAlerts.filter((a) => a.vehicleId === vehicleId);
  const driver = v?.driverId ? userById.get(v.driverId) : undefined;
  const pastRoutes = routes.filter((r) => r.vehicleId === vehicleId && r.id !== route?.id).slice(0, 6);

  if (!loading && !v) {
    return (
      <Card>
        <EmptyState icon={CircleSlash} title="Vehicle not found" action={<LinkButton to="/admin/vehicles" variant="outline" icon={ArrowLeft}>All vehicles</LinkButton>}>
          No vehicle with ID “{vehicleId}”.
        </EmptyState>
      </Card>
    );
  }
  if (!v) return null;
  const health = vehicleHealth(v, openAlerts, device, settings, now);
  const delivered = manifest.filter((p) => p.status === "delivered").length;

  return (
    <>
      <Link to="/admin/vehicles" className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Vehicles
      </Link>
      <PageHeader
        title={`${v.id} · ${v.plate}`}
        description={`${v.name} · ${driver ? `Driver ${driver.name}` : "No driver assigned"} · capacity ${v.capacity} parcels`}
        actions={
          <>
            <div className="flex flex-wrap gap-2">
              <VehicleStatusBadge status={v.status} />
              <HealthBadge health={health} />
              {v.deviceId && <ReaderBadge online={online} />}
            </div>
            <LinkButton
              to="/driver"
              variant="outline"
              icon={Smartphone}
              onClick={() => {
                try {
                  localStorage.setItem("srg-preview-vehicle", v.id);
                } catch {
                  /* preview falls back to the first vehicle */
                }
              }}
            >
              Driver view
            </LinkButton>
            {isAdmin && <Button variant="outline" icon={Pencil} onClick={() => setEditOpen(true)}>Edit</Button>}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            icon={Package}
            title="Cargo verification"
            description={
              route
                ? `Manifest for ${route.code} vs. tags the reader detects right now · last scan ${ago(v.lastScanAt)}`
                : "No active route — showing tags detected in the cargo area"
            }
            actions={route && <RouteStatusBadge status={route.status} />}
          />
          {route && (
            <div className="grid gap-4 border-b border-border p-5 sm:grid-cols-3">
              <div>
                <p className="text-[13px] text-fg-muted">Detected / expected on board</p>
                <p className="tabular font-display text-2xl font-semibold">
                  {check.detected}<span className="text-base text-fg-muted">/{check.expected}</span>
                </p>
                <Progress value={check.rate} tone={check.passed ? "success" : "warning"} label="Detection rate" />
              </div>
              <div>
                <p className="text-[13px] text-fg-muted">Delivered</p>
                <p className="tabular font-display text-2xl font-semibold">
                  {delivered}<span className="text-base text-fg-muted">/{route.stopCount}</span>
                </p>
                <Progress value={(delivered / Math.max(1, route.stopCount)) * 100} tone="success" label="Delivery progress" />
              </div>
              <div>
                <p className="text-[13px] text-fg-muted">Load verification</p>
                {route.loadVerification ? (
                  <>
                    <p className="mt-1 flex items-center gap-1.5 text-[14px] font-semibold">
                      {route.loadVerification.passed ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> : <TriangleAlert className="h-4 w-4 text-danger" aria-hidden />}
                      {route.loadVerification.passed ? "Passed" : "Failed"} · {route.loadVerification.detected}/{route.loadVerification.expected}
                    </p>
                    <p className="text-[12px] text-fg-muted">
                      {dateTime(route.loadVerification.at)} by {route.loadVerification.by?.name}
                      {route.loadVerification.durationSec != null && ` · ${seconds(route.loadVerification.durationSec, 0)} check`}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-[14px] text-fg-muted">Not verified yet</p>
                )}
              </div>
            </div>
          )}
          <Table label={`Parcels for ${v.id}`}>
            <thead>
              <tr>
                <Th>Stop</Th>
                <Th>Parcel</Th>
                <Th>Recipient</Th>
                <Th>Status</Th>
                <Th>RFID in this vehicle</Th>
                <Th>Last read</Th>
              </tr>
            </thead>
            <tbody>
              {manifest.map((p) => {
                const inside = present.has(p.epc);
                const shouldBe = p.status !== "delivered" && p.status !== "returned";
                return (
                  <tr key={p.id} className={cn(shouldBe && !inside && "bg-danger-soft/40")}>
                    <Td className="tabular font-semibold">{p.stopSeq ?? "—"}</Td>
                    <Td>
                      <Link to={`/admin/parcels/${p.id}`} className="font-mono text-[13px] font-semibold text-primary hover:underline">{p.trackingId}</Link>
                      <div className="epc text-fg-subtle">…{p.epc.slice(-8)}</div>
                    </Td>
                    <Td>
                      <div>{p.recipientName}</div>
                      <div className="text-[12px] text-fg-muted">{p.area}</div>
                    </Td>
                    <Td><ParcelStatusBadge status={p.status} /></Td>
                    <Td>
                      {inside ? (
                        <Badge tone="success" icon={CheckCircle2}>Detected</Badge>
                      ) : shouldBe ? (
                        <Badge tone="danger" icon={TriangleAlert}>Not detected</Badge>
                      ) : (
                        <Badge tone="neutral">Off board</Badge>
                      )}
                    </Td>
                    <Td className="text-[13px] text-fg-muted">{ago(p.lastSeenAt)}</Td>
                  </tr>
                );
              })}
              {foreign.map((epc) => {
                const p = parcelByEpc.get(epc);
                return (
                  <tr key={epc} className="bg-warning-soft/50">
                    <Td>—</Td>
                    <Td>
                      {p ? (
                        <Link to={`/admin/parcels/${p.id}`} className="font-mono text-[13px] font-semibold text-primary hover:underline">{p.trackingId}</Link>
                      ) : (
                        <span className="font-mono text-[13px] font-semibold">Unknown tag</span>
                      )}
                      <div className="epc text-fg-subtle">…{epc.slice(-8)}</div>
                    </Td>
                    <Td>{p ? `${p.recipientName} · assigned to ${p.vehicleId ?? "none"}` : "Not registered"}</Td>
                    <Td>{p ? <ParcelStatusBadge status={p.status} /> : "—"}</Td>
                    <Td><Badge tone="warning" icon={TriangleAlert}>{p ? "Wrong vehicle" : "Unknown"}</Badge></Td>
                    <Td className="text-[13px] text-fg-muted">{ago(v.lastScanAt)}</Td>
                  </tr>
                );
              })}
              {manifest.length === 0 && foreign.length === 0 && (
                <tr>
                  <Td colSpan={6} className="py-8 text-center text-fg-muted">No parcels assigned and no tags detected.</Td>
                </tr>
              )}
            </tbody>
          </Table>
        </Card>

        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader icon={MapIcon} title="Route map" description={v.location ? `GPS ${ago(v.location.updatedAt)} · ${v.location.speedKmh ?? 0} km/h` : "No GPS fix yet"} />
            <FleetMap
              className="h-72"
              hub={route?.hub ?? settings.hub}
              vehicles={[{ vehicle: v, health }]}
              stops={manifest}
              geofenceM={settings.geofenceM}
              fitKey={`vd-${v.id}-${route?.id}`}
              label={`${v.id} route map`}
            />
          </Card>

          <Card>
            <CardHeader icon={Cpu} title="RFID gateway" description={device ? device.model : "No reader installed"} />
            {device ? (
              <dl className="grid grid-cols-2 gap-3 p-5 text-[13px]">
                <div><dt className="text-fg-subtle">Reader ID</dt><dd className="font-semibold">{device.id}</dd></div>
                <div><dt className="text-fg-subtle">Firmware</dt><dd className="font-semibold">{device.firmware}</dd></div>
                <div><dt className="text-fg-subtle">Heartbeat</dt><dd className="font-semibold">{ago(device.lastHeartbeat)}</dd></div>
                <div><dt className="text-fg-subtle">Reads / min</dt><dd className="tabular font-semibold">{device.stats?.readsPerMin ?? "—"}</dd></div>
                <div><dt className="text-fg-subtle">CPU temp</dt><dd className="tabular font-semibold">{device.stats?.cpuTempC != null ? `${device.stats.cpuTempC} °C` : "—"}</dd></div>
                <div><dt className="text-fg-subtle">Queued writes</dt><dd className="tabular font-semibold">{device.stats?.queueDepth ?? 0}</dd></div>
              </dl>
            ) : (
              <p className="p-5 text-[14px] text-fg-muted">Install a gateway and link it under Edit.</p>
            )}
          </Card>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader icon={Bell} title="Open alerts" description={`${alerts.length} unresolved for ${v.id}`} />
          <div className="space-y-3 p-4">
            {alerts.length === 0 ? <EmptyState icon={CheckCircle2} title="No open alerts" /> : alerts.map((a) => <AlertItem key={a.id} alert={a} actor={actor} canAct={canWrite} />)}
          </div>
        </Card>
        <Card>
          <CardHeader icon={ScrollText} title="Audit trail" description="Every load, unload, delivery and alert for this vehicle" />
          <ul className="divide-y divide-border px-4">
            {events.data.length === 0 && !events.loading && <EmptyState icon={ScrollText} title="No events yet" />}
            {events.data.map((e) => <EventRow key={e.id} e={e} showTime="full" />)}
          </ul>
        </Card>
      </div>

      {pastRoutes.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Recent routes" />
          <Table label="Recent routes">
            <thead>
              <tr><Th>Route</Th><Th>Date</Th><Th>Status</Th><Th>Delivered</Th><Th>Load check</Th></tr>
            </thead>
            <tbody>
              {pastRoutes.map((r) => (
                <tr key={r.id}>
                  <Td className="font-semibold">{r.code}</Td>
                  <Td>{r.date}</Td>
                  <Td><RouteStatusBadge status={r.status} /></Td>
                  <Td className="tabular">{r.deliveredCount}/{r.stopCount}</Td>
                  <Td className="tabular">{r.loadVerification ? `${r.loadVerification.detected}/${r.loadVerification.expected}` : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <VehicleDialog open={editOpen} onClose={() => setEditOpen(false)} vehicle={v} />
    </>
  );
}
