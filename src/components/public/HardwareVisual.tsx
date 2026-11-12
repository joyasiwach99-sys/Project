/**
 * Concept render of the in-vehicle verification unit (from the project
 * brief): matte silver aluminium enclosure ~18 × 12 × 6 cm with tech-blue
 * accent strips, status LEDs, cooling vents and labelled ports; a slim UHF
 * antenna angled toward the parcels; white RFID labels.
 */
export function HardwareVisual() {
  return (
    <figure className="card overflow-hidden p-4 sm:p-6">
      <svg
        viewBox="0 0 560 360"
        className="h-auto w-full"
        role="img"
        aria-label="Concept drawing: a silver aluminium box with blue accent strips and three status LEDs mounted on the van wall, a slim black antenna angled toward parcels with white RFID labels"
      >
        <defs>
          <linearGradient id="hw-alu" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#F1F5F9" />
            <stop offset="0.55" stopColor="#CBD5E1" />
            <stop offset="1" stopColor="#94A3B8" />
          </linearGradient>
          <linearGradient id="hw-top" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#FFFFFF" />
            <stop offset="1" stopColor="#E2E8F0" />
          </linearGradient>
          <pattern id="hw-wall" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M24 0H0v24" fill="none" stroke="currentColor" strokeOpacity="0.07" />
          </pattern>
        </defs>

        <rect width="560" height="360" fill="url(#hw-wall)" className="text-fg" />

        {/* Enclosure (isometric-ish) */}
        <g transform="translate(70 70)">
          <path d="M0 40 L60 0 H300 L240 40 Z" fill="url(#hw-top)" stroke="#94A3B8" />
          <path d="M240 40 L300 0 V120 L240 160 Z" fill="#94A3B8" stroke="#64748B" />
          <rect x="0" y="40" width="240" height="120" rx="6" fill="url(#hw-alu)" stroke="#64748B" />
          {/* blue accent strips */}
          <rect x="0" y="52" width="240" height="5" fill="#2563EB" />
          <rect x="0" y="143" width="240" height="5" fill="#2563EB" />
          {/* vents */}
          {Array.from({ length: 7 }).map((_, i) => (
            <rect key={i} x={140 + i * 12} y="72" width="5" height="44" rx="2.5" fill="#64748B" opacity="0.55" />
          ))}
          {/* LEDs */}
          {[
            ["#22C55E", "PWR"],
            ["#3B82F6", "RFID"],
            ["#F97316", "ALERT"],
          ].map(([c, l], i) => (
            <g key={l} transform={`translate(${22 + i * 36} 82)`}>
              <circle r="7" fill={c} stroke="#fff" strokeWidth="2" />
              <text y="24" textAnchor="middle" fontSize="9" fontWeight="700" fill="#334155" fontFamily="Source Sans 3, system-ui">
                {l}
              </text>
            </g>
          ))}
          {/* ports */}
          {["USB", "ANT", "GPS", "12V"].map((p, i) => (
            <g key={p} transform={`translate(${16 + i * 30} 122)`}>
              <rect width="22" height="10" rx="2" fill="#1E293B" />
              <text x="11" y="21" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#475569" fontFamily="JetBrains Mono, monospace">
                {p}
              </text>
            </g>
          ))}
          <text x="10" y="34" fontSize="11" fontWeight="700" fill="#1E3A8A" fontFamily="Lexend, system-ui">SmartRoute Guardian</text>
        </g>

        {/* Dimension marks */}
        <g fontFamily="Source Sans 3, system-ui" fontSize="12" fontWeight="600" className="fill-fg-muted">
          <line x1="70" y1="248" x2="310" y2="248" stroke="currentColor" className="text-fg-subtle" strokeDasharray="3 3" />
          <text x="190" y="266" textAnchor="middle">≈ 18 cm</text>
          <line x1="52" y1="110" x2="52" y2="230" stroke="currentColor" className="text-fg-subtle" strokeDasharray="3 3" />
          <text x="44" y="174" textAnchor="end">12 cm</text>
          <text x="384" y="150" textAnchor="start">6 cm deep</text>
        </g>

        {/* Antenna + cable */}
        <path d="M310 150 C 360 170, 380 120, 412 96" fill="none" stroke="#0F172A" strokeWidth="3" />
        <g transform="translate(410 40) rotate(18)">
          <rect width="26" height="110" rx="5" fill="#0B1220" stroke="#475569" />
          <rect x="6" y="10" width="14" height="90" rx="3" fill="#1E293B" />
        </g>
        {[30, 52, 74].map((r, i) => (
          <path
            key={r}
            d={`M${452 + r * 0.2} ${120 - r * 0.6} A${r} ${r} 0 0 1 ${452 + r * 0.2} ${120 + r * 0.6}`}
            fill="none"
            stroke="#3B82F6"
            strokeOpacity={0.6 - i * 0.15}
            strokeWidth="2"
            strokeDasharray="4 4"
          />
        ))}

        {/* Parcels with labels */}
        {[
          [400, 250, 70, 56],
          [478, 236, 64, 70],
          [440, 196, 54, 42],
        ].map(([x, y, w, h], i) => (
          <g key={i}>
            <rect x={x} y={y} width={w} height={h} rx="4" fill="#C9A47C" stroke="#9C7A55" />
            <rect x={x! + 6} y={y! + 6} width={26} height={13} rx="2" fill="#fff" />
            <rect x={x! + 9} y={y! + 10} width={16} height={2} fill="#94A3B8" />
          </g>
        ))}
      </svg>
      <figcaption className="mt-2 text-center text-[13px] text-fg-muted">Concept design — the prototype enclosure is being built during the project.</figcaption>
    </figure>
  );
}
