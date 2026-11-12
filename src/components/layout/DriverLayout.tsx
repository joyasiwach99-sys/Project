import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Bell, ClipboardCheck, Eye, Home, LayoutDashboard, MapPinned, MessageSquare, type LucideIcon } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { activeRouteFor, useOps } from "@/context/OpsData";
import { useNow } from "@/hooks/useFirestore";
import type { Actor, Alert, Device, Parcel, Route, Vehicle } from "@/lib/types";
import { cn } from "@/lib/utils";
import { readerOnline as isReaderOnline } from "../ui/Status";
import { LogoMark } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { Avatar, Select } from "../ui/primitives";

interface DriverCtx {
  vehicle: Vehicle | undefined;
  route: Route | undefined;
  manifest: Parcel[];
  alerts: Alert[];
  device: Device | undefined;
  readerOnline: boolean;
  actor: Actor | null;
  /** May this user perform driver actions on this vehicle? */
  canAct: boolean;
  isPreview: boolean;
  driverName: string;
}

const Ctx = createContext<DriverCtx | null>(null);
export function useDriver() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDriver must be used inside DriverLayout");
  return v;
}

const TABS: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: "/driver", label: "Today", icon: Home, end: true },
  { to: "/driver/load", label: "Load", icon: ClipboardCheck },
  { to: "/driver/stops", label: "Stops", icon: MapPinned },
  { to: "/driver/alerts", label: "Alerts", icon: Bell },
  { to: "/driver/messages", label: "Messages", icon: MessageSquare },
];

const PREVIEW_KEY = "srg-preview-vehicle";

export function DriverLayout() {
  const { profile, role, actor } = useAuth();
  const { vehicles, routes, parcels, openAlerts, deviceById, userById, settings } = useOps();
  const now = useNow(5000);
  const loc = useLocation();
  const isPreview = role !== "driver";

  const [previewId, setPreviewId] = useState<string>(() => {
    try {
      return localStorage.getItem(PREVIEW_KEY) ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    try {
      if (previewId) localStorage.setItem(PREVIEW_KEY, previewId);
    } catch {
      /* ignore */
    }
  }, [previewId]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [loc.pathname]);

  const value = useMemo<DriverCtx>(() => {
    const vehicleId = isPreview ? previewId || vehicles.find((v) => v.driverId)?.id || vehicles[0]?.id : profile?.vehicleId;
    const vehicle = vehicles.find((v) => v.id === vehicleId);
    const route = activeRouteFor(vehicle, routes);
    const manifest = route
      ? route.parcelIds
          .map((id) => parcels.find((p) => p.id === id))
          .filter((p): p is Parcel => !!p)
          .sort((a, b) => (a.stopSeq ?? 0) - (b.stopSeq ?? 0))
      : [];
    const device = vehicle?.deviceId ? deviceById.get(vehicle.deviceId) : undefined;
    const online = isReaderOnline(device, settings, now) && vehicle?.readerOnline !== false;
    const driver = vehicle?.driverId ? userById.get(vehicle.driverId) : undefined;
    return {
      vehicle,
      route,
      manifest,
      alerts: openAlerts.filter((a) => a.vehicleId === vehicle?.id),
      device,
      readerOnline: online,
      actor,
      canAct: role === "admin" || (role === "driver" && profile?.vehicleId === vehicle?.id),
      isPreview,
      driverName: isPreview ? driver?.name ?? "Unassigned driver" : profile?.name ?? "",
    };
  }, [isPreview, previewId, vehicles, routes, parcels, openAlerts, deviceById, userById, settings, now, profile, role, actor]);

  const alertCount = value.alerts.filter((a) => a.status === "open").length;

  return (
    <Ctx.Provider value={value}>
      <div className="min-h-dvh bg-bg pb-[calc(76px+env(safe-area-inset-bottom))]">
        <a href="#main" className="skip-link">Skip to content</a>
        <header className="sticky top-0 z-30 border-b border-border bg-navy pt-[env(safe-area-inset-top)] text-white">
          <div className="mx-auto flex h-14 max-w-2xl items-center gap-3 px-4">
            <LogoMark className="h-7 w-7" />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[15px] font-semibold">{value.vehicle ? `${value.vehicle.id} · ${value.vehicle.plate}` : "No vehicle assigned"}</div>
              <div className="truncate text-[12px] text-slate-300">{value.driverName}</div>
            </div>
            {isPreview && (
              <Link to="/admin" className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold text-slate-200 hover:bg-white/10" aria-label="Back to admin dashboard">
                <LayoutDashboard className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">Admin</span>
              </Link>
            )}
            <ThemeToggle className="text-slate-200 hover:bg-white/10" />
            <Link to="/driver/profile" aria-label="Profile" className="rounded-full">
              <Avatar name={profile?.name ?? "?"} className="h-9 w-9 bg-white/15 text-white" />
            </Link>
          </div>
          {isPreview && (
            <div className="border-t border-white/10 bg-navy-2">
              <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-2">
                <Eye className="h-4 w-4 shrink-0 text-sky-300" aria-hidden />
                <label htmlFor="preview-vehicle" className="text-[13px] text-slate-200">
                  Previewing driver app for
                </label>
                <Select
                  id="preview-vehicle"
                  value={value.vehicle?.id ?? ""}
                  onChange={(e) => setPreviewId(e.target.value)}
                  className="h-9 w-auto flex-1 border-white/20 bg-white/10 py-0 text-[14px] text-white [&>option]:text-fg"
                >
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.id} — {userById.get(v.driverId ?? "")?.name ?? "no driver"}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}
        </header>

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-2xl px-4 py-5 outline-none">
          <Outlet />
        </main>

        <nav
          aria-label="Driver"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
        >
          <ul className="mx-auto grid max-w-2xl grid-cols-5">
            {TABS.map((t) => (
              <li key={t.to}>
                <NavLink
                  to={t.to}
                  end={t.end}
                  className={({ isActive }) =>
                    cn(
                      "relative flex h-[68px] flex-col items-center justify-center gap-1 text-[12px] font-semibold transition-colors",
                      isActive ? "text-primary" : "text-fg-muted hover:text-fg",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span className={cn("absolute top-0 h-[3px] w-10 rounded-b-full bg-primary transition-opacity", isActive ? "opacity-100" : "opacity-0")} aria-hidden />
                      <span className="relative">
                        <t.icon className="h-[22px] w-[22px]" aria-hidden />
                        {t.to === "/driver/alerts" && alertCount > 0 && (
                          <span className="tabular absolute -right-2.5 -top-1.5 rounded-full bg-danger px-1.5 text-[10px] font-bold leading-4 text-white dark:text-bg" aria-label={`${alertCount} open alerts`}>
                            {alertCount}
                          </span>
                        )}
                      </span>
                      {t.label}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </Ctx.Provider>
  );
}
