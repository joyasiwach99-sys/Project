import { useEffect, useState } from "react";
import { Dices, Save } from "lucide-react";
import type { Parcel } from "@/lib/types";
import { registerParcel, updateParcelDetails, type NewParcel } from "@/lib/actions";
import { normalizeEpc } from "@/lib/verification";
import { randomEpc } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { useOps } from "@/context/OpsData";
import { Button, Field, Input, Select } from "../ui/primitives";
import { Dialog } from "../ui/Dialog";
import { useAction } from "../ui/Toast";
import { LocationPicker } from "../map/LocationPicker";

const BLANK: NewParcel = {
  recipientName: "",
  recipientPhone: "",
  address: "",
  area: "",
  city: "Gurugram",
  lat: NaN,
  lng: NaN,
  weightKg: 1,
  size: "M",
  priority: "standard",
  epc: "",
};

/** Register a newly tagged parcel (or edit one). The EPC comes from the tag — read it with the gateway's scan tool. */
export function ParcelDialog({ open, onClose, parcel }: { open: boolean; onClose: () => void; parcel?: Parcel }) {
  const { actor } = useAuth();
  const { parcelByEpc, settings } = useOps();
  const [f, setF] = useState<NewParcel>(BLANK);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const run = useAction();

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setF(
      parcel
        ? {
            recipientName: parcel.recipientName,
            recipientPhone: parcel.recipientPhone ?? "",
            address: parcel.address,
            area: parcel.area,
            city: parcel.city,
            lat: parcel.lat,
            lng: parcel.lng,
            weightKg: parcel.weightKg,
            size: parcel.size,
            priority: parcel.priority,
            epc: parcel.epc,
          }
        : BLANK,
    );
  }, [open, parcel]);

  const set = <K extends keyof NewParcel>(k: K, v: NewParcel[K]) => setF((x) => ({ ...x, [k]: v }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!f.recipientName.trim()) e.recipientName = "Recipient name is required.";
    if (!f.address.trim()) e.address = "Delivery address is required.";
    if (!f.area.trim()) e.area = "Area / locality is required.";
    const epc = normalizeEpc(f.epc);
    if (!/^[0-9A-F]{8,64}$/.test(epc)) e.epc = "Enter the tag’s EPC as hex (usually 24 characters).";
    else {
      const clash = parcelByEpc.get(epc);
      if (clash && clash.id !== parcel?.id) e.epc = `This tag is already registered to ${clash.trackingId}.`;
    }
    if (!Number.isFinite(f.lat) || !Number.isFinite(f.lng) || Math.abs(f.lat) > 90 || Math.abs(f.lng) > 180)
      e.lat = "Set the delivery point — click the map or type latitude/longitude.";
    if (!(f.weightKg > 0)) e.weightKg = "Weight must be above 0.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate() || !actor) return;
    setBusy(true);
    const ok = await run(
      () => (parcel ? updateParcelDetails(parcel, f) : registerParcel(f, actor)),
      parcel ? "Parcel updated" : "Parcel registered",
      parcel ? undefined : "A public tracking page was created for the customer.",
    );
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={parcel ? `Edit ${parcel.trackingId}` : "Register a tagged parcel"}
      description="Stick a UHF RFID label on the parcel, read its EPC with the gateway scan tool, then register it here."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button icon={Save} loading={busy} onClick={submit}>{parcel ? "Save changes" : "Register parcel"}</Button>
        </>
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="RFID tag EPC" required className="sm:col-span-2" error={errors.epc} help="python -m smartroute_gateway.tools.scan prints EPCs as tags are read.">
          {(p) => (
            <div className="flex gap-2">
              <Input {...p} value={f.epc} onChange={(e) => set("epc", e.target.value)} className="font-mono" placeholder="E28068940000501234ABCD12" autoComplete="off" spellCheck={false} />
              {!parcel && (
                <Button type="button" variant="outline" icon={Dices} onClick={() => set("epc", randomEpc())} title="Generate a random EPC for a simulated tag">
                  Demo tag
                </Button>
              )}
            </div>
          )}
        </Field>
        <Field label="Recipient name" required error={errors.recipientName}>
          {(p) => <Input {...p} value={f.recipientName} onChange={(e) => set("recipientName", e.target.value)} autoComplete="off" />}
        </Field>
        <Field label="Recipient phone">
          {(p) => <Input {...p} type="tel" value={f.recipientPhone} onChange={(e) => set("recipientPhone", e.target.value)} autoComplete="off" />}
        </Field>
        <Field label="Delivery address" required className="sm:col-span-2" error={errors.address}>
          {(p) => <Input {...p} value={f.address} onChange={(e) => set("address", e.target.value)} placeholder="Tower B, Flat 1204, DLF Phase 3" />}
        </Field>
        <Field label="Area / locality" required error={errors.area}>
          {(p) => <Input {...p} value={f.area} onChange={(e) => set("area", e.target.value)} placeholder="DLF Phase 3" />}
        </Field>
        <Field label="City">
          {(p) => <Input {...p} value={f.city} onChange={(e) => set("city", e.target.value)} />}
        </Field>
        <div className="sm:col-span-2">
          <p className="label mb-1.5">
            Delivery point <span className="text-danger" aria-hidden>*</span>
          </p>
          <LocationPicker
            value={Number.isFinite(f.lat) && Number.isFinite(f.lng) ? { lat: f.lat, lng: f.lng } : null}
            onChange={(pt) => setF((x) => ({ ...x, ...pt }))}
            center={settings.hub}
          />
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Field label="Latitude" error={errors.lat}>
              {(p) => <Input {...p} inputMode="decimal" value={Number.isFinite(f.lat) ? f.lat : ""} onChange={(e) => set("lat", parseFloat(e.target.value))} />}
            </Field>
            <Field label="Longitude">
              {(p) => <Input {...p} inputMode="decimal" value={Number.isFinite(f.lng) ? f.lng : ""} onChange={(e) => set("lng", parseFloat(e.target.value))} />}
            </Field>
          </div>
          <p className="help mt-1">The gateway uses this point with a {settings.geofenceM} m geofence to tell a delivery from an unauthorized removal.</p>
        </div>
        <Field label="Weight (kg)" error={errors.weightKg}>
          {(p) => <Input {...p} type="number" min={0.1} step={0.1} value={f.weightKg} onChange={(e) => set("weightKg", parseFloat(e.target.value))} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Size">
            {(p) => (
              <Select {...p} value={f.size} onChange={(e) => set("size", e.target.value as NewParcel["size"])}>
                <option value="S">Small</option>
                <option value="M">Medium</option>
                <option value="L">Large</option>
              </Select>
            )}
          </Field>
          <Field label="Priority">
            {(p) => (
              <Select {...p} value={f.priority} onChange={(e) => set("priority", e.target.value as NewParcel["priority"])}>
                <option value="standard">Standard</option>
                <option value="express">Express</option>
              </Select>
            )}
          </Field>
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
