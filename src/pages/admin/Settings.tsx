import { useEffect, useState } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { Database, RotateCcw, Save, SlidersHorizontal, Target, TriangleAlert, Warehouse } from "lucide-react";
import { db } from "@/lib/firebase";
import { useOps, DEFAULT_SETTINGS } from "@/context/OpsData";
import { useAuth } from "@/context/AuthContext";
import type { SystemSettings } from "@/lib/types";
import { resetDemoData, seedDemoData } from "@/lib/seed";
import { dateTime } from "@/lib/format";
import { Button, Card, CardHeader, Field, Input, PageHeader, Progress } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/Dialog";
import { useAction, useToast } from "@/components/ui/Toast";

type Editable = Omit<SystemSettings, "demoDataLoadedAt">;

export default function Settings() {
  useEffect(() => {
    document.title = "Settings · SmartRoute Guardian";
  }, []);
  const { settings, vehicles, parcels, users } = useOps();
  const { actor, user } = useAuth();
  const run = useAction();
  const toast = useToast();
  const [f, setF] = useState<Editable>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [dataBusy, setDataBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    const { demoDataLoadedAt: _ignored, ...rest } = settings;
    setF(rest);
  }, [settings]);

  const num = (k: keyof Editable) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: Number(e.target.value) }));
  const hasData = vehicles.length > 0 || parcels.length > 0;

  const save = async () => {
    setBusy(true);
    await run(() => setDoc(doc(db, "settings", "system"), { ...f, updatedAt: serverTimestamp() }, { merge: true }), "Settings saved", "Gateways pick up new thresholds on their next restart.");
    setBusy(false);
  };

  const load = async () => {
    if (!actor) return;
    setDataBusy("Loading demo dataset…");
    setProgress(0);
    const ok = await run(async () => {
      if (hasData) await resetDemoData(db, (m) => setDataBusy(m));
      setDataBusy("Writing demo dataset…");
      // Keep a real driver account (not a demo profile) at the wheel of VAN-01 if one exists.
      const realDrivers = users.filter((u) => u.role === "driver" && !u.demo);
      const driverUid = (realDrivers.find((u) => u.vehicleId === "VAN-01") ?? realDrivers[0])?.id ?? null;
      await seedDemoData(db, { actor, onProgress: (d, t) => setProgress((d / t) * 100), driverUid });
    });
    setDataBusy(null);
    if (ok) toast({ tone: "success", title: "Demo dataset loaded", body: "4 vans, ~200 parcels, a week of history and live exceptions." });
  };

  const reset = async () => {
    setConfirmReset(false);
    setDataBusy("Deleting…");
    const ok = await run(() => resetDemoData(db, (m) => setDataBusy(m)));
    setDataBusy(null);
    if (ok) toast({ tone: "success", title: "Operational data cleared", body: "User accounts and settings were kept." });
  };

  return (
    <>
      <PageHeader title="Settings" description="Verification thresholds, pilot targets and the demo dataset." actions={<Button icon={Save} loading={busy} onClick={save}>Save settings</Button>} />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader icon={SlidersHorizontal} title="Verification engine" description="Used by gateways and the simulator" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Absence timeout (s)" help="A tag unread for this long counts as removed. Lower = faster alerts, more false alarms.">
              {(p) => <Input {...p} type="number" min={2} max={60} value={f.absenceTimeoutSec} onChange={num("absenceTimeoutSec")} />}
            </Field>
            <Field label="Delivery geofence (m)" help="Removal within this distance of the destination counts as a delivery.">
              {(p) => <Input {...p} type="number" min={25} max={1000} value={f.geofenceM} onChange={num("geofenceM")} />}
            </Field>
            <Field label="Gateway heartbeat (s)">{(p) => <Input {...p} type="number" min={5} max={120} value={f.heartbeatSec} onChange={num("heartbeatSec")} />}</Field>
            <Field label="Mark reader offline after (s)">{(p) => <Input {...p} type="number" min={15} max={600} value={f.offlineAfterSec} onChange={num("offlineAfterSec")} />}</Field>
          </div>
        </Card>

        <Card>
          <CardHeader icon={Target} title="Pilot targets" description="From the project scope; drive the green/amber states on every dashboard" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Static detection (%)">{(p) => <Input {...p} type="number" min={50} max={100} value={f.targetStaticDetection} onChange={num("targetStaticDetection")} />}</Field>
            <Field label="Realistic loading detection (%)">{(p) => <Input {...p} type="number" min={50} max={100} value={f.targetLoadingDetection} onChange={num("targetLoadingDetection")} />}</Field>
            <Field label="Alert latency under (s)">{(p) => <Input {...p} type="number" min={1} max={120} value={f.targetLatencySec} onChange={num("targetLatencySec")} />}</Field>
            <Field label="Parcels per test">{(p) => <Input {...p} type="number" min={1} max={500} value={f.targetParcels} onChange={num("targetParcels")} />}</Field>
          </div>
        </Card>

        <Card>
          <CardHeader icon={Warehouse} title="Hub" description="Where vehicles load; routes start and end here" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Organisation name" className="sm:col-span-2">{(p) => <Input {...p} value={f.orgName} onChange={(e) => setF((x) => ({ ...x, orgName: e.target.value }))} />}</Field>
            <Field label="Hub name" className="sm:col-span-2">{(p) => <Input {...p} value={f.hub.name} onChange={(e) => setF((x) => ({ ...x, hub: { ...x.hub, name: e.target.value } }))} />}</Field>
            <Field label="Latitude">{(p) => <Input {...p} inputMode="decimal" value={f.hub.lat} onChange={(e) => setF((x) => ({ ...x, hub: { ...x.hub, lat: Number(e.target.value) } }))} />}</Field>
            <Field label="Longitude">{(p) => <Input {...p} inputMode="decimal" value={f.hub.lng} onChange={(e) => setF((x) => ({ ...x, hub: { ...x.hub, lng: Number(e.target.value) } }))} />}</Field>
          </div>
        </Card>

        <Card>
          <CardHeader icon={Database} title="Demo dataset" description={settings.demoDataLoadedAt ? `Loaded ${dateTime(settings.demoDataLoadedAt)}` : "Not loaded"} />
          <div className="space-y-4 p-5 text-[14px]">
            <p className="text-fg-muted">
              A Gurugram scenario with 4 vans and RFID gateways, ~200 parcels, six days of completed routes, and live exceptions today (a parcel loaded into the wrong van, an unauthorized removal, an unknown tag). Every demo document is flagged so it can be wiped before the real pilot.
            </p>
            {dataBusy && (
              <div className="space-y-2" role="status">
                <p className="font-semibold">{dataBusy}</p>
                <Progress value={progress} label="Demo data progress" />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button icon={Database} onClick={load} loading={!!dataBusy} disabled={!user}>
                {hasData ? "Reset & reload demo dataset" : "Load demo dataset"}
              </Button>
              <Button variant="outline" icon={RotateCcw} onClick={() => setConfirmReset(true)} disabled={!!dataBusy || !hasData}>
                Clear all operational data
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <Dialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        size="sm"
        title="Clear all operational data?"
        description="Deletes every vehicle, reader, parcel, route, alert, message, pilot trial and audit event. User accounts and these settings are kept."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>Cancel</Button>
            <Button variant="danger" icon={RotateCcw} onClick={reset}>Clear data</Button>
          </>
        }
      >
        <p className="flex items-start gap-2 text-[14px] text-warning">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Do this before starting the real pilot so demo numbers never mix with measured results.
        </p>
      </Dialog>
    </>
  );
}
