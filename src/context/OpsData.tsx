import { createContext, useContext, useMemo, type ReactNode } from "react";
import { collection, limit, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useLiveDoc, useLiveQuery } from "@/hooks/useFirestore";
import type { Alert, Device, Parcel, Route, SystemSettings, UserProfile, Vehicle } from "@/lib/types";
import { useAuth } from "./AuthContext";

export const DEFAULT_SETTINGS: SystemSettings = {
  absenceTimeoutSec: 6,
  geofenceM: 150,
  heartbeatSec: 15,
  offlineAfterSec: 45,
  targetStaticDetection: 95,
  targetLoadingDetection: 90,
  targetLatencySec: 10,
  targetParcels: 40,
  hub: { name: "SmartRoute Hub · Udyog Vihar, Gurugram", lat: 28.5011, lng: 77.0838 },
  orgName: "SmartRoute Guardian Pilot",
};

interface OpsData {
  loading: boolean;
  error: Error | null;
  vehicles: Vehicle[];
  parcels: Parcel[];
  routes: Route[];
  alerts: Alert[];
  devices: Device[];
  users: UserProfile[];
  settings: SystemSettings;
  vehicleById: Map<string, Vehicle>;
  parcelById: Map<string, Parcel>;
  parcelByEpc: Map<string, Parcel>;
  routeById: Map<string, Route>;
  userById: Map<string, UserProfile>;
  deviceById: Map<string, Device>;
  openAlerts: Alert[];
}

const Ctx = createContext<OpsData | null>(null);

/**
 * One set of real-time listeners for the core operational collections,
 * shared by every dashboard screen. Events are queried per page (they grow fast).
 */
export function OpsDataProvider({ children }: { children: ReactNode }) {
  const { isStaff } = useAuth();
  const on = isStaff;
  const vehicles = useLiveQuery<Vehicle>(on ? query(collection(db, "vehicles")) : null, `vehicles:${on}`);
  const parcels = useLiveQuery<Parcel>(on ? query(collection(db, "parcels")) : null, `parcels:${on}`);
  const routes = useLiveQuery<Route>(on ? query(collection(db, "routes"), orderBy("date", "desc"), limit(300)) : null, `routes:${on}`);
  const alerts = useLiveQuery<Alert>(on ? query(collection(db, "alerts"), orderBy("createdAt", "desc"), limit(500)) : null, `alerts:${on}`);
  const devices = useLiveQuery<Device>(on ? query(collection(db, "devices")) : null, `devices:${on}`);
  const users = useLiveQuery<UserProfile>(on ? query(collection(db, "users")) : null, `users:${on}`);
  const settings = useLiveDoc<SystemSettings & { id: string }>(on ? "settings/system" : null);

  const value = useMemo<OpsData>(() => {
    const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
    const sortedVehicles = [...vehicles.data].sort((a, b) => a.id.localeCompare(b.id));
    return {
      loading: vehicles.loading || parcels.loading || routes.loading || alerts.loading,
      error: vehicles.error || parcels.error || routes.error || alerts.error || devices.error || users.error,
      vehicles: sortedVehicles,
      parcels: parcels.data,
      routes: routes.data,
      alerts: alerts.data,
      devices: [...devices.data].sort((a, b) => a.id.localeCompare(b.id)),
      users: users.data,
      settings: { ...DEFAULT_SETTINGS, ...(settings.data ?? {}) },
      vehicleById: byId(sortedVehicles),
      parcelById: byId(parcels.data),
      parcelByEpc: new Map(parcels.data.map((p) => [p.epc, p])),
      routeById: byId(routes.data),
      userById: byId(users.data),
      deviceById: byId(devices.data),
      openAlerts: alerts.data.filter((a) => a.status !== "resolved"),
    };
  }, [vehicles, parcels, routes, alerts, devices, users, settings]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOps(): OpsData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOps must be used inside <OpsDataProvider>");
  return v;
}

/** The route a vehicle is working on right now (explicit activeRouteId, else today's open route). */
export function activeRouteFor(vehicle: Vehicle | undefined, routes: Route[]): Route | undefined {
  if (!vehicle) return undefined;
  if (vehicle.activeRouteId) {
    const r = routes.find((x) => x.id === vehicle.activeRouteId);
    if (r) return r;
  }
  return routes
    .filter((r) => r.vehicleId === vehicle.id && r.status !== "completed" && r.status !== "cancelled")
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}
