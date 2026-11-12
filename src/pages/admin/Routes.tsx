import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckSquare, Plus, Route as RouteIcon, Square, Wand2, XCircle } from "lucide-react";
import { useOps } from "@/context/OpsData";
import { useAuth } from "@/context/AuthContext";
import type { GeoPoint, Parcel, Route } from "@/lib/types";
import { cancelRoute, createRoute } from "@/lib/actions";
import { distanceM } from "@/lib/verification";
import { km, todayKey } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Segmented, Select, Table, Td, Th } from "@/components/ui/primitives";
import { RouteStatusBadge } from "@/components/ui/Status";
import { Dialog } from "@/components/ui/Dialog";
import { useAction } from "@/components/ui/Toast";

type Tab = "today" | "open" | "past" | "all";

/** Greedy nearest-neighbour ordering from the hub — simple, explainable, good enough for ≤50 stops. */
export function orderStops(start: GeoPoint, parcels: Parcel[]): Parcel[] {
  const left = [...parcels];
  const out: Parcel[] = [];
  let cur = start;
  while (left.length) {
    let bi = 0;
    let bd = Infinity;
    left.forEach((p, i) => {
      const d = distanceM(cur, p);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    const next = left.splice(bi, 1)[0]!;
    out.push(next);
    cur = next;
  }
  return out;
}

function pathLength(start: GeoPoint, stops: Parcel[]): number {
  let d = 0;
  let cur = start;
  for (const s of stops) {
    d += distanceM(cur, s);
    cur = s;
  }
  return d;
}

export default function RoutesPage() {
  useEffect(() => {
    document.title = "Routes & dispatch · SmartRoute Guardian";
  }, []);
  const { routes, vehicleById, userById, parcels } = useOps();
  const { isAdmin, actor } = useAuth();
  const [tab, setTab] = useState<Tab>("today");
  const [planOpen, setPlanOpen] = useState(false);
  const [cancelling, setCancelling] = useState<Route | null>(null);
  const run = useAction();
  const today = todayKey();

  const shown = routes.filter((r) =>
    tab === "today" ? r.date === today : tab === "open" ? ["planned", "loading", "in_progress"].includes(r.status) : tab === "past" ? r.date < today : true,
  );

  return (
    <>
      <PageHeader
        title="Routes & dispatch"
        description="Plan a route, assign it to a vehicle and driver, and follow it from load verification to the last delivery."
        actions={isAdmin && <Button icon={Plus} onClick={() => setPlanOpen(true)}>Plan route</Button>}
      />
      <Segmented
        className="mb-4"
        label="Route filter"
        value={tab}
        onChange={setTab}
        options={[
          { value: "today", label: "Today", count: routes.filter((r) => r.date === today).length },
          { value: "open", label: "Open", count: routes.filter((r) => ["planned", "loading", "in_progress"].includes(r.status)).length },
          { value: "past", label: "Past", count: routes.filter((r) => r.date < today).length },
          { value: "all", label: "All", count: routes.length },
        ]}
      />
      <Card>
        {shown.length === 0 ? (
          <EmptyState icon={RouteIcon} title="No routes here" action={isAdmin && <Button icon={Plus} onClick={() => setPlanOpen(true)}>Plan route</Button>}>
            Routes group RFID-tagged parcels into an ordered list of stops for one vehicle.
          </EmptyState>
        ) : (
          <Table label="Routes">
            <thead>
              <tr>
                <Th>Route</Th>
                <Th>Date</Th>
                <Th>Vehicle · driver</Th>
                <Th>Status</Th>
                <Th>Delivered</Th>
                <Th>Load check</Th>
                {isAdmin && <Th><span className="sr-only">Actions</span></Th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const lv = r.loadVerification;
                return (
                  <tr key={r.id} className="hover:bg-surface-2/50">
                    <Td className="font-semibold">{r.code}</Td>
                    <Td className="tabular">{r.date}</Td>
                    <Td>
                      <Link to={`/admin/vehicles/${r.vehicleId}`} className="font-semibold text-primary hover:underline">{r.vehicleId}</Link>
                      <div className="text-[12px] text-fg-muted">{userById.get(r.driverId ?? "")?.name ?? "No driver"} · {vehicleById.get(r.vehicleId)?.plate}</div>
                    </Td>
                    <Td><RouteStatusBadge status={r.status} /></Td>
                    <Td className="tabular">{r.deliveredCount}/{r.stopCount}</Td>
                    <Td>
                      {lv ? (
                        <Badge tone={lv.passed ? "success" : "danger"}>
                          {lv.passed ? "Passed" : "Failed"} {lv.detected}/{lv.expected}
                          {lv.method === "manual" ? " · manual" : ""}
                        </Badge>
                      ) : (
                        <span className="text-[13px] text-fg-subtle">Not yet</span>
                      )}
                    </Td>
                    {isAdmin && (
                      <Td className="text-right">
                        {["planned", "loading", "in_progress"].includes(r.status) && (
                          <Button variant="ghost" size="sm" icon={XCircle} onClick={() => setCancelling(r)}>
                            Cancel
                          </Button>
                        )}
                      </Td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <PlanRouteDialog open={planOpen} onClose={() => setPlanOpen(false)} />

      <Dialog
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        size="sm"
        title={`Cancel ${cancelling?.code}?`}
        description="Undelivered parcels go back to the unassigned pool and the vehicle returns to idle."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelling(null)}>Keep route</Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!cancelling || !actor) return;
                const ok = await run(() => cancelRoute(cancelling, parcels, actor), "Route cancelled");
                if (ok) setCancelling(null);
              }}
            >
              Cancel route
            </Button>
          </>
        }
      >
        <p className="text-[14px] text-fg-muted">This is logged in the audit trail.</p>
      </Dialog>
    </>
  );
}

function PlanRouteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { vehicles, users, parcels, routes, settings } = useOps();
  const { actor } = useAuth();
  const run = useAction();
  const [date, setDate] = useState(todayKey());
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pool = useMemo(() => parcels.filter((p) => p.status === "registered").sort((a, b) => a.area.localeCompare(b.area)), [parcels]);
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const busyVehicle = routes.find((r) => r.vehicleId === vehicleId && ["planned", "loading", "in_progress"].includes(r.status));
  const chosen = selected.map((id) => pool.find((p) => p.id === id)).filter((p): p is Parcel => !!p);
  const dist = pathLength(settings.hub, chosen);

  useEffect(() => {
    if (!open) return;
    setDate(todayKey());
    setSelected([]);
    setErr(null);
    const free = vehicles.find((v) => !routes.some((r) => r.vehicleId === v.id && ["planned", "loading", "in_progress"].includes(r.status)));
    setVehicleId(free?.id ?? vehicles[0]?.id ?? "");
  }, [open, vehicles, routes]);

  useEffect(() => {
    setDriverId(vehicle?.driverId ?? "");
  }, [vehicle?.driverId]);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = async () => {
    if (!vehicle || !actor) return setErr("Choose a vehicle.");
    if (!chosen.length) return setErr("Select at least one parcel.");
    if (chosen.length > vehicle.capacity) return setErr(`${vehicle.id} holds ${vehicle.capacity} parcels; ${chosen.length} selected.`);
    if (busyVehicle) return setErr(`${vehicle.id} already has an open route (${busyVehicle.code}). Complete or cancel it first.`);
    setErr(null);
    setBusy(true);
    const ok = await run(
      () => createRoute({ vehicle, driverId: driverId || null, parcels: chosen, date, hub: settings.hub, actor }),
      "Route created",
      "The driver sees it in their app; load verification starts as parcels are loaded.",
    );
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title="Plan a route"
      description="Pick a vehicle and the parcels to deliver. Stops can be ordered automatically from the hub."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button icon={RouteIcon} loading={busy} onClick={submit} disabled={!chosen.length}>
            Create route with {chosen.length} stop{chosen.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Date">
          {(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <Field label="Vehicle" error={busyVehicle ? `Has open route ${busyVehicle.code}` : null}>
          {(p) => (
            <Select {...p} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.id} · {v.plate} (cap {v.capacity})</option>)}
            </Select>
          )}
        </Field>
        <Field label="Driver">
          {(p) => (
            <Select {...p} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">No driver</option>
              {users.filter((u) => u.role === "driver").map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          )}
        </Field>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[14px] font-semibold">Unassigned parcels ({pool.length})</h3>
            <Button variant="ghost" size="sm" onClick={() => setSelected(selected.length === pool.length ? [] : pool.map((p) => p.id))}>
              {selected.length === pool.length && pool.length ? "Clear" : "Select all"}
            </Button>
          </div>
          <ul className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
            {pool.length === 0 && <li className="p-4 text-center text-[13px] text-fg-muted">No unassigned parcels — register some first.</li>}
            {pool.map((p) => {
              const on = selected.includes(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggle(p.id)}
                    className={cn("flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[14px]", on ? "bg-primary-soft" : "hover:bg-surface-2")}
                  >
                    {on ? <CheckSquare className="h-5 w-5 shrink-0 text-primary" aria-hidden /> : <Square className="h-5 w-5 shrink-0 text-fg-subtle" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="font-mono text-[12px] font-semibold">{p.trackingId}</span> · {p.recipientName}
                      <span className="block text-[12px] text-fg-muted">{p.area} · {km(distanceM(settings.hub, p))} from hub</span>
                    </span>
                    {p.priority === "express" && <Badge tone="warning">Express</Badge>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[14px] font-semibold">Stop order · {km(dist)} total</h3>
            <Button variant="outline" size="sm" icon={Wand2} disabled={chosen.length < 2} onClick={() => setSelected(orderStops(settings.hub, chosen).map((p) => p.id))}>
              Optimise order
            </Button>
          </div>
          <ol className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
            {chosen.length === 0 && <li className="p-4 text-center text-[13px] text-fg-muted">Selected parcels appear here in delivery order.</li>}
            {chosen.map((p, i) => (
              <li key={p.id} className="flex items-center gap-3 rounded-md px-3 py-2 text-[14px]">
                <span className="tabular inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy text-[12px] font-bold text-white dark:bg-primary dark:text-primary-fg">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{p.recipientName} · {p.area}</span>
              </li>
            ))}
          </ol>
          {vehicle && chosen.length > vehicle.capacity && <p className="mt-2 text-[13px] text-danger">Over capacity ({vehicle.capacity}).</p>}
        </div>
      </div>
      {err && <p role="alert" className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-[14px] text-danger">{err}</p>}
    </Dialog>
  );
}
