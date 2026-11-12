import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import {
  AlertOctagon,
  CheckCircle2,
  Loader2,
  MapPin,
  PackageSearch,
  RadioTower,
  RotateCcw,
  Search,
  Tag,
  Truck,
  PackageCheck,
  PackagePlus,
  type LucideIcon,
} from "lucide-react";
import { db } from "@/lib/firebase";
import type { PublicTimelineEntry, PublicTracking } from "@/lib/types";
import { dateTime, toMillis } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, EmptyState, Input } from "@/components/ui/primitives";
import { PublicHeader, useTitle } from "@/components/public/shared";

const ID_PATTERN = /^SRG-[A-Z0-9]{6}$/;

function normalizeId(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (/^[A-Z0-9]{6}$/.test(s)) return `SRG-${s}`;
  if (/^SRG[A-Z0-9]{6}$/.test(s)) return `SRG-${s.slice(3)}`;
  return s;
}

const STEPS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: "registered", label: "Registered", icon: Tag },
  { key: "assigned", label: "Assigned", icon: PackagePlus },
  { key: "loaded", label: "Loaded", icon: PackageCheck },
  { key: "in_transit", label: "Out for delivery", icon: Truck },
  { key: "delivered", label: "Delivered", icon: CheckCircle2 },
];

const STATUS_COPY: Record<PublicTracking["status"], { title: string; body: string; tone: "primary" | "success" | "danger" | "neutral" | "navy" }> = {
  registered: { title: "Registered at the hub", body: "Your parcel has been tagged and is waiting to be assigned to a delivery route.", tone: "neutral" },
  assigned: { title: "Preparing for dispatch", body: "Your parcel is assigned to a delivery route and will be loaded soon.", tone: "primary" },
  loaded: { title: "Loaded into the delivery vehicle", body: "The vehicle’s RFID reader has confirmed your parcel is on board.", tone: "primary" },
  in_transit: { title: "Out for delivery", body: "Your parcel is on its way. The vehicle continuously verifies it is still on board.", tone: "navy" },
  delivered: { title: "Delivered", body: "Your parcel has been handed over.", tone: "success" },
  exception: { title: "Delivery exception", body: "Something needs attention. Our operations team has been alerted and is checking your parcel.", tone: "danger" },
  returned: { title: "Returned to hub", body: "Your parcel is back at the hub. The sender will be in touch about next steps.", tone: "neutral" },
};

function stepIndex(status: PublicTracking["status"]): number {
  switch (status) {
    case "registered":
      return 0;
    case "assigned":
      return 1;
    case "loaded":
      return 2;
    case "in_transit":
    case "exception":
      return 3;
    case "delivered":
      return 4;
    default:
      return 0;
  }
}

function timelineIcon(e: PublicTimelineEntry): LucideIcon {
  switch (e.status) {
    case "delivered":
      return CheckCircle2;
    case "exception":
      return AlertOctagon;
    case "returned":
      return RotateCcw;
    case "out_for_delivery":
    case "in_transit":
      return Truck;
    case "loaded":
      return PackageCheck;
    case "assigned":
      return PackagePlus;
    default:
      return Tag;
  }
}

type LoadState = { status: "idle" } | { status: "loading" } | { status: "missing" } | { status: "error"; message: string } | { status: "found"; data: PublicTracking };

