import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Download, FileUp, Package, Plus, Search, Upload } from "lucide-react";
import { useOps } from "@/context/OpsData";
import { useAuth } from "@/context/AuthContext";
import type { Parcel, ParcelStatus } from "@/lib/types";
import { registerParcel, type NewParcel } from "@/lib/actions";
import { ago, dateTime } from "@/lib/format";
import { downloadCsv } from "@/lib/utils";
import { normalizeEpc } from "@/lib/verification";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Segmented, Select, Table, Td, Textarea, Th } from "@/components/ui/primitives";
import { ParcelStatusBadge } from "@/components/ui/Status";
import { Dialog } from "@/components/ui/Dialog";
import { useAction, useToast } from "@/components/ui/Toast";
import { ParcelDialog } from "@/components/admin/ParcelDialog";

type Filter = "all" | "unassigned" | "active" | "delivered" | "exception";
const ACTIVE: ParcelStatus[] = ["assigned", "loaded", "in_transit"];

export default function Parcels() {
  useEffect(() => {
    document.title = "Parcels · SmartRoute Guardian";
  }, []);
  const { parcels, vehicles, loading } = useOps();
  const { isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const filter = (params.get("status") as Filter) || "all";
  const vehicleFilter = params.get("vehicle") ?? "";
  const [limit, setLimit] = useState(60);
  const [regOpen, setRegOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const counts = useMemo(
    () => ({
      all: parcels.length,
      unassigned: parcels.filter((p) => p.status === "registered").length,
      active: parcels.filter((p) => ACTIVE.includes(p.status)).length,
      delivered: parcels.filter((p) => p.status === "delivered").length,
      exception: parcels.filter((p) => p.status === "exception").length,
    }),
    [parcels],
  );

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const epcNeedle = normalizeEpc(q);
    return parcels
      .filter((p) =>
        filter === "all" ? true : filter === "unassigned" ? p.status === "registered" : filter === "active" ? ACTIVE.includes(p.status) : p.status === filter,
      )
      .filter((p) => !vehicleFilter || p.vehicleId === vehicleFilter || p.inVehicleId === vehicleFilter)
      .filter(
        (p) =>
          !needle ||
          p.trackingId.toLowerCase().includes(needle) ||
          p.recipientName.toLowerCase().includes(needle) ||
          p.area.toLowerCase().includes(needle) ||
          (epcNeedle.length >= 4 && p.epc.includes(epcNeedle)),
      )
      .sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0));
  }, [parcels, q, filter, vehicleFilter]);

  const exportCsv = () =>
    downloadCsv(
      `parcels-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((p) => ({
        trackingId: p.trackingId,
        epc: p.epc,
        status: p.status,
        recipientName: p.recipientName,
        area: p.area,
        city: p.city,
        address: p.address,
        lat: p.lat,
        lng: p.lng,
        assignedVehicle: p.vehicleId ?? "",
        detectedInVehicle: p.inVehicleId ?? "",
        stopSeq: p.stopSeq ?? "",
        deliveredAt: dateTime(p.deliveredAt, ""),
        deliveryMethod: p.deliveryProof?.method ?? "",
      })),
    );

  return (
    <>
      <PageHeader
        title="Parcels"
        description="Every parcel carries a UHF RFID label. Its assigned vehicle is the manifest; its detected vehicle is what the readers actually see."
        actions={
          <>
            <Button variant="outline" icon={Download} onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>
            {isAdmin && (
              <>
                <Button variant="outline" icon={Upload} onClick={() => setImportOpen(true)}>Import</Button>
                <Button icon={Plus} onClick={() => setRegOpen(true)}>Register parcel</Button>
              </>
            )}
          </>
        }
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-[220px] flex-1">
            <label htmlFor="parcel-search" className="label mb-1.5 block">Search</label>
            <Search className="pointer-events-none absolute left-3 top-[38px] h-4 w-4 text-fg-subtle" aria-hidden />
            <Input
              id="parcel-search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setParam("q", e.target.value);
              }}
              placeholder="Tracking ID, recipient, area or EPC"
              className="pl-9"
              type="search"
            />
          </div>
          <div className="w-44">
            <label htmlFor="veh-filter" className="label mb-1.5 block">Vehicle</label>
            <Select id="veh-filter" value={vehicleFilter} onChange={(e) => setParam("vehicle", e.target.value)}>
              <option value="">All vehicles</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}
            </Select>
          </div>
        </div>
        <Segmented
          className="mt-4"
          label="Filter by status"
          value={filter}
          onChange={(v) => setParam("status", v === "all" ? "" : v)}
          options={[
            { value: "all", label: "All", count: counts.all },
            { value: "unassigned", label: "Unassigned", count: counts.unassigned },
            { value: "active", label: "On route", count: counts.active },
            { value: "delivered", label: "Delivered", count: counts.delivered },
            { value: "exception", label: "Exceptions", count: counts.exception },
          ]}
        />
      </Card>

      <Card>
        {!loading && rows.length === 0 ? (
          <EmptyState icon={Package} title="No parcels match" action={isAdmin && parcels.length === 0 && <Button icon={Plus} onClick={() => setRegOpen(true)}>Register parcel</Button>}>
            {parcels.length === 0 ? "Register your first RFID-tagged parcel." : "Try a different search or filter."}
          </EmptyState>
        ) : (
          <Table label="Parcels">
            <thead>
              <tr>
                <Th>Parcel</Th>
                <Th>Recipient</Th>
                <Th>Status</Th>
                <Th>Assigned</Th>
                <Th>RFID detects in</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((p) => (
                <ParcelRow key={p.id} p={p} />
              ))}
            </tbody>
          </Table>
        )}
        {rows.length > limit && (
          <div className="border-t border-border p-3 text-center">
            <Button variant="ghost" onClick={() => setLimit((l) => l + 60)}>
              Show more ({rows.length - limit} remaining)
            </Button>
          </div>
        )}
      </Card>

      <ParcelDialog open={regOpen} onClose={() => setRegOpen(false)} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}

function ParcelRow({ p }: { p: Parcel }) {
  const mismatch = p.inVehicleId && p.vehicleId && p.inVehicleId !== p.vehicleId;
  return (
    <tr className="hover:bg-surface-2/50">
      <Td>
        <Link to={`/admin/parcels/${p.id}`} className="font-mono text-[13px] font-semibold text-primary hover:underline">{p.trackingId}</Link>
        <div className="epc text-fg-subtle">{p.epc}</div>
      </Td>
      <Td>
        <div className="font-medium">{p.recipientName}</div>
        <div className="text-[12px] text-fg-muted">{p.area}, {p.city}</div>
      </Td>
      <Td>
        <div className="flex flex-wrap gap-1">
          <ParcelStatusBadge status={p.status} />
          {p.priority === "express" && <Badge tone="warning">Express</Badge>}
        </div>
      </Td>
      <Td>{p.vehicleId ? <span className="font-semibold">{p.vehicleId}</span> : <span className="text-fg-subtle">—</span>}{p.stopSeq ? <span className="text-[12px] text-fg-muted"> · stop {p.stopSeq}</span> : null}</Td>
      <Td>
        {p.inVehicleId ? (
          <Badge tone={mismatch ? "warning" : "success"}>{p.inVehicleId}{mismatch ? " (wrong)" : ""}</Badge>
        ) : (
          <span className="text-[13px] text-fg-subtle">Not detected</span>
        )}
      </Td>
      <Td className="text-[13px] text-fg-muted">{ago(p.updatedAt)}</Td>
    </tr>
  );
}

function parseCsv(text: string): Record<string, string>[] {
  const lines: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((c) => c.trim())) lines.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim())) lines.push(row);
  const [head, ...body] = lines;
  if (!head) return [];
  const keys = head.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

const TEMPLATE = `recipientName,recipientPhone,address,area,city,lat,lng,epc,weightKg,size,priority
Aditi Rao,+91 98100 00000,"Tower 4, Flat 802, Park Place",Sector 54,Gurugram,28.4372,77.1010,E2801170000020AB12CD34EF,1.2,M,standard`;

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { actor } = useAuth();
  const { parcelByEpc } = useOps();
  const toast = useToast();
  const run = useAction();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const parsed = useMemo(() => {
    const rows = parseCsv(text);
    const seen = new Set<string>();
    return rows.map((r, i) => {
      const epc = normalizeEpc(r.epc ?? "");
      const lat = parseFloat(r.lat ?? "");
      const lng = parseFloat(r.lng ?? "");
      let error = "";
      if (!r.recipientName || !r.address || !r.area) error = "missing name/address/area";
      else if (!/^[0-9A-F]{8,64}$/.test(epc)) error = "invalid EPC";
      else if (parcelByEpc.has(epc) || seen.has(epc)) error = "duplicate EPC";
      else if (!Number.isFinite(lat) || !Number.isFinite(lng)) error = "invalid lat/lng";
      seen.add(epc);
      const input: NewParcel = {
        recipientName: r.recipientName ?? "",
        recipientPhone: r.recipientPhone ?? "",
        address: r.address ?? "",
        area: r.area ?? "",
        city: r.city || "Gurugram",
        lat,
        lng,
        epc,
        weightKg: parseFloat(r.weightKg ?? "") || 1,
        size: (["S", "M", "L"].includes(r.size ?? "") ? r.size : "M") as NewParcel["size"],
        priority: r.priority === "express" ? "express" : "standard",
      };
      return { line: i + 2, input, error };
    });
  }, [text, parcelByEpc]);

  const valid = parsed.filter((r) => !r.error);

  const doImport = async () => {
    if (!actor || !valid.length) return;
    setBusy(true);
    setProgress(0);
    let done = 0;
    const ok = await run(async () => {
      for (const r of valid) {
        await registerParcel(r.input, actor);
        done += 1;
        setProgress(done);
      }
    });
    setBusy(false);
    if (ok) {
      toast({ tone: "success", title: `Imported ${done} parcels` });
      setText("");
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Import parcels from CSV"
      description="Paste rows exported from your order system or spreadsheet. One RFID tag (EPC) per parcel."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button icon={FileUp} loading={busy} disabled={!valid.length} onClick={doImport}>
            {busy ? `Importing ${progress}/${valid.length}` : `Import ${valid.length} parcel${valid.length === 1 ? "" : "s"}`}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="CSV with header row" help="Required columns: recipientName, address, area, lat, lng, epc. Optional: recipientPhone, city, weightKg, size (S/M/L), priority (standard/express).">
          {(p) => <Textarea {...p} value={text} onChange={(e) => setText(e.target.value)} className="min-h-[180px] font-mono text-[12px]" placeholder={TEMPLATE} spellCheck={false} />}
        </Field>
        <Button variant="outline" size="sm" onClick={() => setText(TEMPLATE)}>Insert example</Button>
        {parsed.length > 0 && (
          <div className="rounded-lg border border-border p-3 text-[13px]">
            <p className="font-semibold">{valid.length} ready · {parsed.length - valid.length} with problems</p>
            <ul className="mt-1 max-h-32 overflow-y-auto text-fg-muted">
              {parsed.filter((r) => r.error).map((r) => (
                <li key={r.line}>Line {r.line}: {r.error}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
}
