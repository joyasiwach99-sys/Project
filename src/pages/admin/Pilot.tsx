import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, orderBy, query, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import { CheckCircle2, CircleDashed, ClipboardCheck, FlaskConical, Info, Plus, Printer, Target, Timer, Trash2, TriangleAlert, Users } from "lucide-react";
import { db } from "@/lib/firebase";
import { useLiveQuery } from "@/hooks/useFirestore";
import { useOps } from "@/context/OpsData";
import { useAuth } from "@/context/AuthContext";
import type { PilotTrial, TrialScenario } from "@/lib/types";
import { latencyStats, loadDetection } from "@/lib/metrics";
import { todayKey } from "@/lib/format";
import { cn, pct } from "@/lib/utils";
import { Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Input, PageHeader, Select, Table, Td, Textarea, Th } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/Dialog";
import { useAction } from "@/components/ui/Toast";
import { BarSeries, ChartFrame, useViz } from "@/components/charts/Charts";

const SCENARIOS: Record<TrialScenario, string> = {
  static: "Static read test",
  loading: "Realistic loading",
  wrong_vehicle: "Wrong-vehicle drill",
  missing_parcel: "Missing-parcel drill",
  route: "Live route",
};

const MILESTONES = [
  { id: "outreach", week: "Week 4", title: "Pilot partner secured", detail: "Permission to test with 1 vehicle and 30–50 tagged parcels; before/after loading accuracy comparison agreed." },
  { id: "loading-demo", week: "Week 8", title: "Warehouse-to-vehicle loading demo", detail: "3 controlled tests: correct load, missing parcel, wrong-vehicle alert." },
  { id: "community", week: "Week 10", title: "School / community logistics pilot", detail: "Library books, lab kits or event supplies moved with tagged items." },
  { id: "testimonial", week: "Week 16", title: "Partner testimonial + impact report", detail: "Short testimonial, photos/video, and quantified accuracy and time saved." },
];

interface MilestoneState {
  done: boolean;
  note?: string;
}

function Scorecard({ label, value, target, met, icon: Icon, hint }: { label: string; value: string; target: string; met: boolean | null; icon: typeof Target; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-semibold text-fg-muted">{label}</p>
        <Icon className="h-4 w-4 text-fg-subtle" aria-hidden />
      </div>
      <p className="tabular mt-1 font-display text-[28px] font-semibold leading-tight">{value}</p>
      <p className="text-[13px] text-fg-muted">Target {target}</p>
      <div className="mt-2">
        {met == null ? (
          <Badge tone="neutral" icon={CircleDashed}>No data yet</Badge>
        ) : met ? (
          <Badge tone="success" icon={CheckCircle2}>Target met</Badge>
        ) : (
          <Badge tone="warning" icon={TriangleAlert}>Below target</Badge>
        )}
      </div>
      {hint && <p className="mt-2 text-[12px] text-fg-subtle">{hint}</p>}
    </div>
  );
}

