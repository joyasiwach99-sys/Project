import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { homeFor, useAuth } from "@/context/AuthContext";
import type { Role } from "@/lib/types";

export function FullScreenLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg" role="status">
      <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
      <span className="ml-3 text-[15px] text-fg-muted">{label}</span>
    </div>
  );
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, role, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <FullScreenLoader label="Checking your access…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (!role || !roles.includes(role)) return <Navigate to={homeFor(role)} replace />;
  return <>{children}</>;
}
