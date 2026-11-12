import { AlertTriangle, Check, ClipboardCheck, PackageCheck, PlayCircle, ShieldCheck, Truck, type LucideIcon } from "lucide-react";
import type { Alert, Parcel, Route } from "@/lib/types";
import { cn } from "@/lib/utils";
import { isLoadVerified, remainingStops } from "./common";

export type StepKey = "start" | "verify" | "drive" | "deliver" | "resolve";
type StepState = "done" | "current" | "upcoming" | "attention";

export type NextAction =
  | { kind: "none" }
  | { kind: "load"; label: string }
  | { kind: "start" }
  | { kind: "stops"; label: string }
  | { kind: "alerts"; count: number }
  | { kind: "complete" }
  | { kind: "done" };

const STEPS: { key: StepKey; label: string; desc: string; icon: LucideIcon }[] = [
  { key: "start", label: "Start route", desc: "Open today’s manifest at the hub", icon: PlayCircle },
  { key: "verify", label: "Verify load", desc: "RFID confirms every parcel is on board", icon: ClipboardCheck },
  { key: "drive", label: "Drive route", desc: "Depart once the load check passes", icon: Truck },
  { key: "deliver", label: "Confirm delivery", desc: "Hand over and confirm at each stop", icon: PackageCheck },
  { key: "resolve", label: "Resolve alerts", desc: "Clear any exception the system raises", icon: ShieldCheck },
];

export interface Journey {
  /** Current position in the flow; "complete" = all stops handled, "done" = route closed. */
  phase: StepKey | "complete" | "done" | "none";
  states: Record<StepKey, StepState>;
  next: NextAction;
}

export function deriveJourney(route: Route | undefined, manifest: Parcel[], alerts: Alert[]): Journey {
  const openCount = alerts.filter((a) => a.status === "open").length;
  const anyUnresolved = alerts.length > 0;
  const idle: Record<StepKey, StepState> = { start: "upcoming", verify: "upcoming", drive: "upcoming", deliver: "upcoming", resolve: anyUnresolved ? "attention" : "upcoming" };
  if (!route) return { phase: "none", states: idle, next: { kind: "none" } };

  let phase: Journey["phase"];
  if (route.status === "completed" || route.status === "cancelled") phase = "done";
  else if (route.status === "planned") phase = "start";
  else if (route.status === "loading") phase = isLoadVerified(route) ? "drive" : "verify";
  else phase = remainingStops(manifest).length ? "deliver" : "complete";

  const order: StepKey[] = ["start", "verify", "drive", "deliver"];
  const idx = phase === "complete" || phase === "done" ? order.length : order.indexOf(phase as StepKey);
  const states = { ...idle };
  order.forEach((k, i) => {
    states[k] = i < idx ? "done" : i === idx ? "current" : "upcoming";
  });
  states.resolve = anyUnresolved ? "attention" : phase === "complete" || phase === "done" ? "done" : "upcoming";

  let next: NextAction;
  if (phase === "done") next = { kind: "done" };
  else if (openCount > 0) next = { kind: "alerts", count: openCount };
  else if (phase === "start") next = { kind: "load", label: "Open manifest & verify load" };
  else if (phase === "verify") next = { kind: "load", label: "Verify load" };
  else if (phase === "drive") next = { kind: "start" };
  else if (phase === "deliver") next = { kind: "stops", label: "Go to next stop" };
  else next = { kind: "complete" };

  return { phase, states, next };
}

export function JourneyStepper({ journey }: { journey: Journey }) {
  return (
    <ol className="space-y-0" aria-label="Today’s delivery journey">
      {STEPS.map((s, i) => {
        const state = journey.states[s.key];
        const last = i === STEPS.length - 1;
        const stateLabel = { done: "Done", current: "Now", upcoming: "Next", attention: "Needs attention" }[state];
        return (
          <li key={s.key} className="relative flex gap-3 pb-4 last:pb-0" aria-current={state === "current" ? "step" : undefined}>
            {!last && (
              <span
                className={cn("absolute left-[17px] top-9 h-[calc(100%-28px)] w-0.5", state === "done" ? "bg-success" : "bg-border")}
                aria-hidden
              />
            )}
            <span
              className={cn(
                "relative z-[1] inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2",
                state === "done" && "border-success bg-success text-white dark:text-bg",
                state === "current" && "border-primary bg-primary-soft text-primary",
                state === "upcoming" && "border-border bg-surface text-fg-subtle",
                state === "attention" && "border-danger bg-danger-soft text-danger",
              )}
              aria-hidden
            >
              {state === "done" ? <Check className="h-4 w-4" /> : state === "attention" ? <AlertTriangle className="h-4 w-4" /> : <s.icon className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("text-[15px] font-semibold", state === "upcoming" && "text-fg-muted")}>
                  {i + 1}. {s.label}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
                    state === "done" && "bg-success-soft text-success",
                    state === "current" && "bg-primary-soft text-primary",
                    state === "upcoming" && "bg-surface-2 text-fg-subtle",
                    state === "attention" && "bg-danger-soft text-danger",
                  )}
                >
                  {stateLabel}
                </span>
              </div>
              <p className="text-[13px] text-fg-muted">{s.desc}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
