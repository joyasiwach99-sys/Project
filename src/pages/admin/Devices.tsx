import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { Cpu, Pencil, Plus, Save, Terminal, Thermometer, Wifi, WifiOff } from "lucide-react";
import { db } from "@/lib/firebase";
import { useOps } from "@/context/OpsData";
import { useAuth } from "@/context/AuthContext";
import { useNow } from "@/hooks/useFirestore";
import type { Device, DeviceConfig } from "@/lib/types";
import { ago } from "@/lib/format";
import { Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Input, PageHeader, Select } from "@/components/ui/primitives";
import { readerOnline } from "@/components/ui/Status";
import { Dialog } from "@/components/ui/Dialog";
import { useAction } from "@/components/ui/Toast";

const DEFAULT_CONFIG: DeviceConfig = { txPowerDbm: 26, absenceTimeoutSec: 6, geofenceM: 150, heartbeatSec: 15 };

export default function Devices() {
  useEffect(() => {
    document.title = "RFID readers · SmartRoute Guardian";
  }, []);
  const { devices, vehicles, users, settings, loading } = useOps();
  const { isAdmin } = useAuth();
  const now = useNow(5000);
  const [editing, setEditing] = useState<Device | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="RFID readers"
        description="Raspberry Pi 4 gateways with CHAFON CF591 UHF readers. Each signs in with its own device account, so security rules limit it to its own vehicle."
        actions={isAdmin && <Button icon={Plus} onClick={() => { setEditing(null); setOpen(true); }}>Register reader</Button>}
      />

      {!loading && devices.length === 0 && (
        <Card className="mb-6"><EmptyState icon={Cpu} title="No readers registered" /></Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {devices.map((d) => {
          const online = readerOnline(d, settings, now);
          const account = users.find((u) => u.role === "device" && u.deviceId === d.id);
          return (
            <Card key={d.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-3 border-b border-border p-4">
                <div className="flex items-start gap-3">
                  <span className={online ? "inline-flex h-10 w-10 items-center justify-center rounded-xl bg-success-soft text-success" : "inline-flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-fg-muted"}>
                    {online ? <Wifi className="h-5 w-5" aria-hidden /> : <WifiOff className="h-5 w-5" aria-hidden />}
                  </span>
                  <div>
                    <h2 className="font-display text-lg font-semibold">{d.id}</h2>
                    <p className="text-[13px] text-fg-muted">{d.model}</p>
                  </div>
                </div>
                {isAdmin && <IconButton label={`Edit ${d.id}`} icon={Pencil} onClick={() => { setEditing(d); setOpen(true); }} />}
              </div>
              <div className="flex-1 space-y-3 p-4 text-[13px]">
                <div className="flex flex-wrap gap-2">
                  <Badge tone={online ? "success" : "neutral"} dot pulse={online}>{online ? "Online" : "Offline"}</Badge>
                  {d.vehicleId && <Link to={`/admin/vehicles/${d.vehicleId}`}><Badge tone="primary">{d.vehicleId}</Badge></Link>}
                  <Badge tone="neutral">fw {d.firmware}</Badge>
                </div>
                <dl className="grid grid-cols-2 gap-2">
                  <div><dt className="text-fg-subtle">Heartbeat</dt><dd className="font-semibold">{ago(d.lastHeartbeat)}</dd></div>
                  <div><dt className="text-fg-subtle">Reads / min</dt><dd className="tabular font-semibold">{d.stats?.readsPerMin ?? "—"}</dd></div>
                  <div><dt className="text-fg-subtle">Tags in range</dt><dd className="tabular font-semibold">{d.stats?.uniqueTags ?? "—"}</dd></div>
                  <div>
                    <dt className="flex items-center gap-1 text-fg-subtle"><Thermometer className="h-3.5 w-3.5" aria-hidden />CPU</dt>
                    <dd className="tabular font-semibold">{d.stats?.cpuTempC != null ? `${d.stats.cpuTempC} °C` : "—"}</dd>
                  </div>
                  <div><dt className="text-fg-subtle">Tx power</dt><dd className="tabular font-semibold">{d.config?.txPowerDbm ?? "—"} dBm</dd></div>
                  <div><dt className="text-fg-subtle">Absence timeout</dt><dd className="tabular font-semibold">{d.config?.absenceTimeoutSec ?? "—"} s</dd></div>
                </dl>
                <p className="text-fg-muted">Device account: {account ? <span className="font-mono text-[12px]">{account.email}</span> : <span className="text-warning">not linked — create one under People</span>}</p>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="mt-8">
        <CardHeader icon={Terminal} title="Installing a gateway" description="Full guide: device/README.md and device/HARDWARE.md in the project repository" />
        <ol className="list-decimal space-y-2 px-10 py-5 text-[14px] text-fg-muted">
          <li>Flash Raspberry Pi OS Lite, connect the CF591 by USB and the GPS module to the UART.</li>
          <li>Copy the <code className="font-mono text-[12px]">device/</code> folder to the Pi and run <code className="font-mono text-[12px]">./install.sh</code>.</li>
          <li>Edit <code className="font-mono text-[12px]">config.json</code>: device email/password, <code className="font-mono text-[12px]">deviceId</code> and <code className="font-mono text-[12px]">vehicleId</code> matching this page.</li>
          <li>Test with <code className="font-mono text-[12px]">python -m smartroute_gateway.tools.scan</code>, then enable the systemd service. The reader turns green here within one heartbeat.</li>
        </ol>
      </Card>

      <DeviceDialog open={open} onClose={() => setOpen(false)} device={editing} vehicles={vehicles.map((v) => v.id)} />
    </>
  );
}

function DeviceDialog({ open, onClose, device, vehicles }: { open: boolean; onClose: () => void; device: Device | null; vehicles: string[] }) {
  const run = useAction();
  const [id, setId] = useState("");
  const [model, setModel] = useState("CHAFON CF591 UHF + Raspberry Pi 4");
  const [firmware, setFirmware] = useState("srg-gw 1.0.0");
  const [vehicleId, setVehicleId] = useState("");
  const [cfg, setCfg] = useState<DeviceConfig>(DEFAULT_CONFIG);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setId(device?.id ?? "");
    setModel(device?.model ?? "CHAFON CF591 UHF + Raspberry Pi 4");
    setFirmware(device?.firmware ?? "srg-gw 1.0.0");
    setVehicleId(device?.vehicleId ?? "");
    setCfg({ ...DEFAULT_CONFIG, ...(device?.config ?? {}) });
  }, [open, device]);

  const save = async () => {
    const did = id.trim().toUpperCase();
    if (!/^[A-Z0-9-]{3,20}$/.test(did)) return setErr("Use 3–20 letters, numbers or dashes, e.g. RDR-05.");
    setErr(null);
    setBusy(true);
    const ok = await run(async () => {
      if (device) {
        await updateDoc(doc(db, "devices", did), { model, firmware, vehicleId, config: cfg, updatedAt: serverTimestamp() });
      } else {
        await setDoc(doc(db, "devices", did), { vehicleId, model, firmware, lastHeartbeat: null, stats: {}, config: cfg, updatedAt: serverTimestamp() });
      }
      if (vehicleId) await updateDoc(doc(db, "vehicles", vehicleId), { deviceId: did, updatedAt: serverTimestamp() });
    }, device ? "Reader updated" : "Reader registered");
    setBusy(false);
    if (ok) onClose();
  };

  const num = (k: keyof DeviceConfig) => (e: React.ChangeEvent<HTMLInputElement>) => setCfg((c) => ({ ...c, [k]: Number(e.target.value) }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={device ? `Edit ${device.id}` : "Register an RFID reader"}
      description="Configuration is read by the gateway on start-up."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button icon={Save} loading={busy} onClick={save}>Save</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Reader ID" required error={err}>{(p) => <Input {...p} value={id} disabled={!!device} onChange={(e) => setId(e.target.value.toUpperCase())} placeholder="RDR-05" />}</Field>
        <Field label="Installed in">
          {(p) => (
            <Select {...p} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">Not installed</option>
              {vehicles.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Model" className="sm:col-span-2">{(p) => <Input {...p} value={model} onChange={(e) => setModel(e.target.value)} />}</Field>
        <Field label="Firmware">{(p) => <Input {...p} value={firmware} onChange={(e) => setFirmware(e.target.value)} />}</Field>
        <Field label="Tx power (dBm)" help="Within your reader's legal limit for 865–867 MHz">{(p) => <Input {...p} type="number" min={0} max={33} value={cfg.txPowerDbm} onChange={num("txPowerDbm")} />}</Field>
        <Field label="Absence timeout (s)" help="How long a tag may go unread before it counts as removed">{(p) => <Input {...p} type="number" min={2} max={60} value={cfg.absenceTimeoutSec} onChange={num("absenceTimeoutSec")} />}</Field>
        <Field label="Delivery geofence (m)">{(p) => <Input {...p} type="number" min={25} max={1000} value={cfg.geofenceM} onChange={num("geofenceM")} />}</Field>
        <Field label="Heartbeat (s)">{(p) => <Input {...p} type="number" min={5} max={120} value={cfg.heartbeatSec} onChange={num("heartbeatSec")} />}</Field>
      </div>
    </Dialog>
  );
}