export default function Pilot() {
  useEffect(() => {
    document.title = "Pilot report · SmartRoute Guardian";
  }, []);
  const { settings, routes, alerts } = useOps();
  const { isAdmin } = useAuth();
  const viz = useViz();
  const run = useAction();
  const trialsQ = useLiveQuery<PilotTrial>(query(collection(db, "pilotTrials"), orderBy("date", "asc")), "pilotTrials");
  const milestoneDoc = useLiveQuery<{ id: string } & Record<string, MilestoneState>>(query(collection(db, "settings")), "settings-all");
  const milestones = (milestoneDoc.data.find((d) => d.id === "pilotMilestones") ?? {}) as Record<string, MilestoneState>;
  const [includeSample, setIncludeSample] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const all = trialsQ.data;
  const sampleCount = all.filter((t) => t.isSample).length;
  const trials = all.filter((t) => includeSample || !t.isSample);

  const s = useMemo(() => {
    const rate = (xs: PilotTrial[]) => {
      const tagged = xs.reduce((a, t) => a + t.parcelsTagged, 0);
      const det = xs.reduce((a, t) => a + t.parcelsDetected, 0);
      return tagged ? (det / tagged) * 100 : null;
    };
    const staticRate = rate(trials.filter((t) => t.scenario === "static"));
    const loadingRate = rate(trials.filter((t) => t.scenario === "loading" || t.scenario === "route"));
    const lats = trials.map((t) => t.avgAlertLatencySec).filter((x): x is number => x != null);
    const avgLat = lats.length ? lats.reduce((a, b) => a + b, 0) / lats.length : null;
    const maxParcels = trials.reduce((m, t) => Math.max(m, t.parcelsTagged), 0);
    const expected = trials.reduce((a, t) => a + t.alertsExpected, 0);
    const raised = trials.reduce((a, t) => a + Math.min(t.alertsRaised, t.alertsExpected), 0);
    const falseAlerts = trials.reduce((a, t) => a + t.falseAlerts, 0);
    const timed = trials.filter((t) => t.manualCheckSec && t.rfidCheckSec);
    const manual = timed.reduce((a, t) => a + (t.manualCheckSec ?? 0), 0);
    const rfid = timed.reduce((a, t) => a + (t.rfidCheckSec ?? 0), 0);
    return { staticRate, loadingRate, avgLat, maxParcels, expected, raised, falseAlerts, saved: manual ? ((manual - rfid) / manual) * 100 : null, timed };
  }, [trials]);

  // Evidence the running system records by itself (independent of the trial log).
  const live = useMemo(() => {
    const det = loadDetection(routes);
    const lat = latencyStats(alerts);
    const checks = routes.map((r) => r.loadVerification).filter((v): v is NonNullable<typeof v> => !!v && v.durationSec != null);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    return {
      det,
      lat,
      manualAvg: avg(checks.filter((c) => c.method === "manual").map((c) => c.durationSec!)),
      rfidAvg: avg(checks.filter((c) => c.method !== "manual").map((c) => c.durationSec!)),
      manualN: checks.filter((c) => c.method === "manual").length,
      rfidN: checks.filter((c) => c.method !== "manual").length,
    };
  }, [routes, alerts]);

  const timeRows = s.timed.map((t) => ({ trial: t.name, manual: t.manualCheckSec ?? 0, rfid: t.rfidCheckSec ?? 0 }));
  const timeSeries = [
    { key: "manual", label: "Manual check (barcode / paper)", color: viz.series[1]! },
    { key: "rfid", label: "RFID verification", color: viz.series[0]! },
  ];

  const toggleMilestone = (id: string, done: boolean) =>
    run(() => setDoc(doc(db, "settings", "pilotMilestones"), { [id]: { ...(milestones[id] ?? {}), done } }, { merge: true }));

  return (
    <>
      <PageHeader
        eyebrow="CLAMP · Adoption pathway"
        title="Pilot validation report"
        description="Evidence that SmartRoute Guardian works in a real delivery environment: detection accuracy, alert latency, alert correctness and time saved versus manual checks."
        actions={
          <>
            <Button variant="outline" icon={Printer} onClick={() => window.print()} className="no-print">Print / PDF</Button>
            {isAdmin && <Button icon={Plus} onClick={() => setAddOpen(true)} className="no-print">Log a trial</Button>}
          </>
        }
      />

      {sampleCount > 0 && (
        <div className="mb-6 flex flex-wrap items-start gap-3 rounded-xl border border-orange/40 bg-warning-soft px-4 py-3 text-[14px]">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-warning">{sampleCount} sample trial{sampleCount === 1 ? "" : "s"} from the demo dataset</p>
            <p className="text-fg-muted">They show how the report reads. They are not measured results — exclude or delete them before sharing this report.</p>
          </div>
          <label className="no-print inline-flex items-center gap-2 text-[14px] font-semibold">
            <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--c-primary))]" checked={includeSample} onChange={(e) => setIncludeSample(e.target.checked)} />
            Include samples
          </label>
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              className="no-print"
              onClick={() =>
                run(async () => {
                  const b = writeBatch(db);
                  all.filter((t) => t.isSample).forEach((t) => b.delete(doc(db, "pilotTrials", t.id)));
                  await b.commit();
                }, "Sample trials removed")
              }
            >
              Delete samples
            </Button>
          )}
        </div>
      )}

      <section aria-label="Targets" className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Scorecard label="Static detection" icon={Target} value={s.staticRate == null ? "—" : `${s.staticRate.toFixed(1)}%`} target={`≥ ${settings.targetStaticDetection}%`} met={s.staticRate == null ? null : s.staticRate >= settings.targetStaticDetection} />
        <Scorecard label="Realistic loading detection" icon={Target} value={s.loadingRate == null ? "—" : `${s.loadingRate.toFixed(1)}%`} target={`≥ ${settings.targetLoadingDetection}%`} met={s.loadingRate == null ? null : s.loadingRate >= settings.targetLoadingDetection} />
        <Scorecard label="Alert latency" icon={Timer} value={s.avgLat == null ? "—" : `${s.avgLat.toFixed(1)} s`} target={`< ${settings.targetLatencySec} s`} met={s.avgLat == null ? null : s.avgLat < settings.targetLatencySec} />
        <Scorecard label="Parcels in one test" icon={ClipboardCheck} value={s.maxParcels ? String(s.maxParcels) : "—"} target="30–50" met={s.maxParcels ? s.maxParcels >= 30 : null} />
        <Scorecard
          label="Alerts caught"
          icon={FlaskConical}
          value={s.expected ? `${pct(s.raised, s.expected, 0)}%` : "—"}
          target="100% of drills"
          met={s.expected ? s.raised === s.expected : null}
          hint={s.expected ? `${s.raised}/${s.expected} expected · ${s.falseAlerts} false alarm${s.falseAlerts === 1 ? "" : "s"}` : undefined}
        />
        <Scorecard label="Check time saved" icon={Users} value={s.saved == null ? "—" : `${Math.round(s.saved)}%`} target="vs manual" met={s.saved == null ? null : s.saved > 0} />
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader icon={ClipboardCheck} title="Trial log" description={`${trials.length} trial${trials.length === 1 ? "" : "s"} shown${includeSample ? "" : " (samples hidden)"}`} />
          {trials.length === 0 ? (
            <EmptyState icon={FlaskConical} title="No trials logged yet" action={isAdmin && <Button icon={Plus} onClick={() => setAddOpen(true)}>Log a trial</Button>}>
              Run the protocol in docs/PILOT_PROTOCOL.md and record each test here.
            </EmptyState>
          ) : (
            <Table label="Pilot trials">
              <thead>
                <tr>
                  <Th>Trial</Th>
                  <Th>Scenario</Th>
                  <Th className="text-right">Detected</Th>
                  <Th className="text-right">Alerts</Th>
                  <Th className="text-right">Latency</Th>
                  <Th className="text-right">Manual → RFID</Th>
                  {isAdmin && <Th className="no-print"><span className="sr-only">Actions</span></Th>}
                </tr>
              </thead>
              <tbody>
                {trials.map((t) => (
                  <tr key={t.id} className={cn(t.isSample && "bg-warning-soft/30")}>
                    <Td>
                      <div className="font-semibold">{t.name}</div>
                      <div className="text-[12px] text-fg-muted">{t.date} · {t.site}{t.isSample ? " · SAMPLE" : ""}</div>
                    </Td>
                    <Td>{SCENARIOS[t.scenario]}</Td>
                    <Td className="tabular text-right">{t.parcelsDetected}/{t.parcelsTagged} <span className="text-fg-muted">({pct(t.parcelsDetected, t.parcelsTagged)}%)</span></Td>
                    <Td className="tabular text-right">{t.alertsRaised}/{t.alertsExpected}{t.falseAlerts ? <span className="text-warning"> +{t.falseAlerts} false</span> : null}</Td>
                    <Td className="tabular text-right">{t.avgAlertLatencySec != null ? `${t.avgAlertLatencySec.toFixed(1)} s` : "—"}</Td>
                    <Td className="tabular text-right">{t.manualCheckSec && t.rfidCheckSec ? `${t.manualCheckSec}s → ${t.rfidCheckSec}s` : "—"}</Td>
                    {isAdmin && (
                      <Td className="no-print text-right">
                        <IconButton label={`Delete ${t.name}`} icon={Trash2} onClick={() => run(() => deleteDoc(doc(db, "pilotTrials", t.id)), "Trial deleted")} />
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader icon={Info} title="Recorded automatically" description="What the live system has measured on its own, outside the trial log" />
          <dl className="space-y-3 p-5 text-[14px]">
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">RFID load checks</dt>
              <dd className="tabular font-semibold">{live.det.checks ? `${live.det.rate!.toFixed(1)}% · ${live.det.detected}/${live.det.expected}` : "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">Device alert latency</dt>
              <dd className="tabular font-semibold">{live.lat.count ? `${live.lat.avg!.toFixed(1)} s avg · ${live.lat.count} alerts` : "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">Manual load check (driver app)</dt>
              <dd className="tabular font-semibold">{live.manualAvg != null ? `${Math.round(live.manualAvg)} s avg · ${live.manualN}` : "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">RFID load check (driver app)</dt>
              <dd className="tabular font-semibold">{live.rfidAvg != null ? `${Math.round(live.rfidAvg)} s avg · ${live.rfidN}` : "—"}</dd>
            </div>
          </dl>
          <p className="border-t border-border px-5 py-3 text-[12px] text-fg-subtle">
            Drivers can run either check in the app; it times both so the before/after comparison comes from real use.
          </p>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <ChartFrame
          title="Load-check time: manual vs RFID"
          description="Seconds to confirm the full load, per trial"
          summary={timeRows.map((r) => `${r.trial}: manual ${r.manual} s, RFID ${r.rfid} s`).join("; ") || "No timed trials yet."}
          series={timeSeries}
          columns={[{ key: "trial", label: "Trial" }, { key: "manual", label: "Manual (s)", numeric: true }, { key: "rfid", label: "RFID (s)", numeric: true }]}
          rows={timeRows}
          empty={timeRows.length === 0}
        >
          <BarSeries data={timeRows} xKey="trial" series={timeSeries} unit="s" />
        </ChartFrame>

        <Card>
          <CardHeader icon={CheckCircle2} title="Adoption milestones" description="From the project scope — tick off as they happen" />
          <ul className="divide-y divide-border">
            {MILESTONES.map((m) => {
              const done = !!milestones[m.id]?.done;
              return (
                <li key={m.id} className="flex gap-3 px-5 py-3.5">
                  <input
                    id={`ms-${m.id}`}
                    type="checkbox"
                    className="mt-1 h-5 w-5 shrink-0 accent-[rgb(var(--c-success))]"
                    checked={done}
                    disabled={!isAdmin}
                    onChange={(e) => toggleMilestone(m.id, e.target.checked)}
                  />
                  <label htmlFor={`ms-${m.id}`} className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={cn("font-semibold", done && "text-success")}>{m.title}</span>
                      <Badge tone={done ? "success" : "neutral"}>{m.week}</Badge>
                    </span>
                    <span className="block text-[13px] text-fg-muted">{m.detail}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <TrialDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}

function TrialDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const run = useAction();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    name: "",
    date: todayKey(),
    scenario: "static" as TrialScenario,
    site: "",
    parcelsTagged: 30,
    parcelsDetected: 30,
    alertsExpected: 0,
    alertsRaised: 0,
    falseAlerts: 0,
    avgAlertLatencySec: "",
    manualCheckSec: "",
    rfidCheckSec: "",
    notes: "",
  });
  const err = f.parcelsDetected > f.parcelsTagged ? "Detected can’t exceed tagged." : !f.name.trim() ? "Give the trial a name." : null;
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const set = (k: keyof typeof f, v: string | number) => setF((x) => ({ ...x, [k]: v }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Log a pilot trial"
      description="Record what you measured. Use the gateway logs and this dashboard’s alert latencies as your source."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            loading={busy}
            disabled={!!err}
            onClick={async () => {
              setBusy(true);
              const ok = await run(
                () =>
                  addDoc(collection(db, "pilotTrials"), {
                    name: f.name.trim(),
                    date: f.date,
                    scenario: f.scenario,
                    site: f.site.trim(),
                    parcelsTagged: Number(f.parcelsTagged),
                    parcelsDetected: Number(f.parcelsDetected),
                    alertsExpected: Number(f.alertsExpected),
                    alertsRaised: Number(f.alertsRaised),
                    falseAlerts: Number(f.falseAlerts),
                    avgAlertLatencySec: num(f.avgAlertLatencySec),
                    manualCheckSec: num(f.manualCheckSec),
                    rfidCheckSec: num(f.rfidCheckSec),
                    notes: f.notes.trim(),
                    isSample: false,
                    createdAt: serverTimestamp(),
                  }),
                "Trial logged",
              );
              setBusy(false);
              if (ok) onClose();
            }}
          >
            Save trial
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Trial name" required error={f.name.trim() ? null : undefined}>
          {(p) => <Input {...p} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Static test #1 — 40 parcels" />}
        </Field>
        <Field label="Date">{(p) => <Input {...p} type="date" value={f.date} onChange={(e) => set("date", e.target.value)} />}</Field>
        <Field label="Scenario">
          {(p) => (
            <Select {...p} value={f.scenario} onChange={(e) => set("scenario", e.target.value)}>
              {(Object.keys(SCENARIOS) as TrialScenario[]).map((s) => <option key={s} value={s}>{SCENARIOS[s]}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Site / partner">{(p) => <Input {...p} value={f.site} onChange={(e) => set("site", e.target.value)} placeholder="School library store room" />}</Field>
        <Field label="Parcels tagged">{(p) => <Input {...p} type="number" min={1} value={f.parcelsTagged} onChange={(e) => set("parcelsTagged", Number(e.target.value))} />}</Field>
        <Field label="Parcels detected" error={f.parcelsDetected > f.parcelsTagged ? "Can’t exceed tagged" : null}>
          {(p) => <Input {...p} type="number" min={0} value={f.parcelsDetected} onChange={(e) => set("parcelsDetected", Number(e.target.value))} />}
        </Field>
        <Field label="Alerts expected (drills staged)">{(p) => <Input {...p} type="number" min={0} value={f.alertsExpected} onChange={(e) => set("alertsExpected", Number(e.target.value))} />}</Field>
        <Field label="Of those, alerts raised">{(p) => <Input {...p} type="number" min={0} value={f.alertsRaised} onChange={(e) => set("alertsRaised", Number(e.target.value))} />}</Field>
        <Field label="False alerts">{(p) => <Input {...p} type="number" min={0} value={f.falseAlerts} onChange={(e) => set("falseAlerts", Number(e.target.value))} />}</Field>
        <Field label="Avg alert latency (s)" help="From the Alerts page latency column">{(p) => <Input {...p} inputMode="decimal" value={f.avgAlertLatencySec} onChange={(e) => set("avgAlertLatencySec", e.target.value)} />}</Field>
        <Field label="Manual check time (s)" help="Stopwatch, barcode/paper method">{(p) => <Input {...p} inputMode="decimal" value={f.manualCheckSec} onChange={(e) => set("manualCheckSec", e.target.value)} />}</Field>
        <Field label="RFID check time (s)">{(p) => <Input {...p} inputMode="decimal" value={f.rfidCheckSec} onChange={(e) => set("rfidCheckSec", e.target.value)} />}</Field>
        <Field label="Notes" className="sm:col-span-2">{(p) => <Textarea {...p} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Tag placement, antenna angle, anything unusual" />}</Field>
      </div>
      {err && <p role="alert" className="mt-3 text-[13px] text-danger">{err}</p>}
    </Dialog>
  );
}
