import { useEffect, useState } from "react";
import { doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { Save } from "lucide-react";
import { db } from "@/lib/firebase";
import { saveVehicle } from "@/lib/actions";
import type { Vehicle } from "@/lib/types";
import { useOps } from "@/context/OpsData";
import { Button, Field, Input, Select } from "../ui/primitives";
import { Dialog } from "../ui/Dialog";
import { useAction } from "../ui/Toast";

const EMPTY: Partial<Vehicle> = { id: "", name: "", plate: "", type: "van", capacity: 40, driverId: null, deviceId: null };

/** Create / edit a vehicle and keep driver + reader links consistent on both sides. */
export function VehicleDialog({ open, onClose, vehicle }: { open: boolean; onClose: () => void; vehicle?: Vehicle }) {
  const { users, devices, vehicles } = useOps();
  const [v, setV] = useState<Partial<Vehicle>>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = useAction();
  const isNew = !vehicle;

  useEffect(() => {
    if (open) {
      setV(vehicle ? { ...vehicle } : EMPTY);
      setErr(null);
    }
  }, [open, vehicle]);

  const drivers = users.filter((u) => u.role === "driver");
  const set = <K extends keyof Vehicle>(k: K, val: Vehicle[K]) => setV((x) => ({ ...x, [k]: val }));

  const submit = async () => {
    const id = (v.id ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9-]{3,20}$/.test(id)) return setErr("Use 3–20 letters, numbers or dashes, e.g. VAN-05.");
    if (isNew && vehicles.some((x) => x.id === id)) return setErr("A vehicle with this ID already exists.");
    if (!v.plate?.trim()) return setErr("Number plate is required.");
    setErr(null);
    setBusy(true);
    const ok = await run(async () => {
      await saveVehicle(
        {
          id,
          name: v.name?.trim() || id,
          plate: v.plate!.trim().toUpperCase(),
          type: v.type ?? "van",
          capacity: Number(v.capacity) || 40,
          driverId: v.driverId || null,
          deviceId: v.deviceId || null,
        },
        isNew,
      );
      // Mirror links: driver.vehicleId and device.vehicleId point back at this vehicle.
      const b = writeBatch(db);
      const prevDriver = vehicle?.driverId;
      if (prevDriver && prevDriver !== v.driverId) b.update(doc(db, "users", prevDriver), { vehicleId: null, updatedAt: serverTimestamp() });
      if (v.driverId) {
        for (const other of vehicles) {
          if (other.id !== id && other.driverId === v.driverId) b.update(doc(db, "vehicles", other.id), { driverId: null, updatedAt: serverTimestamp() });
        }
        b.update(doc(db, "users", v.driverId), { vehicleId: id, updatedAt: serverTimestamp() });
      }
      if (v.deviceId) b.update(doc(db, "devices", v.deviceId), { vehicleId: id, updatedAt: serverTimestamp() });
      await b.commit();
    }, isNew ? "Vehicle added" : "Vehicle updated");
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isNew ? "Add vehicle" : `Edit ${vehicle?.id}`}
      description="Each vehicle gets one RFID gateway (Raspberry Pi + CF591 reader) and, optionally, an assigned driver."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button icon={Save} loading={busy} onClick={submit}>{isNew ? "Add vehicle" : "Save changes"}</Button>
        </>
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Vehicle ID" required help="Short code shown everywhere, e.g. VAN-05" error={err}>
          {(p) => <Input {...p} value={v.id ?? ""} disabled={!isNew} onChange={(e) => set("id", e.target.value.toUpperCase())} autoComplete="off" />}
        </Field>
        <Field label="Number plate" required>
          {(p) => <Input {...p} value={v.plate ?? ""} onChange={(e) => set("plate", e.target.value)} placeholder="HR 26 EX 4471" autoComplete="off" />}
        </Field>
        <Field label="Model / name">
          {(p) => <Input {...p} value={v.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder="Tata Ace Gold" />}
        </Field>
        <Field label="Type">
          {(p) => (
            <Select {...p} value={v.type} onChange={(e) => set("type", e.target.value as Vehicle["type"])}>
              <option value="van">Van</option>
              <option value="mini_truck">Mini truck</option>
              <option value="three_wheeler">Three-wheeler</option>
            </Select>
          )}
        </Field>
        <Field label="Capacity (parcels)">
          {(p) => <Input {...p} type="number" min={1} max={500} value={v.capacity ?? 40} onChange={(e) => set("capacity", Number(e.target.value))} />}
        </Field>
        <Field label="Driver">
          {(p) => (
            <Select {...p} value={v.driverId ?? ""} onChange={(e) => set("driverId", e.target.value || null)}>
              <option value="">No driver</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} {d.vehicleId && d.vehicleId !== v.id ? `(currently ${d.vehicleId})` : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="RFID gateway" className="sm:col-span-2" help="Register readers under RFID readers first.">
          {(p) => (
            <Select {...p} value={v.deviceId ?? ""} onChange={(e) => set("deviceId", e.target.value || null)}>
              <option value="">No reader installed</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.id} · {d.model} {d.vehicleId && d.vehicleId !== v.id ? `(in ${d.vehicleId})` : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
