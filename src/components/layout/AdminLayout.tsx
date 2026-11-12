import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Activity,
  BarChart3,
  Bell,
  Cpu,
  Eye,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Map,
  Menu,
  MessageSquare,
  Package,
  Route as RouteIcon,
  ScrollText,
  Settings,
  Smartphone,
  Truck,
  Users,
  X,
  ClipboardCheck,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useOps } from "@/context/OpsData";
import { cn } from "@/lib/utils";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { Avatar, Badge } from "../ui/primitives";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  adminOnly?: boolean;
  badge?: "alerts";
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Operations",
    items: [
      { to: "/admin", label: "Overview", icon: LayoutDashboard, end: true },
      { to: "/admin/map", label: "Fleet map", icon: Map },
      { to: "/admin/vehicles", label: "Vehicles", icon: Truck },
      { to: "/admin/parcels", label: "Parcels", icon: Package },
      { to: "/admin/routes", label: "Routes & dispatch", icon: RouteIcon },
    ],
  },
  {
    group: "Verification",
    items: [
      { to: "/admin/alerts", label: "Exception alerts", icon: Bell, badge: "alerts" },
      { to: "/admin/audit", label: "Audit trail", icon: ScrollText },
      { to: "/admin/devices", label: "RFID readers", icon: Cpu },
      { to: "/admin/simulator", label: "Device simulator", icon: FlaskConical, adminOnly: true },
    ],
  },
  {
    group: "Insights",
    items: [
      { to: "/admin/analytics", label: "Analytics", icon: BarChart3 },
      { to: "/admin/pilot", label: "Pilot report", icon: ClipboardCheck },
    ],
  },
  {
    group: "Team",
    items: [
      { to: "/admin/people", label: "People & roles", icon: Users },
      { to: "/admin/messages", label: "Messages", icon: MessageSquare },
      { to: "/driver", label: "Driver app", icon: Smartphone },
      { to: "/admin/settings", label: "Settings", icon: Settings, adminOnly: true },
    ],
  },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { isAdmin, profile, role, signOut } = useAuth();
  const { openAlerts } = useOps();
  const openCount = openAlerts.filter((a) => a.status === "open").length;

  return (
    <div className="flex h-full flex-col bg-navy text-navy-fg">
      <div className="flex h-16 items-center px-5">
        <Link to="/" onClick={onNavigate} aria-label="SmartRoute Guardian home">
          <Logo light />
        </Link>
      </div>
      <nav aria-label="Dashboard" className="flex-1 space-y-5 overflow-y-auto px-3 pb-4 pt-2">
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{g.group}</div>
            <ul className="space-y-0.5">
              {g.items
                .filter((i) => !i.adminOnly || isAdmin)
                .map((i) => (
                  <li key={i.to}>
                    <NavLink
                      to={i.to}
                      end={i.end}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          "group relative flex h-10 items-center gap-3 rounded-lg px-3 text-[14px] font-medium transition-colors",
                          isActive ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <span className={cn("absolute left-0 h-5 w-[3px] rounded-r bg-sky-400 transition-opacity", isActive ? "opacity-100" : "opacity-0")} aria-hidden />
                          <i.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                          <span className="flex-1 truncate">{i.label}</span>
                          {i.badge === "alerts" && openCount > 0 && (
                            <span className="tabular rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-bold text-white" aria-label={`${openCount} open alerts`}>
                              {openCount}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <Avatar name={profile?.name ?? "?"} className="bg-white/10 text-white" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold text-white">{profile?.name}</div>
            <div className="truncate text-[12px] capitalize text-slate-400">{role}</div>
          </div>
          <button
            onClick={() => signOut()}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

export function AdminLayout() {
  const [open, setOpen] = useState(false);
  const { role } = useAuth();
  const { error, settings } = useOps();
  const loc = useLocation();

  useEffect(() => {
    setOpen(false);
    document.getElementById("main")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [loc.pathname]);

  return (
    <div className="min-h-dvh bg-bg">
      <a href="#main" className="skip-link">Skip to content</a>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 lg:block">
        <Sidebar />
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-navy/60" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] animate-fade-in shadow-pop">
            <Sidebar onNavigate={() => setOpen(false)} />
            <button
              onClick={() => setOpen(false)}
              className="absolute right-2 top-3 inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10"
              aria-label="Close navigation"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur sm:px-6">
          <button
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2 lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-fg-muted">
            <Activity className="h-4 w-4 text-success" aria-hidden />
            <span className="truncate">Live · synced with Firestore</span>
          </div>
          {role === "viewer" && (
            <Badge tone="primary" icon={Eye}>
              Read-only reviewer
            </Badge>
          )}
          <ThemeToggle className="text-fg-muted hover:bg-surface-2 hover:text-fg" />
        </header>
        {settings.demoDataLoadedAt && (
          <div className="no-print flex items-center gap-2 border-b border-orange/30 bg-warning-soft px-4 py-2 text-[13px] text-warning sm:px-6">
            <FlaskConical className="h-4 w-4 shrink-0" aria-hidden />
            <span>
              <strong>Demo dataset loaded.</strong> Vehicles, parcels, alerts and metrics are simulated for demonstration — not pilot results.
            </span>
          </div>
        )}
        {error && (
          <div role="alert" className="border-b border-danger/30 bg-danger-soft px-6 py-2 text-[14px] text-danger">
            Couldn’t load live data: {error.message}
          </div>
        )}
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1440px] px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
