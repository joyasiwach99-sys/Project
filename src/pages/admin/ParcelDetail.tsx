import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { collection, limit, orderBy, query, where } from "firebase/firestore";
import { ArrowLeft, CircleSlash, ExternalLink, Fingerprint, MapPin, Pencil, RotateCcw, ScrollText, ShieldCheck, Trash2, Truck } from "lucide-react";
import { db } from "@/lib/firebase";
import { useLiveQuery } from "@/hooks/useFirestore";
import { useOps } from "@/context/OpsData";
import { useAuth } from "@/context/AuthContext";
import type { AuditEvent, ParcelStatus } from "@/lib/types";
import { deleteParcel, setParcelStatus } from "@/lib/actions";
import { ago, dateTime } from "@/lib/format";
import { Badge, Button, Card, CardHeader, EmptyState, Field, LinkButton, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import { ParcelStatusBadge, RouteStatusBadge, HealthBadge } from "@/components/ui/Status";
import { Dialog } from "@/components/ui/Dialog";
import { useAction } from "@/components/ui/Toast";
import { FleetMap } from "@/components/map/FleetMap";
import { AlertItem } from "@/components/alerts/AlertItem";
import { EventRow } from "@/components/events/EventRow";
import { ParcelDialog } from "@/components/admin/ParcelDialog";

export default function ParcelDetail() {
  const { parcelId = "" } = useParams();
  const nav = useNavigate();
  const { parcelById, routeById, vehicleById, alerts, settings, loading } = useOps();
  const { isAdmin, actor, canWrite } = useAuth();
  const p = parcelById.get(parcelId);
  const [edit, setEdit] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [newStatus, setNewStatus] = useState<ParcelStatus>("returned");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const run = useAction();

  useEffect(() => {
    document.title = `${p?.trackingId ?? "Parcel"} · SmartRoute Guardian`;
  }, [p?.trackingId]);

  const events = useLiveQuery<AuditEvent>(
    parcelId ? query(collection(db, "events"), where("parcelId", "==", parcelId), orderBy("createdAt", "desc"), limit(50)) : null,
    `parcel-events:${parcelId}`,
  );

  if (!loading && !p) {
    return (
      <Card>
        <EmptyState icon={CircleSlash} title="Parcel not found" action={<LinkButton to="/admin/parcels" variant="outline" icon={ArrowLeft}>All parcels</LinkButton>} />
      </Card>
    );
  }
  if (!p) return null;
  const route = p.routeId ? routeById.get(p.routeId) : undefined;
  const assigned = p.vehicleId ? vehicleById.get(p.vehicleId) : undefined;
  const parcelAlerts = alerts.filter((a) => a.parcelId === p.id);
  const mismatch = p.inVehicleId && p.vehicleId && p.inVehicleId !== p.vehicleId;

  return (
    <>
      <Link to="/admin/parcels" className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Parcels
      </Link>
      <PageHeader
        title={p.trackingId}
        description={`${p.recipientName} · ${p.address}, ${p.area}, ${p.city}`}
        actions={
          <>
            <ParcelStatusBadge status={p.status} />
            <a href={`/track/${p.trackingId}`} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-border px-4 text-[14px] font-semibold hover:bg-surface-2">
              <ExternalLink className="h-4 w-4" aria-hidden /> Customer view
            </a>
            {isAdmin && (
              <>
                <Button variant="outline" icon={Pencil} onClick={() => setEdit(true)}>Edit</Button>
                <Button variant="outline" icon={RotateCcw} onClick={() => setStatusOpen(true)}>Change status</Button>
                <Button variant="ghost" icon={Trash2} onClick={() => setDelOpen(true)} className="text-danger hover:bg-danger-soft hover:text-danger">Delete</Button>
              </>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader icon={Fingerprint} title="RFID evidence" description="What the readers have physically observed" />
          <dl className="space-y-3 p-5 text-[14px]">
            <div>
              <dt className="text-[12px] text-fg-subtle">Tag EPC</dt>
              <dd className="epc text-[13px] font-semibold">{p.epc}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">Detected inside</dt>
              <dd>{p.inVehicleId ? <Badge tone={mismatch ? "warning" : "success"}>{p.inVehicleId}{mismatch ? " — wrong vehicle" : ""}</Badge> : <span className="text-fg-subtle">Not detected</span>}</dd>
            </div>
            <div className="flex justify-between gap-3"><dt className="text-fg-muted">Last read</dt><dd>{ago(p.lastSeenAt)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-fg-muted">Loaded (RFID)</dt><dd>{dateTime(p.loadedAt)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-fg-muted">Left vehicle (RFID)</dt><dd>{dateTime(p.leftVehicleAt)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-fg-muted">Delivered</dt><dd>{dateTime(p.deliveredAt)}</dd></div>
          </dl>
          {p.deliveryProof && (
            <div className="mx-5 mb-5 rounded-lg bg-success-soft p-3 text-[13px] text-success">
              <p className="flex items-center gap-1.5 font-semibold">
                <ShieldCheck className="h-4 w-4" aria-hidden />
                {p.deliveryProof.method === "rfid+driver" ? "Handover verified by RFID + driver" : p.deliveryProof.method === "driver" ? "Confirmed by driver only" : "Confirmed by admin"}
              </p>
              <p className="mt-1">
                Received by {p.deliveryProof.receiverName || "—"} · {p.deliveryProof.by?.name} · {dateTime(p.deliveryProof.at)}
              </p>
              {p.deliveryProof.note && <p className="mt-1 italic">“{p.deliveryProof.note}”</p>}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader icon={Truck} title="Assignment" />
          <dl className="space-y-3 p-5 text-[14px]">
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">Vehicle</dt>
              <dd>{assigned ? <Link to={`/admin/vehicles/${assigned.id}`} className="font-semibold text-primary hover:underline">{assigned.id} · {assigned.plate}</Link> : "Unassigned"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">Route</dt>
              <dd className="flex items-center gap-2">{route ? <>{route.code} <RouteStatusBadge status={route.status} /></> : "—"}</dd>
            </div>
            <div className="flex justify-between gap-3"><dt className="text-fg-muted">Stop</dt><dd className="tabular">{p.stopSeq ?? "—"}{route ? ` of ${route.stopCount}` : ""}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-fg-muted">Weight · size</dt><dd>{p.weightKg} kg · {p.size}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-fg-muted">Priority</dt><dd className="capitalize">{p.priority}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-fg-muted">Recipient phone</dt><dd>{p.recipientPhone || "—"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-fg-muted">Registered</dt><dd>{dateTime(p.createdAt)}</dd></div>
          </dl>
          {mismatch && (
            <div className="mx-5 mb-5"><HealthBadge health="warning" /> <span className="text-[13px] text-fg-muted">Detected in {p.inVehicleId}, assigned to {p.vehicleId}.</span></div>
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader icon={MapPin} title="Destination" description={`${settings.geofenceM} m delivery geofence`} />
          <FleetMap
            className="h-72"
            hub={route?.hub}
            stops={[p]}
            geofenceM={settings.geofenceM}
            vehicles={assigned && assigned.location ? [{ vehicle: assigned, health: "ok" }] : []}
            fitKey={`pd-${p.id}`}
            label={`Destination of ${p.trackingId}`}
          />
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader icon={ScrollText} title="Chain of custody" description="Audit-trail events for this parcel, newest first" />
          <ul className="divide-y divide-border px-4">
            {events.data.length === 0 && !events.loading && <EmptyState icon={ScrollText} title="No events yet" />}
            {events.data.map((e) => <EventRow key={e.id} e={e} showTime="full" links={false} />)}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Alerts for this parcel" description={`${parcelAlerts.length} total`} />
          <div className="space-y-3 p-4">
            {parcelAlerts.length === 0 ? <EmptyState icon={ShieldCheck} title="No alerts" /> : parcelAlerts.map((a) => <AlertItem key={a.id} alert={a} actor={actor} canAct={canWrite} />)}
          </div>
        </Card>
      </div>

      <ParcelDialog open={edit} onClose={() => setEdit(false)} parcel={p} />

      <Dialog
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        title="Change parcel status"
        description="Manual overrides are recorded in the audit trail and on the customer tracking page."
        footer={
          <>
            <Button variant="ghost" onClick={() => setStatusOpen(false)}>Cancel</Button>
            <Button
              loading={busy}
              disabled={!note.trim()}
              onClick={async () => {
                if (!actor) return;
                setBusy(true);
                const ok = await run(() => setParcelStatus(p, newStatus, actor, note.trim()), "Status updated");
                setBusy(false);
                if (ok) setStatusOpen(false);
              }}
            >
              Update status
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="New status">
            {(f) => (
              <Select {...f} value={newStatus} onChange={(e) => setNewStatus(e.target.value as ParcelStatus)}>
                <option value="returned">Returned to hub (removes from route)</option>
                <option value="registered">Back to unassigned (removes from route)</option>
                <option value="exception">Exception</option>
                <option value="in_transit">In transit</option>
              </Select>
            )}
          </Field>
          <Field label="Reason" required help="Shown on the customer tracking page.">
            {(f) => <Textarea {...f} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Customer asked to reschedule" />}
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={delOpen}
        onClose={() => setDelOpen(false)}
        size="sm"
        title={`Delete ${p.trackingId}?`}
        description="The parcel and its public tracking page are removed. Audit-trail events are kept."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDelOpen(false)}>Keep parcel</Button>
            <Button
              variant="danger"
              icon={Trash2}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                const ok = await run(() => deleteParcel(p), "Parcel deleted");
                setBusy(false);
                if (ok) nav("/admin/parcels");
              }}
            >
              Delete parcel
            </Button>
          </>
        }
      >
        <p className="text-[14px] text-fg-muted">This cannot be undone.</p>
      </Dialog>
    </>
  );
}
