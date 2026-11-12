import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { GeoPoint } from "@/lib/types";
import { TILE_ATTRIBUTION, TILE_URL } from "./tiles";

const pin = L.divIcon({
  className: "srg-marker",
  iconSize: [26, 26],
  iconAnchor: [13, 13],
  html: '<div style="width:26px;height:26px;border-radius:999px;background:#EA580C;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>',
});

function ClickHandler({ onPick }: { onPick: (p: GeoPoint) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) }) });
  return null;
}

/** Click the map to set a delivery destination (keyboard users can type lat/lng in the fields beside it). */
export function LocationPicker({ value, onChange, center }: { value: GeoPoint | null; onChange: (p: GeoPoint) => void; center: GeoPoint }) {
  const c = value ?? center;
  return (
    <div className="h-56 overflow-hidden rounded-lg border border-border" role="region" aria-label="Destination picker map — click to set the delivery point">
      <MapContainer center={[c.lat, c.lng]} zoom={13} className="h-full w-full">
        <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} maxZoom={19} />
        <ClickHandler onPick={onChange} />
        {value && <Marker position={[value.lat, value.lng]} icon={pin} />}
      </MapContainer>
    </div>
  );
}
