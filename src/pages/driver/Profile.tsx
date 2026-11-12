import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { Cpu, LogOut, Moon, Save, ShieldCheck, Sun, Truck } from "lucide-react";
import { useDriver } from "@/components/layout/DriverLayout";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/components/layout/ThemeToggle";
import { Avatar, Badge, Button, Card, CardHeader, Field, Input } from "@/components/ui/primitives";
import { ReaderBadge } from "@/components/ui/Status";
import { useAction } from "@/components/ui/Toast";
import { db } from "@/lib/firebase";
import { ago } from "@/lib/format";
import { DriverHeading, PreviewNote, usePageTitle } from "@/components/driver/common";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3">
      <dt className="text-[14px] text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[14px] font-semibold">{children}</dd>
    </div>
  );
}

export default function Profile() {
  usePageTitle("Profile");
  const { profile, role, signOut } = useAuth();
  const { vehicle, device, readerOnline, isPreview } = useDriver();
  const { dark, toggle } = useTheme();
  const navigate = useNavigate();
  const run = useAction();

  const [name, setName] = useState(profile?.name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    setName(profile?.name ?? "");
    setPhone(profile?.phone ?? "");
  }, [profile?.name, profile?.phone]);

  const dirty = (profile?.name ?? "") !== name || (profile?.phone ?? "") !== phone;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!profile || isPreview) return;
    if (name.trim().length < 2) {
      setNameError("Enter your full name (at least 2 characters).");
      return;
    }
    setNameError(null);
    setSaving(true);
    await run(
      () => updateDoc(doc(db, "users", profile.id), { name: name.trim(), phone: phone.trim(), updatedAt: serverTimestamp() }),
      "Profile saved",
    );
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <DriverHeading title="Profile" />
      <PreviewNote show={isPreview} />

      <Card className="flex items-center gap-4 p-5">
        <Avatar name={profile?.name ?? "?"} className="h-14 w-14 text-[18px]" />
        <div className="min-w-0">
          <p className="truncate text-[18px] font-semibold">{profile?.name}</p>
          <p className="truncate text-[14px] text-fg-muted">{profile?.email}</p>
          <Badge tone="primary" icon={ShieldCheck} className="mt-1 capitalize">
            {role ?? "—"}
          </Badge>
        </div>
      </Card>

      <Card>
        <CardHeader title="Your details" description={isPreview ? "Editing is disabled in preview mode." : "Visible to dispatch."} />
        <form onSubmit={save} className="space-y-4 p-5" noValidate>
          <Field label="Full name" required error={nameError}>
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" disabled={isPreview} />}
          </Field>
          <Field label="Phone" help="Dispatch uses this to reach you on the road.">
            {(p) => <Input {...p} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" disabled={isPreview} />}
          </Field>
          <Button type="submit" icon={Save} className="w-full" loading={saving} disabled={isPreview || !dirty}>
            Save changes
          </Button>
        </form>
      </Card>

      <Card>
        <CardHeader icon={Truck} title="Assigned vehicle" />
        {vehicle ? (
          <dl className="divide-y divide-border">
            <Row label="Vehicle">
              {vehicle.id} · {vehicle.name}
            </Row>
            <Row label="Plate">
              <span className="font-mono">{vehicle.plate}</span>
            </Row>
            <Row label="Capacity">{vehicle.capacity} parcels</Row>
            <Row label="RFID reader">
              <span className="inline-flex items-center gap-1.5 font-mono">
                <Cpu className="h-4 w-4 text-fg-muted" aria-hidden />
                {device?.id ?? vehicle.deviceId ?? "Not fitted"}
              </span>
            </Row>
            {device && (
              <>
                <Row label="Firmware">
                  <span className="font-mono text-[13px]">{device.firmware}</span>
                </Row>
                <Row label="Reader status">
                  <span className="inline-flex flex-wrap items-center justify-end gap-2">
                    <ReaderBadge online={readerOnline} />
                    <span className="text-[12px] font-normal text-fg-subtle">heartbeat {ago(device.lastHeartbeat, "never")}</span>
                  </span>
                </Row>
              </>
            )}
          </dl>
        ) : (
          <p className="px-5 py-4 text-[14px] text-fg-muted">No vehicle is linked to your account yet. Ask an administrator to assign one.</p>
        )}
      </Card>

      <Card>
        <button onClick={toggle} className="flex min-h-[56px] w-full items-center gap-3 px-5 py-3 text-left hover:bg-surface-2" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>
          {dark ? <Sun className="h-5 w-5 text-fg-muted" aria-hidden /> : <Moon className="h-5 w-5 text-fg-muted" aria-hidden />}
          <span className="flex-1 text-[15px] font-semibold">Theme</span>
          <span className="text-[14px] text-fg-muted">{dark ? "Dark" : "Light"}</span>
        </button>
      </Card>

      <Card className="p-5">
        <h2 className="text-[15px] font-semibold">About SmartRoute Guardian</h2>
        <p className="mt-1 text-[14px] text-fg-muted">
          A low-cost RFID verification layer for delivery vehicles: a reader in the cargo area checks which tagged parcels are on board, so the right parcels are in the
          right vehicle at the right time — and any parcel that goes missing or leaves at the wrong place is flagged within seconds.
        </p>
      </Card>

      <div className="pt-2">
        <Button
          variant="outline"
          size="lg"
          icon={LogOut}
          className="h-12 w-full border-danger/40 text-danger hover:bg-danger-soft"
          onClick={async () => {
            await signOut();
            navigate("/login", { replace: true });
          }}
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}
