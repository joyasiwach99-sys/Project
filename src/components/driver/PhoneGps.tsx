import { useEffect, useRef, useState } from "react";
import { LocateFixed, Satellite } from "lucide-react";
import type { Vehicle } from "@/lib/types";
import { shareLocation } from "@/lib/actions";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";

const MIN_WRITE_INTERVAL_MS = 10_000;

/**
 * Lets a driver use their phone as the vehicle's GPS when no GPS module is
 * fitted. Firestore writes are throttled to one every 10 s.
 */
export function PhoneGps({ vehicle, canAct }: { vehicle: Vehicle; canAct: boolean }) {
  const [on, setOn] = useState(false);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const vehicleRef = useRef(vehicle);
  vehicleRef.current = vehicle;
  const lastWrite = useRef(0);

  useEffect(() => {
    if (!on) return;
    if (!("geolocation" in navigator)) {
      setError("This browser can’t share location.");
      setOn(false);
      return;
    }
    setError(null);
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setAccuracy(Math.round(pos.coords.accuracy));
        setError(null);
        const now = Date.now();
        if (now - lastWrite.current < MIN_WRITE_INTERVAL_MS) return;
        lastWrite.current = now;
        shareLocation(vehicleRef.current, pos)
          .then(() => setSentAt(Date.now()))
          .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn’t upload your location."));
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setError("Location permission was denied. Allow location for this site in your browser settings, then try again.");
          setOn(false);
        } else {
          setError("Couldn’t get a GPS fix yet. Move closer to open sky — we’ll keep trying.");
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [on]);

  const moduleActive = vehicle.location?.source === "gps_module";

  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <Satellite className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h2 id="gps-label" className="text-[15px] font-semibold">
              Share phone GPS
            </h2>
            <button
              role="switch"
              aria-checked={on}
              aria-labelledby="gps-label"
              disabled={!canAct}
              onClick={() => setOn((v) => !v)}
              className={cn(
                "relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
                on ? "bg-primary" : "bg-border",
              )}
            >
              <span className={cn("inline-block h-6 w-6 rounded-full bg-white shadow transition-transform", on ? "translate-x-7" : "translate-x-1")} />
              <span className="sr-only">{on ? "On" : "Off"}</span>
            </button>
          </div>
          <p className="mt-0.5 text-[13px] text-fg-muted">
            {moduleActive
              ? "The vehicle’s GPS module is reporting — only turn this on if it fails."
              : "Use your phone’s location for the fleet map and stop geofences when the vehicle has no GPS module."}
          </p>
          {on && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-success">
              <LocateFixed className="h-4 w-4" aria-hidden />
              Sharing{accuracy != null ? ` · ±${accuracy} m` : " · waiting for fix"}
              {sentAt ? ` · last sent ${ago(sentAt)}` : ""}
            </p>
          )}
          {!on && vehicle.location?.updatedAt && (
            <p className="mt-2 text-[13px] text-fg-subtle">
              Last position {ago(vehicle.location.updatedAt)} via {vehicle.location.source?.replace("_", " ") ?? "unknown source"}
            </p>
          )}
          {error && (
            <p role="alert" className="mt-2 text-[13px] font-medium text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
