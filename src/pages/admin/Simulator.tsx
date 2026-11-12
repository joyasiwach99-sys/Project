import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Ban,
  Cpu,
  FlaskConical,
  Home,
  MapPin,
  Navigation,
  Pause,
  Play,
  Radio,
  Shuffle,
  Tag,
  Trash2,
  Truck,
  Zap,
} from "lucide-react";
import { activeRouteFor, useOps } from "@/context/OpsData";
import { useAuth } from "@/context/AuthContext";
import type { Actor, Alert, GeoPoint, Parcel } from "@/lib/types";
import { PresenceTracker, decideArrival, decideDeparture, distanceM, type Decision, type EngineParcel } from "@/lib/verification";
import { applyDecisions, heartbeat, publishLocation, publishPresence, type AppliedDecision } from "@/lib/gateway";
import { clock, km } from "@/lib/format";
import { cn, randomEpc } from "@/lib/utils";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Select } from "@/components/ui/primitives";
import { HealthBadge, ParcelStatusBadge, RouteStatusBadge, readerOnline, vehicleHealth } from "@/components/ui/Status";
import { FleetMap } from "@/components/map/FleetMap";
import { useToast } from "@/components/ui/Toast";

interface LogLine extends AppliedDecision {
  t: number;
}

const ALERT_KINDS: Partial<Record<Decision["kind"], Alert["type"]>> = {
  wrong_vehicle: "wrong_vehicle",
  unknown_tag: "unknown_tag",
  delivered_but_present: "delivery_mismatch",
  wrong_stop: "delivery_mismatch",
  unauthorized_removal: "unauthorized_removal",
};

function toEngine(p: Parcel): EngineParcel {
  return { id: p.id, epc: p.epc, trackingId: p.trackingId, vehicleId: p.vehicleId, routeId: p.routeId, status: p.status, inVehicleId: p.inVehicleId, lat: p.lat, lng: p.lng };
}

