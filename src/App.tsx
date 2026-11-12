import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import { OpsDataProvider } from "@/context/OpsData";
import { ToastProvider } from "@/components/ui/Toast";
import { FullScreenLoader, RequireRole } from "@/components/layout/Guards";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { DriverLayout } from "@/components/layout/DriverLayout";

// Public
const Landing = lazy(() => import("@/pages/public/Landing"));
const Track = lazy(() => import("@/pages/public/Track"));
const Login = lazy(() => import("@/pages/public/Login"));
const Signup = lazy(() => import("@/pages/public/Signup"));
const Pending = lazy(() => import("@/pages/public/Pending"));
const NotFound = lazy(() => import("@/pages/public/NotFound"));

// Admin / operations console
const Overview = lazy(() => import("@/pages/admin/Overview"));
const FleetMapPage = lazy(() => import("@/pages/admin/FleetMapPage"));
const Vehicles = lazy(() => import("@/pages/admin/Vehicles"));
const VehicleDetail = lazy(() => import("@/pages/admin/VehicleDetail"));
const Parcels = lazy(() => import("@/pages/admin/Parcels"));
const ParcelDetail = lazy(() => import("@/pages/admin/ParcelDetail"));
const RoutesPage = lazy(() => import("@/pages/admin/Routes"));
const Alerts = lazy(() => import("@/pages/admin/Alerts"));
const Audit = lazy(() => import("@/pages/admin/Audit"));
const Analytics = lazy(() => import("@/pages/admin/Analytics"));
const Pilot = lazy(() => import("@/pages/admin/Pilot"));
const Devices = lazy(() => import("@/pages/admin/Devices"));
const People = lazy(() => import("@/pages/admin/People"));
const AdminMessages = lazy(() => import("@/pages/admin/Messages"));
const Simulator = lazy(() => import("@/pages/admin/Simulator"));
const Settings = lazy(() => import("@/pages/admin/Settings"));

// Driver app
const DriverToday = lazy(() => import("@/pages/driver/Today"));
const DriverLoad = lazy(() => import("@/pages/driver/Load"));
const DriverStops = lazy(() => import("@/pages/driver/Stops"));
const DriverAlerts = lazy(() => import("@/pages/driver/Alerts"));
const DriverMessages = lazy(() => import("@/pages/driver/Messages"));
const DriverProfile = lazy(() => import("@/pages/driver/Profile"));

function PageSuspense({ children }: { children: ReactNode }) {
  return <Suspense fallback={<FullScreenLoader />}>{children}</Suspense>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <OpsDataProvider>
            <PageSuspense>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/track" element={<Track />} />
                <Route path="/track/:trackingId" element={<Track />} />
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Signup />} />
                <Route path="/pending" element={<Pending />} />

                <Route
                  path="/admin"
                  element={
                    <RequireRole roles={["admin", "viewer"]}>
                      <AdminLayout />
                    </RequireRole>
                  }
                >
                  <Route index element={<PageSuspense><Overview /></PageSuspense>} />
                  <Route path="map" element={<PageSuspense><FleetMapPage /></PageSuspense>} />
                  <Route path="vehicles" element={<PageSuspense><Vehicles /></PageSuspense>} />
                  <Route path="vehicles/:vehicleId" element={<PageSuspense><VehicleDetail /></PageSuspense>} />
                  <Route path="parcels" element={<PageSuspense><Parcels /></PageSuspense>} />
                  <Route path="parcels/:parcelId" element={<PageSuspense><ParcelDetail /></PageSuspense>} />
                  <Route path="routes" element={<PageSuspense><RoutesPage /></PageSuspense>} />
                  <Route path="alerts" element={<PageSuspense><Alerts /></PageSuspense>} />
                  <Route path="audit" element={<PageSuspense><Audit /></PageSuspense>} />
                  <Route path="analytics" element={<PageSuspense><Analytics /></PageSuspense>} />
                  <Route path="pilot" element={<PageSuspense><Pilot /></PageSuspense>} />
                  <Route path="devices" element={<PageSuspense><Devices /></PageSuspense>} />
                  <Route path="people" element={<PageSuspense><People /></PageSuspense>} />
                  <Route path="messages" element={<PageSuspense><AdminMessages /></PageSuspense>} />
                  <Route
                    path="simulator"
                    element={
                      <RequireRole roles={["admin"]}>
                        <PageSuspense><Simulator /></PageSuspense>
                      </RequireRole>
                    }
                  />
                  <Route
                    path="settings"
                    element={
                      <RequireRole roles={["admin"]}>
                        <PageSuspense><Settings /></PageSuspense>
                      </RequireRole>
                    }
                  />
                </Route>

                <Route
                  path="/driver"
                  element={
                    <RequireRole roles={["driver", "admin", "viewer"]}>
                      <DriverLayout />
                    </RequireRole>
                  }
                >
                  <Route index element={<PageSuspense><DriverToday /></PageSuspense>} />
                  <Route path="load" element={<PageSuspense><DriverLoad /></PageSuspense>} />
                  <Route path="stops" element={<PageSuspense><DriverStops /></PageSuspense>} />
                  <Route path="alerts" element={<PageSuspense><DriverAlerts /></PageSuspense>} />
                  <Route path="messages" element={<PageSuspense><DriverMessages /></PageSuspense>} />
                  <Route path="profile" element={<PageSuspense><DriverProfile /></PageSuspense>} />
                </Route>

                <Route path="*" element={<NotFound />} />
              </Routes>
            </PageSuspense>
          </OpsDataProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
