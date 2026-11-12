import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertOctagon,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  Hand,
  Play,
  Radio,
  ScanLine,
  Square,
  SquareCheckBig,
  Timer,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { useDriver } from "@/components/layout/DriverLayout";
import { useOps } from "@/context/OpsData";
import { useNow } from "@/hooks/useFirestore";
import { Badge, Button, Card, CardHeader, Progress } from "@/components/ui/primitives";
import { ReaderBadge } from "@/components/ui/Status";
import { useAction } from "@/components/ui/Toast";
import { startRoute, verifyLoad } from "@/lib/actions";
import { checkLoad, normalizeEpc, type LoadCheckResult } from "@/lib/verification";
import type { Parcel } from "@/lib/types";
import { ago, dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DriverHeading, NoRoute, PreviewNote, isLoadVerified, usePageTitle } from "@/components/driver/common";

type Mode = "rfid" | "manual";

export default function Load() {
  usePageTitle("Verify load");
  const { vehicle, route, manifest, alerts, readerOnline, actor, canAct } = useDriver();
  const { parcelByEpc } = useOps();
  const navigate = useNavigate();
  const run = useAction();
  const now = useNow(1000);
  const openedAt = useRef(Date.now());

  // Follow the reader's live status until the driver explicitly picks a mode
  // (the heartbeat often arrives after first render).
  const [chosenMode, setChosenMode] = useState<Mode | null>(null);
  const mode: Mode = chosenMode ?? (readerOnline ? "rfid" : "manual");
  const [manualStart, setManualStart] = useState<number | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<LoadCheckResult<Parcel> | null>(null);
  const [busy, setBusy] = useState<"verify" | "start" | null>(null);

  const present = useMemo(() => new Set((vehicle?.presentEpcs ?? []).map(normalizeEpc)), [vehicle?.presentEpcs]);
  const expected = useMemo(() => manifest.filter((p) => p.status !== "delivered" && p.status !== "returned"), [manifest]);
  const live = useMemo(() => checkLoad(manifest, vehicle?.presentEpcs ?? []), [manifest, vehicle?.presentEpcs]);

  if (!vehicle || !route) {
    return (
      <>
        <DriverHeading title="Verify load" subtitle="Compare the manifest with what the RFID reader sees." />
        <NoRoute />
      </>
    );
  }

  const underway = route.status === "in_progress" || route.status === "completed" || route.status === "cancelled";
  const verified = isLoadVerified(route);
  const last = route.loadVerification as (typeof route.loadVerification & { method?: string; durationSec?: number | null }) | null | undefined;
  const manualElapsed = manualStart ? Math.max(0, Math.round((now - manualStart) / 1000)) : 0;
  const shownResult = result ?? null;

  const isDetected = (p: Parcel) => (mode === "manual" ? ticked.has(p.id) : present.has(normalizeEpc(p.epc)));
  const detectedCount = mode === "manual" ? expected.filter((p) => ticked.has(p.id)).length : live.detected;
  const rate = expected.length ? Math.round((detectedCount / expected.length) * 1000) / 10 : 100;

  const toggleTick = (id: string) => {
    if (!manualStart) setManualStart(Date.now());
    setTicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (!actor) return;
    setBusy("verify");
    let res: LoadCheckResult<Parcel> | null = null;
    const ok = await run(async () => {
      res = await verifyLoad({
        route,
        vehicle,
        manifest,
        alerts,
        actor,
        method: mode,
        manualPresentIds: mode === "manual" ? [...ticked] : undefined,
        durationSec: mode === "manual" ? (manualStart ? Math.round((Date.now() - manualStart) / 1000) : 0) : Math.round((Date.now() - openedAt.current) / 1000),
      });
    });
    setBusy(null);
    if (ok && res) setResult(res);
  };

  const start = async () => {
    if (!actor) return;
    setBusy("start");
    const ok = await run(() => startRoute(route, vehicle, manifest, actor), "Route started", "Drive safely — RFID is watching the cargo.");
    setBusy(null);
    if (ok) navigate("/driver/stops");
  };

  return (
    <div className="space-y-4">
      <DriverHeading title="Verify load" subtitle={`${route.code} · ${vehicle.id}`} actions={<ReaderBadge online={readerOnline} />} />
      <PreviewNote show={!canAct} />

      {underway && (
        <div className="flex items-start gap-2 rounded-xl border border-border bg-surface-2 p-3.5 text-[14px] text-fg-muted">
          <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
          <span>
            This route is already {route.status === "in_progress" ? "underway" : route.status}. The checklist below is a live view of what’s on board.
          </span>
        </div>
      )}

      {/* Mode switch */}
      {!underway && (
        <div role="radiogroup" aria-label="Check method" className="grid grid-cols-2 gap-2 rounded-xl bg-surface-2 p-1">
          {(
            [
              { v: "rfid", label: "RFID scan", icon: ScanLine },
              { v: "manual", label: "Manual check", icon: Hand },
            ] as const
          ).map((o) => (
            <button
              key={o.v}
              role="radio"
              aria-checked={mode === o.v}
              onClick={() => {
                setChosenMode(o.v);
                setResult(null);
              }}
              className={cn(
                "inline-flex h-11 items-center justify-center gap-2 rounded-lg text-[14px] font-semibold transition-colors",
                mode === o.v ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
              )}
            >
              <o.icon className="h-4 w-4" aria-hidden />
              {o.label}
            </button>
          ))}
        </div>
      )}

      {mode === "rfid" && !readerOnline && !underway && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-soft p-3.5 text-[14px] text-warning">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <span>
            The RFID reader in {vehicle.id} isn’t reporting (last scan {ago(vehicle.lastScanAt, "never")}). Switch to <strong>Manual check</strong> to verify the
            load by hand — the time it takes is recorded for the pilot comparison.
          </span>
        </div>
      )}

      {/* Live stats */}
      <Card className="p-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="tabular font-display text-[24px] font-semibold">
              {detectedCount}
              <span className="text-[15px] font-medium text-fg-muted">/{expected.length}</span>
            </p>
            <p className="text-[12px] text-fg-muted">{mode === "manual" ? "Ticked" : "Detected"}</p>
          </div>
          <div>
            <p className={cn("tabular font-display text-[24px] font-semibold", rate === 100 ? "text-success" : "text-fg")}>{rate}%</p>
            <p className="text-[12px] text-fg-muted">Rate</p>
          </div>
          <div>
            <p className={cn("tabular font-display text-[24px] font-semibold", mode === "rfid" && live.extraEpcs.length ? "text-warning" : "text-fg")}>
              {mode === "rfid" ? live.extraEpcs.length : "—"}
            </p>
            <p className="text-[12px] text-fg-muted">Unexpected</p>
          </div>
        </div>
        <div className="mt-3">
          <Progress value={rate} tone={rate === 100 ? "success" : "primary"} label="Load check progress" />
        </div>
        <p className="mt-2 flex items-center justify-center gap-1.5 text-[12px] text-fg-subtle">
          {mode === "manual" ? (
            <>
              <Timer className="h-3.5 w-3.5" aria-hidden />
              Manual check time: <span className="tabular font-semibold text-fg-muted">{manualElapsed}s</span>
              {!manualStart && " (starts on first tick)"}
            </>
          ) : (
            <>
              <Radio className="h-3.5 w-3.5" aria-hidden />
              Updates live as the reader scans · last scan {ago(vehicle.lastScanAt, "never")}
            </>
          )}
        </p>
      </Card>

      {/* Unexpected tags */}
      {mode === "rfid" && live.extraEpcs.length > 0 && (
        <Card className="border-warning/40">
          <CardHeader icon={TriangleAlert} title="Unexpected tags in the cargo" description="These tags are not on this route’s manifest. Remove them before departing." />
          <ul className="divide-y divide-border">
            {live.extraEpcs.map((epc) => {
              const p = parcelByEpc.get(epc);
              return (
                <li key={epc} className="flex flex-wrap items-center gap-2 px-5 py-3">
                  <span className="epc text-fg-muted">…{epc.slice(-8)}</span>
                  {p ? (
                    <>
                      <span className="font-mono text-[13px] font-semibold">{p.trackingId}</span>
                      <Badge tone="warning" icon={TriangleAlert}>
                        Belongs to {p.vehicleId ?? "no vehicle"}
                      </Badge>
                    </>
                  ) : (
                    <Badge tone="neutral">Unregistered tag</Badge>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* Checklist */}
      <Card>
        <CardHeader title="Manifest" description={mode === "manual" ? "Tap each parcel you can physically see in the cargo area." : "Detected parcels tick automatically."} />
        <ul className="divide-y divide-border">
          {expected.map((p) => {
            const ok = isDetected(p);
            const inner = (
              <>
                <span className="tabular inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[13px] font-bold text-fg-muted">{p.stopSeq ?? "–"}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-[13px] font-semibold">{p.trackingId}</span>
                    <span className="epc text-fg-subtle">…{p.epc.slice(-8)}</span>
                  </span>
                  <span className="block truncate text-[14px] text-fg-muted">
                    {p.recipientName} · {p.area}
                  </span>
                </span>
                {mode === "manual" ? (
                  <span className={cn("inline-flex items-center gap-1.5 text-[13px] font-semibold", ok ? "text-success" : "text-fg-subtle")}>
                    {ok ? <SquareCheckBig className="h-6 w-6" aria-hidden /> : <Square className="h-6 w-6" aria-hidden />}
                    <span className="sr-only sm:not-sr-only">{ok ? "Ticked" : "Not ticked"}</span>
                  </span>
                ) : (
                  <span className={cn("inline-flex items-center gap-1.5 text-[13px] font-semibold", ok ? "text-success" : "text-fg-subtle")}>
                    {ok ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <CircleDashed className="h-5 w-5" aria-hidden />}
                    {ok ? "Detected" : "Not detected"}
                  </span>
                )}
              </>
            );
            return (
              <li key={p.id}>
                {mode === "manual" && !underway ? (
                  <button
                    role="checkbox"
                    aria-checked={ok}
                    disabled={!canAct}
                    onClick={() => toggleTick(p.id)}
                    className="flex min-h-[60px] w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-2 disabled:cursor-not-allowed"
                  >
                    {inner}
                  </button>
                ) : (
                  <div className="flex min-h-[60px] items-center gap-3 px-5 py-3">{inner}</div>
                )}
              </li>
            );
          })}
          {expected.length === 0 && <li className="px-5 py-6 text-center text-[14px] text-fg-muted">Nothing left to load on this route.</li>}
        </ul>
      </Card>

      {/* Result of this session's check */}
      {shownResult && (
        <div
          role="status"
          className={cn("rounded-xl border p-4", shownResult.passed ? "border-success/30 bg-success-soft" : "border-danger/30 bg-danger-soft")}
        >
          <div className={cn("flex items-center gap-2 text-[16px] font-semibold", shownResult.passed ? "text-success" : "text-danger")}>
            {shownResult.passed ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <XCircle className="h-5 w-5" aria-hidden />}
            {shownResult.passed ? "Load verified" : "Load check failed"} · {shownResult.detected}/{shownResult.expected} ({shownResult.rate}%)
          </div>
          {!shownResult.passed && (
            <div className="mt-2 space-y-2 text-[14px] text-fg">
              {shownResult.missing.length > 0 && (
                <div>
                  <p className="font-semibold">Missing parcels — a critical alert was raised for each:</p>
                  <ul className="mt-1 list-inside list-disc text-fg-muted">
                    {shownResult.missing.map((p) => (
                      <li key={p.id}>
                        <span className="font-mono text-[13px]">{p.trackingId}</span> · {p.recipientName}, {p.area}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {shownResult.extraEpcs.length > 0 && <p>{shownResult.extraEpcs.length} unexpected tag(s) are in the cargo — remove them and check again.</p>}
              <Link to="/driver/alerts" className="inline-flex items-center gap-1 font-semibold text-danger hover:underline">
                <AlertOctagon className="h-4 w-4" aria-hidden />
                View alerts
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Last saved verification */}
      {!shownResult && last && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            {last.passed ? <Badge tone="success" icon={CheckCircle2}>Last check passed</Badge> : <Badge tone="danger" icon={XCircle}>Last check failed</Badge>}
            <span className="text-[13px] text-fg-muted">
              {dateTime(last.at)} · by {last.by?.name ?? "—"} · {last.method === "manual" ? "manual check" : "RFID"}
              {last.durationSec != null ? ` · ${last.durationSec}s` : ""}
            </span>
          </div>
          <p className="mt-1 text-[14px] text-fg-muted">
            {last.detected}/{last.expected} parcels ({last.expected ? Math.round((last.detected / last.expected) * 1000) / 10 : 100}%)
            {last.missing?.length ? ` · ${last.missing.length} missing` : ""}
            {last.extra?.length ? ` · ${last.extra.length} unexpected` : ""}
          </p>
        </Card>
      )}

      {/* Primary action */}
      {!underway && (
        <div className="space-y-2">
          {verified && (shownResult?.passed ?? true) && (!shownResult || shownResult.passed) && route.status !== "planned" ? (
            <>
              <Button size="lg" icon={Play} className="h-12 w-full" loading={busy === "start"} disabled={!canAct} onClick={() => void start()}>
                Start route
              </Button>
              <Button variant="ghost" className="w-full" disabled={!canAct || busy !== null} onClick={() => void submit()}>
                Re-verify load
              </Button>
            </>
          ) : (
            <Button
              size="lg"
              icon={mode === "manual" ? Hand : ScanLine}
              className="h-12 w-full"
              loading={busy === "verify"}
              disabled={!canAct || expected.length === 0}
              onClick={() => void submit()}
            >
              {mode === "manual" ? `Submit manual check (${detectedCount}/${expected.length})` : last ? "Verify load again" : "Verify load"}
            </Button>
          )}
          {!canAct && <p className="text-center text-[13px] text-fg-muted">Read-only preview — actions are disabled.</p>}
        </div>
      )}
    </div>
  );
}
