import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Eye, Route as RouteIcon } from "lucide-react";
import type { Alert, Parcel, Route } from "@/lib/types";
import { EmptyState } from "../ui/primitives";

export function usePageTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} · Driver · SmartRoute Guardian`;
    return () => {
      document.title = prev;
    };
  }, [title]);
}

/** Parcels that still need a hand-over (not delivered, not flagged, not returned). */
export function remainingStops(manifest: Parcel[]): Parcel[] {
  return manifest.filter((p) => p.status !== "delivered" && p.status !== "exception" && p.status !== "returned");
}

export function isLoadVerified(route: Route | undefined): boolean {
  return !!route && (!!route.loadVerifiedAt || !!route.loadVerification?.passed);
}

export const SEVERITY_ORDER: Record<Alert["severity"], number> = { critical: 0, warning: 1, info: 2 };

export function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort(
    (a, b) =>
      (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}

export function DriverHeading({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold leading-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[14px] text-fg-muted">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function PreviewNote({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="mb-4 flex items-start gap-2 rounded-lg border border-primary/20 bg-primary-soft px-3 py-2 text-[13px] text-primary">
      <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>
        <strong>Read-only preview.</strong> You can see exactly what the driver sees, but actions are disabled for your role.
      </span>
    </p>
  );
}

export function NoRoute() {
  return (
    <div className="card">
      <EmptyState
        icon={RouteIcon}
        title="No route assigned today"
        action={
          <Link to="/driver/messages" className="text-[14px] font-semibold text-primary hover:underline">
            Message dispatch
          </Link>
        }
      >
        When dispatch assigns a route to this vehicle, its stops and manifest will appear here automatically.
      </EmptyState>
    </div>
  );
}