export default function Track() {
  const { trackingId: param } = useParams();
  const navigate = useNavigate();
  const current = param ? normalizeId(decodeURIComponent(param)) : "";
  const [input, setInput] = useState(current);
  const [formError, setFormError] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>({ status: current ? "loading" : "idle" });
  useTitle(current ? `Tracking ${current}` : "Track a parcel");

  useEffect(() => setInput(current), [current]);

  useEffect(() => {
    if (!current) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading" });
    return onSnapshot(
      doc(db, "publicTracking", current),
      (snap) => setState(snap.exists() ? { status: "found", data: snap.data() as PublicTracking } : { status: "missing" }),
      (err) => {
        console.error("[track]", err);
        setState(/permission/i.test(err.message) ? { status: "missing" } : { status: "error", message: err.message });
      },
    );
  }, [current]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = normalizeId(input);
    if (!id) {
      setFormError("Enter the tracking ID from your delivery message.");
      return;
    }
    if (!ID_PATTERN.test(id)) {
      setFormError("Tracking IDs look like SRG-4K7Q2M (SRG, a dash, then 6 letters or numbers).");
      return;
    }
    setFormError(null);
    navigate(`/track/${encodeURIComponent(id)}`);
  };

  return (
    <div className="min-h-dvh bg-bg">
      <PublicHeader
        right={
          <Link to="/login" className="hidden h-10 items-center rounded-lg px-3 text-[14px] font-medium text-fg-muted hover:bg-surface-2 hover:text-fg sm:inline-flex">
            Sign in
          </Link>
        }
      />
      <main id="main" className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-14">
        <div className="text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <PackageSearch className="h-6 w-6" aria-hidden />
          </span>
          <h1 className="mt-4 text-[28px] font-semibold sm:text-[32px]">Track your parcel</h1>
          <p className="mt-2 text-[15px] text-fg-muted">Every hand-off is verified by the RFID reader inside the delivery vehicle.</p>
        </div>

        <form onSubmit={submit} className="mt-8" noValidate role="search" aria-label="Track a parcel">
          <label htmlFor="tracking-id" className="label block">
            Tracking ID
          </label>
          <div className="mt-1.5 flex gap-2">
            <Input
              id="tracking-id"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="SRG-4K7Q2M"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={formError ? true : undefined}
              aria-describedby={formError ? "tracking-err" : "tracking-help"}
              className="font-mono uppercase tracking-wide"
            />
            <Button type="submit" icon={Search}>
              Track
            </Button>
          </div>
          {formError ? (
            <p id="tracking-err" role="alert" className="mt-1.5 text-[13px] font-medium text-danger">
              {formError}
            </p>
          ) : (
            <p id="tracking-help" className="help mt-1.5">
              You’ll find it in the delivery message from the sender. Exploring the demo? Try{" "}
              <button type="button" onClick={() => setInput("SRG-DEMO42")} className="font-mono font-semibold text-primary underline-offset-2 hover:underline">
                SRG-DEMO42
              </button>{" "}
              or{" "}
              <button type="button" onClick={() => setInput("SRG-DEMO07")} className="font-mono font-semibold text-primary underline-offset-2 hover:underline">
                SRG-DEMO07
              </button>
              .
            </p>
          )}
        </form>

        <div className="mt-8" aria-live="polite">
          {state.status === "loading" && (
            <Card className="flex items-center justify-center gap-3 p-10 text-fg-muted" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
              Looking up {current}…
            </Card>
          )}
          {state.status === "missing" && (
            <Card>
              <EmptyState icon={PackageSearch} title={`We couldn’t find ${current}`}>
                Check the ID for typos. New parcels can take a few minutes to appear after they are registered at the hub.
              </EmptyState>
            </Card>
          )}
          {state.status === "error" && (
            <Card className="p-6 text-center" role="alert">
              <p className="font-semibold">Tracking is temporarily unavailable.</p>
              <p className="mt-1 text-[14px] text-fg-muted">Please try again in a moment.</p>
            </Card>
          )}
          {state.status === "found" && <TrackingResult data={state.data} />}
        </div>

        <p className="mt-10 text-center text-[14px] text-fg-muted">
          <Link to="/" className="font-semibold text-primary hover:underline">
            What is SmartRoute Guardian?
          </Link>
        </p>
      </main>
    </div>
  );
}

