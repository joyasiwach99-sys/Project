import { useEffect, useState } from "react";
import { deleteDoc, doc, serverTimestamp, updateDoc, writeBatch } from "firebase/firestore";
import { Check, Search, ShieldCheck, Trash2, UserCheck, Users } from "lucide-react";
import { db } from "@/lib/firebase";
import { useOps } from "@/context/OpsData";
import { useAuth } from "@/context/AuthContext";
import type { Role, UserProfile } from "@/lib/types";
import { dateTime } from "@/lib/format";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Input, PageHeader, Select, Table, Td, Th, type Tone } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/Dialog";
import { useAction } from "@/components/ui/Toast";

const ROLE_META: Record<Role, { label: string; tone: Tone; help: string }> = {
  admin: { label: "Admin", tone: "navy", help: "Full control" },
  viewer: { label: "Viewer", tone: "primary", help: "Read-only dashboards" },
  driver: { label: "Driver", tone: "success", help: "Own vehicle & route" },
  device: { label: "Device", tone: "neutral", help: "RFID gateway account" },
  pending: { label: "Pending", tone: "warning", help: "Awaiting approval" },
};

export default function People() {
  useEffect(() => {
    document.title = "People & roles · SmartRoute Guardian";
  }, []);
  const { users, vehicles, devices } = useOps();
  const { isAdmin, profile } = useAuth();
  const run = useAction();
  const [q, setQ] = useState("");
  const [removing, setRemoving] = useState<UserProfile | null>(null);

  const pending = users.filter((u) => u.role === "pending");
  const needle = q.trim().toLowerCase();
  const rows = users
    .filter((u) => u.role !== "pending")
    .filter((u) => !needle || u.name?.toLowerCase().includes(needle) || u.email?.toLowerCase().includes(needle))
    .sort((a, b) => ["admin", "viewer", "driver", "device"].indexOf(a.role) - ["admin", "viewer", "driver", "device"].indexOf(b.role) || (a.name ?? "").localeCompare(b.name ?? ""));

  const setRole = (u: UserProfile, role: Role) =>
    run(() => updateDoc(doc(db, "users", u.id), { role, ...(role !== "driver" && role !== "device" ? { vehicleId: null } : {}), updatedAt: serverTimestamp() }), `${u.name} is now ${ROLE_META[role].label.toLowerCase()}`);

  const setVehicle = (u: UserProfile, vehicleId: string) =>
    run(async () => {
      const b = writeBatch(db);
      b.update(doc(db, "users", u.id), { vehicleId: vehicleId || null, updatedAt: serverTimestamp() });
      if (u.role === "driver") {
        for (const v of vehicles) {
          if (v.driverId === u.id && v.id !== vehicleId) b.update(doc(db, "vehicles", v.id), { driverId: null, updatedAt: serverTimestamp() });
        }
        if (vehicleId) b.update(doc(db, "vehicles", vehicleId), { driverId: u.id, updatedAt: serverTimestamp() });
      }
      await b.commit();
    }, "Vehicle assignment saved");

  return (
    <>
      <PageHeader title="People & roles" description="Approve sign-ups, assign drivers to vehicles and link RFID gateway accounts. Roles are enforced by Firestore security rules." />

      {pending.length > 0 && (
        <Card className="mb-6 border-orange/40">
          <CardHeader icon={UserCheck} title={`Awaiting approval (${pending.length})`} description="New sign-ups can’t see any data until you approve them." />
          <ul className="divide-y divide-border">
            {pending.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Avatar name={u.name} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{u.name}</p>
                  <p className="text-[13px] text-fg-muted">{u.email} · {u.phone || "no phone"} · signed up {dateTime(u.createdAt)}</p>
                </div>
                {isAdmin && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" icon={Check} onClick={() => setRole(u, "driver")}>Approve as driver</Button>
                    <Button size="sm" variant="outline" onClick={() => setRole(u, "viewer")}>Viewer</Button>
                    <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setRemoving(u)}>Reject</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div className="relative w-full max-w-sm">
            <label htmlFor="ppl-q" className="sr-only">Search people</label>
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-fg-subtle" aria-hidden />
            <Input id="ppl-q" type="search" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" />
          </div>
          <div className="flex flex-wrap gap-2 text-[13px] text-fg-muted">
            {(["admin", "viewer", "driver", "device"] as Role[]).map((r) => (
              <Badge key={r} tone={ROLE_META[r].tone}>{users.filter((u) => u.role === r).length} {ROLE_META[r].label.toLowerCase()}{users.filter((u) => u.role === r).length === 1 ? "" : "s"}</Badge>
            ))}
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={Users} title="No people found" />
        ) : (
          <Table label="People">
            <thead>
              <tr>
                <Th>Person</Th>
                <Th>Role</Th>
                <Th>Vehicle</Th>
                <Th>Gateway</Th>
                {isAdmin && <Th><span className="sr-only">Actions</span></Th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const self = u.id === profile?.id;
                return (
                  <tr key={u.id}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} />
                        <div className="min-w-0">
                          <p className="font-semibold">{u.name}{self && <span className="ml-1 text-[12px] text-fg-muted">(you)</span>}</p>
                          <p className="truncate text-[13px] text-fg-muted">{u.email || (u.demo ? "Demo profile — no login" : "—")}</p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      {isAdmin && !self ? (
                        <>
                          <label htmlFor={`role-${u.id}`} className="sr-only">Role for {u.name}</label>
                          <Select id={`role-${u.id}`} value={u.role} onChange={(e) => setRole(u, e.target.value as Role)} className="h-9 w-36 text-[14px]">
                            {(["admin", "viewer", "driver", "device"] as Role[]).map((r) => <option key={r} value={r}>{ROLE_META[r].label}</option>)}
                          </Select>
                        </>
                      ) : (
                        <Badge tone={ROLE_META[u.role].tone} icon={u.role === "admin" ? ShieldCheck : undefined}>{ROLE_META[u.role].label}</Badge>
                      )}
                    </Td>
                    <Td>
                      {u.role === "driver" || u.role === "device" ? (
                        isAdmin ? (
                          <>
                            <label htmlFor={`veh-${u.id}`} className="sr-only">Vehicle for {u.name}</label>
                            <Select id={`veh-${u.id}`} value={u.vehicleId ?? ""} onChange={(e) => setVehicle(u, e.target.value)} className="h-9 w-32 text-[14px]">
                              <option value="">None</option>
                              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}
                            </Select>
                          </>
                        ) : (
                          u.vehicleId ?? "—"
                        )
                      ) : (
                        <span className="text-fg-subtle">—</span>
                      )}
                    </Td>
                    <Td>
                      {u.role === "device" ? (
                        isAdmin ? (
                          <>
                            <label htmlFor={`dev-${u.id}`} className="sr-only">Gateway for {u.name}</label>
                            <Select
                              id={`dev-${u.id}`}
                              value={u.deviceId ?? ""}
                              onChange={(e) => run(() => updateDoc(doc(db, "users", u.id), { deviceId: e.target.value || null, updatedAt: serverTimestamp() }), "Gateway linked")}
                              className="h-9 w-32 text-[14px]"
                            >
                              <option value="">None</option>
                              {devices.map((d) => <option key={d.id} value={d.id}>{d.id}</option>)}
                            </Select>
                          </>
                        ) : (
                          u.deviceId ?? "—"
                        )
                      ) : (
                        <span className="text-fg-subtle">—</span>
                      )}
                    </Td>
                    {isAdmin && (
                      <Td className="text-right">
                        {!self && (
                          <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setRemoving(u)} aria-label={`Remove ${u.name}`}>
                            <span className="hidden sm:inline">Remove</span>
                          </Button>
                        )}
                      </Td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="mt-4 text-[13px] text-fg-muted">
        Device accounts are ordinary email/password accounts used by each Raspberry Pi. Create one with the sign-up page, then set its role to Device here and link its vehicle and gateway.
      </p>

      <Dialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        size="sm"
        title={`Remove ${removing?.name}?`}
        description="Their profile is deleted, so they lose all access. Their login can sign up again and will return as pending."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button>
            <Button
              variant="danger"
              icon={Trash2}
              onClick={async () => {
                if (!removing) return;
                const ok = await run(() => deleteDoc(doc(db, "users", removing.id)), "Profile removed");
                if (ok) setRemoving(null);
              }}
            >
              Remove access
            </Button>
          </>
        }
      >
        <p className="text-[14px] text-fg-muted">Audit-trail entries they created are kept.</p>
      </Dialog>
    </>
  );
}
