import { useEffect, useMemo, useRef } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap, Circle } from "react-leaflet";
import L, { type LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Hub, Parcel, Vehicle } from "@/lib/types";
import { HEALTH, type Health } from "../ui/Status";
import { TILE_ATTRIBUTION, TILE_URL } from "./tiles";

export interface MapVehicle {
  vehicle: Vehicle;
  health: Health;
  subtitle?: string;
}

const TRUCK_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>';

function vehicleIcon(v: Vehicle, health: Health, selected: boolean) {
  const color = HEALTH[health].color;
  const glyph = health === "critical" ? "!" : health === "warning" ? "!" : health === "offline" ? "?" : "";
  const ring = selected ? `box-shadow:0 0 0 4px ${color}55, 0 4px 10px rgba(0,0,0,.35);` : "box-shadow:0 3px 8px rgba(0,0,0,.35);";
  return L.divIcon({
    className: "srg-marker",
    iconSize: [44, 54],
    iconAnchor: [22, 22],
    popupAnchor: [0, -20],
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;gap:3px;">
        <div style="position:relative;width:36px;height:36px;border-radius:999px;background:${color};border:3px solid #fff;display:flex;align-items:center;justify-content:center;${ring}">
          ${TRUCK_SVG}
          ${glyph ? `<span style="position:absolute;top:-6px;right:-6px;width:16px;height:16px;border-radius:999px;background:#fff;color:${color};font:700 11px/16px system-ui;text-align:center;border:1.5px solid ${color}">${glyph}</span>` : ""}
        </div>
        <span style="font:700 10.5px/1 'Source Sans 3',system-ui;background:#0B1F3A;color:#fff;padding:2px 5px;border-radius:4px;white-space:nowrap">${v.id}</span>
      </div>`,
  });
}

function stopIcon(p: Parcel, n: number) {
  const done = p.status === "delivered";
  const bad = p.status === "exception";
  const bg = done ? "#15803D" : bad ? "#C81E1E" : "#0B1F3A";
  const label = done ? "✓" : bad ? "!" : String(n);
  return L.divIcon({
    className: "srg-marker",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -10],
    html: `<div style="width:24px;height:24px;border-radius:999px;background:${bg};color:#fff;border:2px solid #fff;font:700 11px/20px system-ui;text-align:center;box-shadow:0 2px 5px rgba(0,0,0,.3)">${label}</div>`,
  });
}

const hubIcon = L.divIcon({
  className: "srg-marker",
  iconSize: [30, 30],
  iconAnchor: [15, 15],
  html: `<div style="width:30px;height:30px;border-radius:8px;background:#2563EB;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.35);color:#fff;font:700 12px system-ui">H</div>`,
});

function FitBounds({ points, fitKey }: { points: [number, number][]; fitKey: string }) {
  const map = useMap();
  const done = useRef<string>("");
  useEffect(() => {
    if (!points.length || done.current === fitKey) return;
    // Wait for layout so Leaflet knows the container size, otherwise it fits to a 0×0 box.
    const t = setTimeout(() => {
      done.current = fitKey;
      map.invalidateSize();
      if (points.length === 1) map.setView(points[0]!, 14);
      else map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
    }, 60);
    return () => clearTimeout(t);
  }, [map, points, fitKey]);
  return null;
}

export function FleetMap({
  vehicles,
  stops = [],
  hub,
  selectedId,
  onSelect,
  className,
  geofenceM,
  fitKey = "default",
  label = "Fleet map",
}: {
  vehicles: MapVehicle[];
  stops?: Parcel[];
  hub?: Hub;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
  geofenceM?: number;
  fitKey?: string;
  label?: string;
}) {
  const points = useMemo(() => {
    const pts: [number, number][] = [];
    if (hub) pts.push([hub.lat, hub.lng]);
    vehicles.forEach((m) => m.vehicle.location && pts.push([m.vehicle.location.lat, m.vehicle.location.lng]));
    stops.forEach((p) => pts.push([p.lat, p.lng]));
    return pts;
  }, [vehicles, stops, hub]);

  const routeLine: LatLngExpression[] = useMemo(() => {
    if (!stops.length) return [];
    const line: LatLngExpression[] = hub ? [[hub.lat, hub.lng]] : [];
    [...stops].sort((a, b) => (a.stopSeq ?? 0) - (b.stopSeq ?? 0)).forEach((p) => line.push([p.lat, p.lng]));
    return line;
  }, [stops, hub]);

  const center: [number, number] = points[0] ?? [28.4595, 77.0266];

  return (
    <div className={className} role="region" aria-label={label}>
      <MapContainer center={center} zoom={12} scrollWheelZoom className="h-full w-full" style={{ borderRadius: "inherit" }}>
        <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} maxZoom={19} />
        <FitBounds points={points} fitKey={fitKey} />
        {routeLine.length > 1 && <Polyline positions={routeLine} pathOptions={{ color: "#2563EB", weight: 3, opacity: 0.6, dashArray: "6 8" }} />}
        {hub && (
          <Marker position={[hub.lat, hub.lng]} icon={hubIcon}>
            <Popup>
              <strong>{hub.name}</strong>
              <br />
              Loading hub
            </Popup>
          </Marker>
        )}
        {stops.map((p, i) => (
          <Marker key={p.id} position={[p.lat, p.lng]} icon={stopIcon(p, p.stopSeq ?? i + 1)}>
            <Popup>
              <strong>
                Stop {p.stopSeq ?? i + 1} · {p.trackingId}
              </strong>
              <br />
              {p.recipientName} — {p.area}
              <br />
              <span style={{ textTransform: "capitalize" }}>{p.status.replace("_", " ")}</span>
            </Popup>
          </Marker>
        ))}
        {geofenceM &&
          stops
            .filter((p) => p.status !== "delivered")
            .map((p) => (
              <Circle key={`g-${p.id}`} center={[p.lat, p.lng]} radius={geofenceM} pathOptions={{ color: "#2563EB", weight: 1, opacity: 0.35, fillOpacity: 0.05 }} />
            ))}
        {vehicles
          .filter((m) => m.vehicle.location)
          .map((m) => (
            <Marker
              key={m.vehicle.id}
              position={[m.vehicle.location!.lat, m.vehicle.location!.lng]}
              icon={vehicleIcon(m.vehicle, m.health, m.vehicle.id === selectedId)}
              eventHandlers={{ click: () => onSelect?.(m.vehicle.id) }}
              zIndexOffset={m.health === "critical" ? 1000 : m.health === "warning" ? 500 : 0}
              title={`${m.vehicle.id}: ${HEALTH[m.health].label}`}
              alt={`${m.vehicle.id}: ${HEALTH[m.health].label}`}
            >
              <Popup>
                <strong>
                  {m.vehicle.id} · {m.vehicle.plate}
                </strong>
                <br />
                {HEALTH[m.health].label}
                {m.subtitle ? (
                  <>
                    <br />
                    {m.subtitle}
                  </>
                ) : null}
              </Popup>
            </Marker>
          ))}
      </MapContainer>
    </div>
  );
}
