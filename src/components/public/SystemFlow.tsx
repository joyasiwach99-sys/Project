import { Fragment } from "react";
import {
  ArrowDown,
  ArrowRight,
  Cloud,
  Cpu,
  LayoutDashboard,
  Navigation,
  ScanLine,
  Smartphone,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Node {
  icon: LucideIcon;
  step: string;
  title: string;
  plain: string;
  tech: string;
  extra?: { icon: LucideIcon; label: string };
}

const NODES: Node[] = [
  {
    icon: Tag,
    step: "1",
    title: "Tagged parcel",
    plain: "Each parcel gets a small digital sticker with its own ID.",
    tech: "UHF EPC Gen2 RFID label",
  },
  {
    icon: ScanLine,
    step: "2",
    title: "Reader in the van",
    plain: "A scanner near the cargo door checks which parcels are inside, every second.",
    tech: "CHAFON CF591 UHF reader + antenna",
  },
  {
    icon: Cpu,
    step: "3",
    title: "Onboard computer",
    plain: "Compares what it sees with the delivery list and the van’s location.",
    tech: "Raspberry Pi 4 gateway",
    extra: { icon: Navigation, label: "+ GPS module" },
  },
  {
    icon: Cloud,
    step: "4",
    title: "Secure cloud",
    plain: "Stores every load, drop-off and alert with a timestamp.",
    tech: "Firebase Firestore",
  },
];

const OUTPUTS: { icon: LucideIcon; title: string; plain: string }[] = [
  { icon: LayoutDashboard, title: "Admin dashboard", plain: "Fleet map, alerts, audit trail" },
  { icon: Smartphone, title: "Driver app", plain: "Verify load, confirm delivery" },
];

function Arrow() {
  return (
    <div className="flex items-center justify-center text-primary" aria-hidden>
      <ArrowDown className="h-5 w-5 lg:hidden" />
      <ArrowRight className="hidden h-5 w-5 lg:block" />
    </div>
  );
}

/**
 * The system diagram from the project brief, drawn so a non-technical
 * reader can follow it: parcel → reader → Raspberry Pi → cloud → screens.
 */
export function SystemFlow() {
  return (
    <ol
      className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1.1fr] lg:items-stretch lg:gap-2"
      aria-label="How data flows through SmartRoute Guardian"
    >
      {NODES.map((n) => (
        <Fragment key={n.title}>
          <li className="card flex flex-col p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-navy text-white dark:bg-primary-soft dark:text-primary">
                <n.icon className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">Step {n.step}</p>
                <h3 className="text-[15px] font-semibold leading-tight">{n.title}</h3>
              </div>
            </div>
            <p className="mt-3 flex-1 text-[14px] leading-snug text-fg-muted">{n.plain}</p>
            <p className="mt-3 rounded-md bg-surface-2 px-2 py-1 font-mono text-[11.5px] text-fg-muted">{n.tech}</p>
            {n.extra && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary">
                <n.extra.icon className="h-3.5 w-3.5" aria-hidden />
                {n.extra.label}
              </p>
            )}
          </li>
          <li aria-hidden className="list-none">
            <Arrow />
          </li>
        </Fragment>
      ))}
      <li className="flex flex-col gap-3">
        <p className="sr-only">Step 5: people see the results</p>
        {OUTPUTS.map((o, i) => (
          <div key={o.title} className={cn("card flex flex-1 items-center gap-3 p-4", i === 0 && "lg:mt-0")}>
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <o.icon className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold leading-tight">{o.title}</h3>
              <p className="text-[13px] text-fg-muted">{o.plain}</p>
            </div>
          </div>
        ))}
      </li>
    </ol>
  );
}
