import { useEffect, useMemo, useState } from "react";
import { collection, limit as qLimit, orderBy, query, where } from "firebase/firestore";
import { Download, Lock, ScrollText, Search } from "lucide-react";
import { db } from "@/lib/firebase";
import { useLiveQuery } from "@/hooks/useFirestore";
import { useOps } from "@/context/OpsData";
import type { AuditEvent, EventType } from "@/lib/types";
import { dateTime, dayKey, toDate } from "@/lib/format";
import { downloadCsv } from "@/lib/utils";
import { format } from "date-fns";
import { Button, Card, EmptyState, Input, PageHeader, Select, Skeleton } from "@/components/ui/primitives";
import { EVENT_META, EventRow } from "@/components/events/EventRow";

const GROUPS: { label: string; types: EventType[] }[] = [
  { label: "Loading & unloading", types: ["parcel_loaded", "parcel_unloaded", "parcel_left_at_stop"] },
  { label: "Deliveries", types: ["parcel_delivered"] },
  { label: "Routes & load checks", types: ["route_created", "route_started", "load_verified", "load_check_failed", "route_completed"] },
  { label: "Alerts", types: ["alert_raised", "alert_acknowledged", "alert_resolved"] },
  { label: "Parcels & notes", types: ["parcel_registered", "parcel_assigned", "note"] },
];

export default function Audit() {
  useEffect(() => {
    document.title = "Audit trail · SmartRoute Guardian";
  }, []);
  const { vehicles } = useOps();
  const [vehicle, setVehicle] = useState("");
  const [group, setGroup] = useState("");
  const [q, setQ] = useState("");
  const [max, setMax] = useState(150);

  const events = useLiveQuery<AuditEvent>(
    vehicle
      ? query(collection(db, "events"), where("vehicleId", "==", vehicle), orderBy("createdAt", "desc"), qLimit(max))
      : query(collection(db, "events"), orderBy("createdAt", "desc"), qLimit(max)),
    `audit:${vehicle}:${max}`,
  );

  const rows = useMemo(() => {
    const types = GROUPS.find((g) => g.label === group)?.types;
    const needle = q.trim().toLowerCase();
    return events.data
      .filter((e) => !types || types.includes(e.type))
      .filter((e) => !needle || e.message.toLowerCase().includes(needle) || (e.trackingId ?? "").toLowerCase().includes(needle) || (e.actor?.name ?? "").toLowerCase().includes(needle));
  }, [events.data, group, q]);

  const byDay = useMemo(() => {
    const out: { key: string; label: string; items: AuditEvent[] }[] = [];
    for (const e of rows) {
      const k = dayKey(e.createdAt) || "pending";
      let g = out.find((x) => x.key === k);
      if (!g) {
        const d = toDate(e.createdAt);
        g = { key: k, label: d ? format(d, "EEEE, d MMMM yyyy") : "Syncing…", items: [] };
        out.push(g);
      }
      g.items.push(e);
    }
    return out;
  }, [rows]);

  const exportCsv = () =>
    downloadCsv(
      `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((e) => ({
        time: dateTime(e.createdAt, ""),
        deviceTime: dateTime(e.deviceTime, ""),
        type: e.type,
        message: e.message,
        actorType: e.actor?.type ?? "",
        actor: e.actor?.name ?? "",
        vehicle: e.vehicleId ?? "",
        parcel: e.trackingId ?? "",
        epc: e.epc ?? "",
        lat: e.location?.lat ?? "",
        lng: e.location?.lng ?? "",
      })),
    );

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Timestamped history of every load, unload, delivery confirmation and alert action."
        actions={<Button variant="outline" icon={Download} onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>}
      />
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary-soft/60 px-4 py-3 text-[14px]">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p>
          <strong>Append-only.</strong> Security rules forbid editing events, and drivers and RFID gateways must use the server clock — so this history can be trusted as evidence.
        </p>
      </div>

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-[220px] flex-1">
            <label htmlFor="audit-q" className="label mb-1.5 block">Search</label>
            <Search className="pointer-events-none absolute left-3 top-[38px] h-4 w-4 text-fg-subtle" aria-hidden />
            <Input id="audit-q" type="search" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Message, tracking ID or person" />
          </div>
          <div>
            <label htmlFor="audit-group" className="label mb-1.5 block">Event type</label>
            <Select id="audit-group" value={group} onChange={(e) => setGroup(e.target.value)} className="w-56">
              <option value="">All events</option>
              {GROUPS.map((g) => <option key={g.label} value={g.label}>{g.label}</option>)}
            </Select>
          </div>
          <div>
            <label htmlFor="audit-veh" className="label mb-1.5 block">Vehicle</label>
            <Select id="audit-veh" value={vehicle} onChange={(e) => setVehicle(e.target.value)} className="w-40">
              <option value="">All vehicles</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}
            </Select>
          </div>
        </div>
      </Card>

      {events.loading && <Skeleton className="h-96 w-full rounded-xl" />}
      {!events.loading && rows.length === 0 && (
        <Card><EmptyState icon={ScrollText} title="No events match">Events appear as vehicles load and deliver parcels.</EmptyState></Card>
      )}
      <div className="space-y-4">
        {byDay.map((d) => (
          <Card key={d.key}>
            <h2 className="sticky top-16 z-10 rounded-t-xl border-b border-border bg-surface/95 px-5 py-2.5 text-[13px] font-semibold text-fg-muted backdrop-blur">
              {d.label} · {d.items.length} event{d.items.length === 1 ? "" : "s"}
            </h2>
            <ul className="divide-y divide-border px-4">
              {d.items.map((e) => <EventRow key={e.id} e={e} />)}
            </ul>
          </Card>
        ))}
      </div>
      {events.data.length >= max && (
        <div className="mt-4 text-center">
          <Button variant="outline" onClick={() => setMax((m) => m + 150)}>Load older events</Button>
        </div>
      )}
      <p className="mt-6 text-center text-[12px] text-fg-subtle">
        Event types: {Object.values(EVENT_META).length} · showing up to {max} most recent
      </p>
    </>
  );
}