function TrackingResult({ data }: { data: PublicTracking }) {
  const copy = STATUS_COPY[data.status] ?? STATUS_COPY.registered;
  const idx = stepIndex(data.status);
  const isException = data.status === "exception";
  const timeline = [...(data.timeline ?? [])].sort((a, b) => (toMillis(b.at) ?? 0) - (toMillis(a.at) ?? 0));

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="border-b border-border p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[13px] font-semibold text-fg-muted">{data.trackingId}</p>
              <h2 className="mt-1 text-[22px] font-semibold">{copy.title}</h2>
            </div>
            <Badge tone={copy.tone} icon={isException ? AlertOctagon : data.status === "delivered" ? CheckCircle2 : undefined}>
              {STEPS.find((s) => s.key === data.status)?.label ?? copy.title}
            </Badge>
          </div>
          <p className="mt-2 text-[15px] text-fg-muted">{copy.body}</p>
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[14px]">
            <div className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-fg-subtle" aria-hidden />
              <dt className="sr-only">Delivery area</dt>
              <dd>{[data.area, data.city].filter(Boolean).join(", ") || "—"}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="text-fg-muted">Recipient</dt>
              <dd className="font-semibold">{data.recipientInitials || "—"}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="text-fg-muted">Updated</dt>
              <dd>{dateTime(data.updatedAt)}</dd>
            </div>
          </dl>
        </div>

        {/* Progress stepper */}
        <ol className="grid grid-cols-5 gap-1 px-3 py-5 sm:px-5" aria-label="Delivery progress">
          {STEPS.map((s, i) => {
            const done = i < idx || (i === idx && data.status === "delivered");
            const currentStep = i === idx && data.status !== "delivered";
            const bad = currentStep && isException;
            return (
              <li key={s.key} className="flex flex-col items-center text-center" aria-current={currentStep ? "step" : undefined}>
                <div className="relative flex w-full items-center justify-center">
                  {i > 0 && <span className={cn("absolute right-1/2 top-1/2 h-0.5 w-full -translate-y-1/2", i <= idx ? "bg-primary" : "bg-border")} aria-hidden />}
                  <span
                    className={cn(
                      "relative z-[1] inline-flex h-9 w-9 items-center justify-center rounded-full border-2",
                      bad
                        ? "border-danger bg-danger-soft text-danger"
                        : done
                          ? "border-primary bg-primary text-primary-fg"
                          : currentStep
                            ? "border-primary bg-surface text-primary"
                            : "border-border bg-surface text-fg-subtle",
                    )}
                  >
                    {bad ? <AlertOctagon className="h-4 w-4" aria-hidden /> : <s.icon className="h-4 w-4" aria-hidden />}
                  </span>
                </div>
                <span className={cn("mt-2 text-[11.5px] font-semibold leading-tight sm:text-[12.5px]", i <= idx ? "text-fg" : "text-fg-subtle")}>
                  {s.label}
                  <span className="sr-only">{done ? " (complete)" : currentStep ? (bad ? " (exception)" : " (current)") : " (upcoming)"}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </Card>

      <Card>
        <h2 className="border-b border-border px-5 py-4 text-[15px] font-semibold">Parcel history</h2>
        {timeline.length === 0 ? (
          <p className="px-5 py-6 text-[14px] text-fg-muted">No updates yet.</p>
        ) : (
          <ol className="px-5 py-4">
            {timeline.map((e, i) => {
              const Icon = timelineIcon(e);
              const latest = i === 0;
              return (
                <li key={`${toMillis(e.at)}-${i}`} className="relative flex gap-4 pb-5 last:pb-0">
                  {i < timeline.length - 1 && <span className="absolute left-[17px] top-9 bottom-0 w-px bg-border" aria-hidden />}
                  <span
                    className={cn(
                      "relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                      e.status === "exception"
                        ? "bg-danger-soft text-danger"
                        : e.status === "delivered"
                          ? "bg-success-soft text-success"
                          : latest
                            ? "bg-primary-soft text-primary"
                            : "bg-surface-2 text-fg-muted",
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 pt-1">
                    <p className={cn("text-[15px]", latest ? "font-semibold" : "font-medium")}>{e.label}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-fg-muted">
                      <time dateTime={toMillis(e.at) ? new Date(toMillis(e.at)!).toISOString() : undefined}>{dateTime(e.at)}</time>
                      {e.rfidVerified && (
                        <Badge tone="success" icon={RadioTower}>
                          RFID verified
                        </Badge>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      <p className="text-center text-[13px] text-fg-muted">
        For privacy, only the delivery area and recipient initials are shown.{" "}
        <Link to="/track" className="font-semibold text-primary hover:underline">
          Track another parcel
        </Link>
      </p>
    </div>
  );
}
