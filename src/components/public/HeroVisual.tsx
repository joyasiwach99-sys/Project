import { AlertTriangle, CheckCircle2, RadioTower } from "lucide-react";

/** Kraft-paper parcel with a white RFID label. */
function Parcel({ x, y, w, h, state }: { x: number; y: number; w: number; h: number; state?: "ok" | "alert" }) {
  const lw = Math.min(34, w * 0.5);
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="4" fill="#C9A47C" stroke="#9C7A55" strokeWidth="1.5" />
      <line x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h} stroke="#B48E64" strokeWidth="5" opacity="0.55" />
      <rect x={x + 6} y={y + 7} width={lw} height="14" rx="2" fill="#FFFFFF" />
      <rect x={x + 9} y={y + 11} width={lw - 14} height="2" rx="1" fill="#94A3B8" />
      <rect x={x + 9} y={y + 15.5} width={lw - 20} height="2" rx="1" fill="#CBD5E1" />
      {state === "ok" && (
        <g>
          <circle cx={x + w - 9} cy={y + 10} r="8" fill="#16A34A" stroke="#fff" strokeWidth="2" />
          <path d={`M${x + w - 13} ${y + 10}l3 3 5-6`} fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
      {state === "alert" && (
        <g>
          <circle cx={x + w - 9} cy={y + 10} r="8" fill="#EA580C" stroke="#fff" strokeWidth="2" />
          <rect x={x + w - 10} y={y + 5} width="2" height="6" rx="1" fill="#fff" />
          <circle cx={x + w - 9} cy={y + 14} r="1.3" fill="#fff" />
        </g>
      )}
    </g>
  );
}

const ROWS = [
  { id: "SRG-4K7Q2M", area: "Cyber City", ok: true },
  { id: "SRG-H8P3RW", area: "DLF Phase 3", ok: true },
  { id: "SRG-2NZ6TB", area: "Sector 29", ok: true },
  { id: "SRG-9TQ4XD", area: "Assigned to VAN-03", ok: false },
];

/**
 * Hero illustration: a delivery van cut-away with RFID-tagged parcels, the
 * reader antenna sweeping the cargo area, and a verification panel.
 * Purely illustrative — values are example data, not pilot results.
 */