export default function Simulator() {
  useEffect(() => {
    document.title = "Device simulator · SmartRoute Guardian";
  }, []);
  const ops = useOps();
  const { vehicles, routes, parcels, openAlerts, deviceById, settings } = ops;
  const { profile } = useAuth();
  const toast = useToast();

  const [vehicleId, setVehicleId] = useState("");
  const vehicle = vehicles.find((v) => v.id === vehicleId) ?? vehicles[0];
  const route = activeRouteFor(vehicle, routes);
  const manifest = useMemo(
    () => (route ? parcels.filter((p) => p.routeId === route.id).sort((a, b) => (a.stopSeq ?? 0) - (b.stopSeq ?? 0)) : []),
    [route, parcels],
  );

  const [running, setRunning] = useState(false);
  const [missRate, setMissRate] = useState(10);
  const [keepAllOnline, setKeepAllOnline] = useState(true);
  const [cargo, setCargo] = useState<string[]>([]);
  const [loc, setLoc] = useState<(GeoPoint & { speedKmh?: number }) | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [driving, setDriving] = useState(false);

  // Mutable state the 1-second loop reads without re-subscribing.
  const tracker = useRef(new PresenceTracker(settings.absenceTimeoutSec * 1000));
  const live = useRef({ cargo, loc, missRate, ops, vehicle, route, manifest });
  live.current = { cargo, loc, missRate, ops, vehicle, route, manifest };
  const recentAlerts = useRef<{ key: string; t: number }[]>([]);
  const lastPublished = useRef<string>("");
  const lastHb = useRef(0);
  const lastLoc = useRef<string>("");
  const busy = useRef(false);
  const keepAllOnlineRef = useRef(keepAllOnline);
  keepAllOnlineRef.current = keepAllOnline;

  const actor: Actor = useMemo(
    () => ({ type: "simulator", id: profile?.id ?? "sim", name: `Simulator · ${vehicle?.deviceId ?? vehicle?.id ?? ""}` }),
    [profile?.id, vehicle?.deviceId, vehicle?.id],
  );

  // Reset local state when switching vehicles.
  useEffect(() => {
    if (!vehicle) return;
    setRunning(false);
    setCargo(vehicle.presentEpcs ?? []);
    setLoc(vehicle.location ? { lat: vehicle.location.lat, lng: vehicle.location.lng, speedKmh: 0 } : { ...settings.hub, speedKmh: 0 });
    tracker.current = new PresenceTracker(settings.absenceTimeoutSec * 1000);
    lastPublished.current = (vehicle.presentEpcs ?? []).join(",");
    lastLoc.current = "";
    setLog([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id]);

  const pushLog = (lines: AppliedDecision[]) => {
    if (!lines.length) return;
    const t = Date.now();
    setLog((l) => [...lines.map((x) => ({ ...x, t })), ...l].slice(0, 60));
  };

  const tick = useCallback(async () => {
    const { cargo, loc, missRate, ops, vehicle, route, manifest } = live.current;
    if (!vehicle || busy.current) return;
    busy.current = true;
    const now = Date.now();
    try {
      // 1. One inventory round: each tag in the cargo area is read unless it "misses" this round.
      const reads = cargo.filter(() => Math.random() * 100 >= missRate);
      const { arrived, departed } = tracker.current.ingest(reads, now);

      // 2. Decide.
      const parcelsByEpc = new Map(ops.parcels.map((p) => [p.epc, toEngine(p)]));
      const ctx = { vehicleId: vehicle.id, routeStatus: route?.status ?? null, location: loc, parcelsByEpc, geofenceM: ops.settings.geofenceM };
      const routeParcels = manifest.map(toEngine);
      const decisions: Decision[] = [
        ...arrived.flatMap((e) => decideArrival(e, ctx, now)),
        ...departed.flatMap((d) => decideDeparture(d.epc, d.lastSeen, ctx, now, routeParcels)),
      ];

      // 3. Apply (with local de-dup for alerts raised in the last 30 s, before Firestore echoes them back).
      recentAlerts.current = recentAlerts.current.filter((r) => now - r.t < 30_000);
      const synthetic: Alert[] = recentAlerts.current.map((r) => {
        const [type, key] = r.key.split("|");
        return { id: "local", type: type as Alert["type"], severity: "info", status: "open", title: "", message: "", vehicleId: vehicle.id, parcelId: key, epc: key, source: "simulator" };
      });
      if (decisions.length) {
        const applied = await applyDecisions(decisions, {
          vehicle,
          route,
          location: loc,
          alerts: ops.openAlerts,
          recentlyRaised: synthetic,
          parcelById: ops.parcelById,
          actor: { type: "simulator", id: actor.id, name: actor.name },
          source: "simulator",
        });
        for (const d of decisions) {
          const type = ALERT_KINDS[d.kind];
          if (type) recentAlerts.current.push({ key: `${type}|${"parcel" in d ? d.parcel.id : d.epc}`, t: now });
        }
        pushLog(applied);
      }

      // 4. Publish presence when the stable set changes.
      const present = tracker.current.present();
      const sig = present.join(",");
      if (sig !== lastPublished.current) {
        lastPublished.current = sig;
        await publishPresence(vehicle, present, true);
      }

      // 5. GPS + heartbeat.
      if (loc) {
        const ls = `${loc.lat.toFixed(5)},${loc.lng.toFixed(5)}`;
        if (ls !== lastLoc.current) {
          lastLoc.current = ls;
          await publishLocation(vehicle, loc);
        }
      }
      if (now - lastHb.current > ops.settings.heartbeatSec * 1000) {
        lastHb.current = now;
        const stats = { readsPerMin: reads.length * 60, uniqueTags: present.length, cpuTempC: 48 + Math.round(Math.random() * 6), uptimeSec: Math.round(performance.now() / 1000), queueDepth: 0 };
        const ids = keepAllOnlineRef.current ? ops.devices.map((d) => d.id) : vehicle.deviceId ? [vehicle.deviceId] : [];
        await Promise.all(ids.map((id) => heartbeat(id, id === vehicle.deviceId ? stats : { ...stats, readsPerMin: 0, uniqueTags: ops.vehicleById.get(ops.deviceById.get(id)?.vehicleId ?? "")?.presentCount ?? 0 })));
      }
    } catch (e) {
      console.error(e);
      toast({ tone: "error", title: "Simulator write failed", body: e instanceof Error ? e.message : String(e) });
      setRunning(false);
    } finally {
      busy.current = false;
    }
  }, [actor.id, actor.name, toast]);

  useEffect(() => {
    if (!running) return;
    lastHb.current = 0;
    void tick();
    // A worker-driven clock keeps scanning at 1 Hz even when this tab is in the
    // background (browsers throttle main-thread timers in hidden tabs).
    const src = URL.createObjectURL(new Blob(["setInterval(() => postMessage(0), 1000);"], { type: "text/javascript" }));
    let worker: Worker | null = null;
    let fallback: ReturnType<typeof setInterval> | null = null;
    try {
      worker = new Worker(src);
      worker.onmessage = () => void tick();
    } catch {
      fallback = setInterval(() => void tick(), 1000);
    }
    return () => {
      worker?.terminate();
      if (fallback) clearInterval(fallback);
      URL.revokeObjectURL(src);
    };
  }, [running, tick]);

  // Smoothly drive to a target over a few seconds so GPS + geofence logic sees realistic movement.
  const driveTo = async (target: GeoPoint, label: string) => {
    if (!loc || driving) return;
    setDriving(true);
    const start = { ...loc };
    const steps = 6;
    const dist = distanceM(start, target);
    for (let i = 1; i <= steps; i++) {
      await new Promise((r) => setTimeout(r, 700));
      const f = i / steps;
      setLoc({ lat: start.lat + (target.lat - start.lat) * f, lng: start.lng + (target.lng - start.lng) * f, speedKmh: i === steps ? 0 : Math.min(45, Math.round((dist / steps / 0.7) * 3.6)) });
    }
    setDriving(false);
    pushLog([{ kind: "present", summary: `Arrived: ${label}`, tone: "info" }]);
  };

  if (!vehicle) {
    return <Card><EmptyState icon={Truck} title="No vehicles">Load the demo dataset in Settings first.</EmptyState></Card>;
  }

  const inCargo = new Set(cargo);
  const assignedOut = manifest.filter((p) => !inCargo.has(p.epc) && p.status !== "delivered" && p.status !== "returned");
  const foreign = parcels.filter((p) => p.vehicleId && p.vehicleId !== vehicle.id && (p.status === "loaded" || p.status === "in_transit" || p.status === "assigned") && !inCargo.has(p.epc)).slice(0, 6);
  const nextStop = manifest.find((p) => p.status !== "delivered" && p.status !== "returned" && p.status !== "exception");
  const device = vehicle.deviceId ? deviceById.get(vehicle.deviceId) : undefined;
  const health = vehicleHealth(vehicle, openAlerts, device, settings, Date.now());

  const add = (epc: string) => setCargo((c) => (c.includes(epc) ? c : [...c, epc]));
  const remove = (epc: string) => setCargo((c) => c.filter((e) => e !== epc));
  const pmap = new Map(parcels.map((p) => [p.epc, p]));

  return (
    <>
      <PageHeader
        eyebrow="Hardware-free testing"
        title="Device simulator"
        description="Runs the same verification engine as the Raspberry Pi gateway, in your browser. Move tags in and out of the cargo area, drive the van, and watch alerts appear across every dashboard."
        actions={
          <>
            <label htmlFor="sim-vehicle" className="sr-only">Vehicle</label>
            <Select id="sim-vehicle" value={vehicle.id} onChange={(e) => setVehicleId(e.target.value)} className="w-52">
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.id} · {v.plate}</option>)}
            </Select>
            <Button variant={running ? "outline" : "primary"} icon={running ? Pause : Play} onClick={() => setRunning((r) => !r)}>
              {running ? "Stop gateway" : "Start gateway"}
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="flex items-center gap-3 p-4">
          <span className={cn("inline-flex h-10 w-10 items-center justify-center rounded-xl", running ? "bg-success-soft text-success" : "bg-surface-2 text-fg-muted")}>
            <Radio className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-[13px] text-fg-muted">Gateway</p>
            <p className="font-semibold">{running ? "Scanning every 1 s" : "Stopped"}</p>
          </div>
        </Card>
        <Card className="flex items-center gap-3 p-4">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary"><Truck className="h-5 w-5" aria-hidden /></span>
          <div className="min-w-0">
            <p className="text-[13px] text-fg-muted">Route</p>
            <p className="flex flex-wrap items-center gap-2 font-semibold">
              {route ? <>{route.code} <RouteStatusBadge status={route.status} /></> : "No active route"}
            </p>
          </div>
        </Card>
        <Card className="flex items-center gap-3 p-4">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-fg-muted"><Cpu className="h-5 w-5" aria-hidden /></span>
          <div>
            <p className="text-[13px] text-fg-muted">Health</p>
            <HealthBadge health={health} />
          </div>
        </Card>
        <Card className="p-4">
          <label htmlFor="miss" className="text-[13px] text-fg-muted">Read-miss rate per round: <span className="tabular font-semibold text-fg">{missRate}%</span></label>
          <input id="miss" type="range" min={0} max={40} step={5} value={missRate} onChange={(e) => setMissRate(Number(e.target.value))} className="mt-2 w-full accent-[rgb(var(--c-primary))]" />
          <p className="text-[12px] text-fg-subtle">Debounce hides misses shorter than {settings.absenceTimeoutSec} s.</p>
        </Card>
      </div>

      {!running && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-primary/25 bg-primary-soft/60 px-4 py-3 text-[14px]">
          <Zap className="h-4 w-4 text-primary" aria-hidden />
          <span className="flex-1">Start the gateway, then try a drill. Open the <Link to="/driver" className="font-semibold text-primary underline">driver app</Link> on a phone to watch the load checklist update live.</span>
          <label className="inline-flex items-center gap-2 font-semibold">
            <input type="checkbox" checked={keepAllOnline} onChange={(e) => setKeepAllOnline(e.target.checked)} className="h-5 w-5 accent-[rgb(var(--c-primary))]" />
            Keep all simulated readers online
          </label>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            icon={ArrowDownToLine}
            title={`Cargo area · ${cargo.length} tag${cargo.length === 1 ? "" : "s"}`}
            description="Tags physically inside the van. Click a tag to take it out."
            actions={
              <>
                <Button size="sm" variant="outline" icon={ArrowDownToLine} disabled={!assignedOut.length} onClick={() => setCargo((c) => [...new Set([...c, ...assignedOut.map((p) => p.epc)])])}>
                  Load all assigned
                </Button>
                <Button size="sm" variant="outline" icon={Trash2} disabled={!cargo.length} onClick={() => setCargo([])}>Empty</Button>
              </>
            }
          />
          <div className="flex min-h-[120px] flex-wrap content-start gap-2 p-4">
            {cargo.length === 0 && <p className="w-full py-6 text-center text-[14px] text-fg-muted">Cargo area is empty.</p>}
            {cargo.map((epc) => {
              const p = pmap.get(epc);
              const foreignTag = p && p.vehicleId !== vehicle.id;
              return (
                <button
                  key={epc}
                  onClick={() => remove(epc)}
                  className={cn(
                    "group inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors",
                    !p ? "border-orange/50 bg-warning-soft" : foreignTag ? "border-orange/50 bg-warning-soft" : "border-border bg-surface-2 hover:border-danger/40 hover:bg-danger-soft",
                  )}
                  title="Take this parcel out of the cargo area"
                >
                  <Tag className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
                  <span>
                    <span className="block font-mono text-[12px] font-semibold">{p?.trackingId ?? "UNKNOWN TAG"}</span>
                    <span className="block text-[11px] text-fg-muted">{p ? (foreignTag ? `belongs to ${p.vehicleId}` : `stop ${p.stopSeq ?? "—"} · ${p.area}`) : `…${epc.slice(-8)}`}</span>
                  </span>
                  <ArrowUpFromLine className="h-4 w-4 text-fg-subtle group-hover:text-danger" aria-hidden />
                  <span className="sr-only">Take out</span>
                </button>
              );
            })}
          </div>
          <div className="border-t border-border p-4">
            <h3 className="mb-2 text-[13px] font-semibold text-fg-muted">On the hub shelf (assigned to {vehicle.id}, not in cargo)</h3>
            <div className="flex flex-wrap gap-2">
              {assignedOut.length === 0 && <span className="text-[13px] text-fg-subtle">Nothing waiting.</span>}
              {assignedOut.map((p) => (
                <button key={p.id} onClick={() => add(p.epc)} className="inline-flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-[13px] hover:border-primary hover:bg-primary-soft">
                  <ArrowDownToLine className="h-4 w-4 text-primary" aria-hidden />
                  <span className="font-mono text-[12px] font-semibold">{p.trackingId}</span>
                  <ParcelStatusBadge status={p.status} />
                </button>
              ))}
            </div>
          </div>
          <div className="border-t border-border p-4">
            <h3 className="mb-2 text-[13px] font-semibold text-fg-muted">Drills</h3>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                icon={Shuffle}
                disabled={!cargo.some((e) => pmap.get(e)?.vehicleId === vehicle.id)}
                onClick={() => {
                  const mine = cargo.filter((e) => pmap.get(e)?.vehicleId === vehicle.id);
                  const pick = mine[Math.floor(Math.random() * mine.length)]!;
                  remove(pick);
                  pushLog([{ kind: "present", summary: `Drill: took out ${pmap.get(pick)?.trackingId}`, tone: "info" }]);
                }}
              >
                Remove a random parcel
              </Button>
              {foreign.slice(0, 3).map((p) => (
                <Button key={p.id} size="sm" variant="outline" icon={Ban} onClick={() => add(p.epc)}>
                  Load {p.trackingId} (from {p.vehicleId})
                </Button>
              ))}
              <Button size="sm" variant="outline" icon={Tag} onClick={() => add(randomEpc())}>Stray unknown tag</Button>
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader
              icon={Navigation}
              title="GPS"
              description={loc ? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)} · ${loc.speedKmh ?? 0} km/h` : "No fix"}
            />
            <FleetMap
              className="h-56"
              hub={settings.hub}
              vehicles={loc ? [{ vehicle: { ...vehicle, location: { ...loc } }, health }] : []}
              stops={manifest}
              geofenceM={settings.geofenceM}
              fitKey={`sim-${vehicle.id}`}
              label="Simulated vehicle position"
            />
            <div className="grid grid-cols-1 gap-2 p-4">
              <Button
                variant="outline"
                icon={MapPin}
                disabled={!nextStop || driving}
                onClick={() => nextStop && driveTo(nextStop, `stop ${nextStop.stopSeq} (${nextStop.area})`)}
              >
                {nextStop ? `Drive to stop ${nextStop.stopSeq} · ${nextStop.area}${loc ? ` (${km(distanceM(loc, nextStop))})` : ""}` : "No undelivered stops"}
              </Button>
              <Button
                variant="outline"
                icon={Navigation}
                disabled={driving || !loc}
                onClick={() => {
                  if (!loc) return;
                  const t = nextStop ?? settings.hub;
                  // Midpoint pushed sideways ~1 km: a place that is not any customer's stop.
                  driveTo({ lat: (loc.lat + t.lat) / 2 + 0.008, lng: (loc.lng + t.lng) / 2 - 0.006 }, "roadside (no stop nearby)");
                }}
              >
                Stop at roadside (between stops)
              </Button>
              <Button variant="outline" icon={Home} disabled={driving} onClick={() => driveTo(settings.hub, "hub")}>Return to hub</Button>
            </div>
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader icon={FlaskConical} title="Gateway log" description="Decisions the engine made and wrote to Firestore" actions={<Badge tone="neutral">{log.length}</Badge>} />
        <ol className="max-h-80 divide-y divide-border overflow-y-auto px-5" aria-live="polite">
          {log.length === 0 && <li className="py-6 text-center text-[14px] text-fg-muted">No decisions yet. Start the gateway and move some tags.</li>}
          {log.map((l, i) => (
            <li key={`${l.t}-${i}`} className="flex items-center gap-3 py-2 text-[14px]">
              <time className="tabular w-16 shrink-0 text-[12px] text-fg-subtle">{clock(l.t)}</time>
              <Badge tone={l.tone === "crit" ? "danger" : l.tone === "warn" ? "warning" : l.tone === "ok" ? "success" : "primary"}>{l.kind.replace(/_/g, " ")}</Badge>
              <span className="min-w-0 flex-1">{l.summary}</span>
            </li>
          ))}
        </ol>
      </Card>

      <Card className="mt-6 p-5 text-[14px] text-fg-muted">
        <h2 className="mb-2 text-[15px] font-semibold text-fg">Suggested demo script</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Pick a vehicle with a route in <em>Loading</em>. Start the gateway and click <strong>Load all assigned</strong> — parcels flip to <em>Loaded</em> with RFID-verified events.</li>
          <li>Load a parcel from another vehicle → a <strong>Wrong vehicle</strong> alert appears within seconds. Take it out → auto-resolved.</li>
          <li>Leave one parcel on the shelf and run <strong>Verify load</strong> in the driver app → <strong>Missing parcel</strong> alert.</li>
          <li>Start the route in the driver app, <strong>Drive to stop 1</strong>, take that parcel out → <em>left at stop</em>; confirm delivery in the driver app.</li>
          <li><strong>Stop at roadside</strong> and remove a parcel → <strong>Unauthorized removal</strong> (critical) with its detection-to-alert latency.</li>
        </ol>
        {readerOnline(device, settings, Date.now()) ? null : <p className="mt-3 text-[13px]">The reader for {vehicle.id} reports offline until the gateway runs.</p>}
      </Card>
    </>
  );
}