export function HeroVisual() {
  return (
    <figure className="relative mx-auto w-full max-w-[560px]" aria-label="Illustration: an RFID reader inside a delivery van verifies each tagged parcel and flags one that belongs to another vehicle">
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-4 shadow-pop sm:p-5">
        <div className="mb-3 flex items-center justify-between text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-300">
          <span>VAN-01 · cargo area</span>
          <span className="inline-flex items-center gap-1.5 text-emerald-300">
            <span className="relative inline-flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-emerald-400" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Scanning
          </span>
        </div>

        <svg viewBox="0 0 520 300" className="h-auto w-full" role="img" aria-hidden>
          <defs>
            <linearGradient id="hv-body" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#F8FAFC" stopOpacity="0.16" />
              <stop offset="1" stopColor="#F8FAFC" stopOpacity="0.05" />
            </linearGradient>
            <linearGradient id="hv-unit" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#E2E8F0" />
              <stop offset="1" stopColor="#94A3B8" />
            </linearGradient>
          </defs>

          {/* Van body */}
          <rect x="14" y="24" width="370" height="214" rx="16" fill="url(#hv-body)" stroke="#CBD5E1" strokeOpacity="0.45" strokeWidth="2" />
          <path d="M384 70h62c10 0 18 5 24 13l30 44c5 7 6 12 6 20v77c0 8-6 14-14 14H384z" fill="url(#hv-body)" stroke="#CBD5E1" strokeOpacity="0.45" strokeWidth="2" />
          <path d="M398 86h44c6 0 11 3 15 8l24 36h-83z" fill="#60A5FA" fillOpacity="0.18" stroke="#93C5FD" strokeOpacity="0.5" strokeWidth="1.5" />
          {/* GPS near windshield */}
          <circle cx="452" cy="100" r="5" fill="#38BDF8" />
          <circle cx="452" cy="100" r="11" fill="none" stroke="#38BDF8" strokeOpacity="0.5" strokeWidth="1.5" />
          <text x="430" y="152" fill="#BAE6FD" fontSize="11" fontFamily="Source Sans 3, system-ui" fontWeight="600">GPS</text>

          {/* Wheels */}
          {[96, 320, 450].map((cx) => (
            <g key={cx}>
              <circle cx={cx} cy="252" r="26" fill="#0F172A" stroke="#475569" strokeWidth="3" />
              <circle cx={cx} cy="252" r="9" fill="#64748B" />
            </g>
          ))}

          {/* Reader unit on cargo wall */}
          <rect x="300" y="38" width="66" height="36" rx="6" fill="url(#hv-unit)" stroke="#F8FAFC" strokeOpacity="0.6" />
          <rect x="300" y="44" width="66" height="3" fill="#2563EB" />
          <circle cx="312" cy="62" r="3" fill="#22C55E" />
          <circle cx="322" cy="62" r="3" fill="#3B82F6" />
          <circle cx="332" cy="62" r="3" fill="#F97316" />
          <text x="341" y="66" fill="#0F172A" fontSize="9" fontFamily="JetBrains Mono, monospace" fontWeight="600">Pi</text>

          {/* Antenna near cargo opening + RF arcs */}
          <rect x="26" y="40" width="10" height="64" rx="3" fill="#0B1220" stroke="#64748B" />
          {[38, 62, 86, 110].map((r, i) => (
            <path key={r} d={`M${31 + r * 0.25} ${72 - r * 0.7}A${r} ${r} 0 0 1 ${31 + r * 0.25} ${72 + r * 0.7}`} fill="none" stroke="#60A5FA" strokeOpacity={0.55 - i * 0.11} strokeWidth="2.2" strokeDasharray="4 5" />
          ))}

          {/* Parcels */}
          <Parcel x={70} y={150} w={92} h={74} state="ok" />
          <Parcel x={168} y={168} w={76} h={56} state="ok" />
          <Parcel x={250} y={140} w={110} h={84} state="ok" />
          <Parcel x={96} y={92} w={70} h={54} state="ok" />
          <Parcel x={176} y={108} w={64} h={56} state="alert" />
          <Parcel x={262} y={96} w={58} h={40} state="ok" />
        </svg>
      </div>

      {/* Verification panel */}
      <div className="relative -mt-10 ml-auto w-[88%] rounded-xl border border-border bg-surface p-4 text-fg shadow-pop sm:-mt-16 sm:w-[78%]">
        <div className="flex items-center justify-between gap-2">
          <p className="inline-flex items-center gap-2 text-[13px] font-semibold">
            <RadioTower className="h-4 w-4 text-primary" aria-hidden />
            Load verification
          </p>
          <span className="tabular text-[12px] font-semibold text-fg-muted">5 of 5 expected · 1 extra</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className="h-full w-full rounded-full bg-success" />
        </div>
        <ul className="mt-3 space-y-1.5">
          {ROWS.map((r) => (
            <li
              key={r.id}
              className={
                r.ok
                  ? "flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px]"
                  : "flex items-center gap-2 rounded-lg bg-warning-soft px-2 py-1.5 text-[13px] text-warning"
              }
            >
              {r.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden /> : <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />}
              <span className="font-mono text-[12px] font-semibold">{r.id}</span>
              <span className={r.ok ? "truncate text-fg-muted" : "truncate font-semibold"}>{r.ok ? r.area : `Wrong vehicle · ${r.area}`}</span>
            </li>
          ))}
        </ul>
      </div>
      <figcaption className="mt-3 text-center text-[12px] text-slate-400">Illustrative view with example data</figcaption>
    </figure>
  );
}
