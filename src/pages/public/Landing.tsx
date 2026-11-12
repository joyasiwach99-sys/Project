import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Ban,
  BarChart3,
  Bell,
  CircuitBoard,
  ClipboardCheck,
  Cpu,
  ExternalLink,
  Layers,
  Map,
  Menu,
  Navigation,
  PackageCheck,
  PackageOpen,
  PackageSearch,
  Play,
  Radio,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Tag,
  Target,
  Timer,
  Truck,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { HeroVisual } from "@/components/public/HeroVisual";
import { HardwareVisual } from "@/components/public/HardwareVisual";
import { SystemFlow } from "@/components/public/SystemFlow";
import { Reveal, SectionHeading, linkButton, useTitle } from "@/components/public/shared";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ data */

const NAV_LINKS = [
  { href: "#problem", label: "Problem" },
  { href: "#how", label: "How it works" },
  { href: "#hardware", label: "Hardware" },
  { href: "#dashboards", label: "Dashboards" },
  { href: "#roadmap", label: "Roadmap" },
];

const STATS = [
  {
    value: "23.1B",
    label: "U.S. parcels shipped in 2025",
    detail: "Up 3.3% year-over-year — parcel networks keep scaling.",
    source: "Pitney Bowes Parcel Shipping Index",
    href: "https://www.pitneybowes.com/us/shipping-index.html",
  },
  {
    value: "58M+",
    label: "Packages stolen in the U.S. in 2024",
    detail: "Lost parcels cost money and erode customer trust in delivery providers.",
    source: "USPS Office of Inspector General",
    href: "https://www.uspsoig.gov/",
  },
  {
    value: "US$100B",
    label: "India’s D2C market expected in 2025",
    detail: "With overall e-commerce growth projected at 17–22% in 2025.",
    source: "India Brand Equity Foundation (IBEF)",
    href: "https://www.ibef.org/industry/ecommerce",
  },
];

const ALERTS: { icon: LucideIcon; title: string; plain: string; tone: "danger" | "warning" }[] = [
  {
    icon: PackageOpen,
    title: "Missing parcel",
    plain: "A parcel on today’s list isn’t in the van when the driver checks the load.",
    tone: "danger",
  },
  {
    icon: ShieldAlert,
    title: "Unauthorized removal",
    plain: "A parcel leaves the van somewhere that isn’t its delivery stop.",
    tone: "danger",
  },
  {
    icon: Truck,
    title: "Wrong vehicle",
    plain: "A parcel meant for another van was loaded into this one.",
    tone: "warning",
  },
  {
    icon: Ban,
    title: "Delivery mismatch",
    plain: "The driver marks a parcel delivered, but the scanner still sees it inside — or it was dropped at the wrong address.",
    tone: "warning",
  },
];

const JOURNEY: { icon: LucideIcon; title: string; plain: string }[] = [
  { icon: Play, title: "Start Route", plain: "See today’s stops and parcels to load." },
  { icon: ClipboardCheck, title: "Verify Load", plain: "RFID confirms every parcel is on board — no manual ticking." },
  { icon: Navigation, title: "Drive Route", plain: "GPS links every event to a location." },
  { icon: PackageCheck, title: "Confirm Delivery", plain: "Hand-over is checked by both RFID and the driver." },
  { icon: ShieldCheck, title: "Resolve Alert", plain: "Any exception is explained and logged for the audit trail." },
];

const COMPONENTS: { icon: LucideIcon; name: string; role: string }[] = [
  { icon: Cpu, name: "Raspberry Pi 4", role: "Onboard computer running the verification engine" },
  { icon: Radio, name: "CHAFON CF591 UHF reader", role: "Reads every tagged parcel in the cargo area" },
  { icon: Zap, name: "Slim UHF antenna", role: "Mounted near the cargo opening, angled at the parcels" },
  { icon: Tag, name: "EPC Gen2 RFID labels", role: "Small white stickers — one unique ID per parcel" },
  { icon: Navigation, name: "GPS module", role: "Near the windshield; ties events to a location" },
  { icon: CircuitBoard, name: "Power module", role: "Vehicle 12 V stepped down safely for the electronics" },
];

const DASHBOARDS: { icon: LucideIcon; title: string; plain: string; to: string }[] = [
  { icon: Map, title: "Fleet map", plain: "Live van locations with green, amber and red status.", to: "/login" },
  { icon: Truck, title: "Vehicle detail", plain: "Exactly which parcels are inside each vehicle right now.", to: "/login" },
  { icon: Bell, title: "Exception alerts", plain: "Missing, removed, wrong-vehicle and mismatch alerts to resolve.", to: "/login" },
  { icon: ScrollText, title: "Audit trail", plain: "Timestamped loading, unloading and delivery history.", to: "/login" },
  { icon: BarChart3, title: "Analytics", plain: "Detection rates, alert latency and delivery trends.", to: "/login" },
  { icon: ClipboardCheck, title: "Pilot report", plain: "Field-test results measured against the pilot targets.", to: "/login" },
  { icon: Smartphone, title: "Driver app", plain: "Mobile flow from loading to hand-over.", to: "/login" },
  { icon: PackageSearch, title: "Customer tracking", plain: "A public page customers use with their tracking ID.", to: "/track" },
];

const MARKET: { name: string; limitation: string; difference: string }[] = [
  {
    name: "Zebra MotionWorks Enterprise",
    limitation: "Strong enterprise platform for sensors, tags, mapping and reports — but designed for larger organizations with complex installations.",
    difference: "A smaller, lower-cost vehicle prototype on Raspberry Pi with a focused dashboard, easy to test with small fleets.",
  },
  {
    name: "FedEx SenseAware",
    limitation: "Rich real-time shipment data (location, temperature, shock), but tied to FedEx’s ecosystem and higher-value shipments.",
    difference: "Carrier-independent, built for parcel presence verification inside ordinary delivery vehicles.",
  },
  {
    name: "Impinj RAIN RFID platform",
    limitation: "A powerful RFID ecosystem, but often requires partners, integrations and enterprise deployment planning.",
    difference: "Narrows the scope to one buildable workflow: loading, unloading, missing-parcel detection and audit history.",
  },
  {
    name: "AfterShip Tracking",
    limitation: "Tracks parcels across carriers using tracking numbers, but depends on carrier scan events — it can’t see inside a vehicle.",
    difference: "Generates its own in-vehicle verification events instead of waiting for third-party carrier updates.",
  },
  {
    name: "UPS RFID rollout",
    limitation: "RFID across U.S. delivery vehicles and facilities, backed by more than US$100 million of investment.",
    difference: "Brings the same industry direction to a prototype that smaller operators — without a UPS-scale budget — can adopt.",
  },
];

const TARGETS: { icon: LucideIcon; value: string; label: string }[] = [
  { icon: Target, value: "≥ 95%", label: "Parcel detection in static tests" },
  { icon: Layers, value: "≥ 90%", label: "Detection in realistic loading tests" },
  { icon: Timer, value: "< 10 s", label: "From a parcel leaving to the alert appearing" },
  { icon: PackageCheck, value: "30–50", label: "Tagged parcels tested in the pilot" },
];

const ROADMAP: { month: string; title: string; focus: string; weeks: string[] }[] = [
  {
    month: "Month 1",
    title: "Planning + hardware setup",
    focus: "Define the parcel workflow; assemble the Raspberry Pi, RFID reader, GPS module and database structure.",
    weeks: ["Finalize system architecture", "Connect RFID reader", "Connect GPS", "Check-in and pilot outreach"],
  },
  {
    month: "Month 2",
    title: "Core build",
    focus: "Parcel scanning, database sync and the admin dashboard.",
    weeks: ["EPC tag reading", "Parcel status logic", "Firebase integration", "Wrong / missing parcel alert demo"],
  },
  {
    month: "Month 3",
    title: "Testing + driver interface",
    focus: "Driver workflow, tested in realistic loading and unloading scenarios.",
    weeks: ["Mobile driver screen", "School / community test", "Vehicle / cargo test", "Accuracy review"],
  },
  {
    month: "Month 4",
    title: "Validation + documentation",
    focus: "Pilot report, visuals, demo video and competition-ready materials.",
    weeks: ["Refine dashboard", "Collect pilot data", "Demo video and pitch deck", "Final presentation and partner testimonial"],
  },
];

/* ------------------------------------------------------------- sections */

function TopNav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b transition-colors duration-200",
        scrolled || open ? "border-border bg-surface/95 backdrop-blur" : "border-transparent bg-surface/80 backdrop-blur",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link to="/" aria-label="SmartRoute Guardian home" className="rounded-lg">
          <Logo />
        </Link>
        <nav aria-label="Sections" className="ml-4 hidden flex-1 items-center gap-1 lg:flex">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} className="rounded-lg px-3 py-2 text-[14px] font-medium text-fg-muted hover:bg-surface-2 hover:text-fg">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <Link to="/track" className="hidden rounded-lg px-3 py-2 text-[14px] font-medium text-fg-muted hover:bg-surface-2 hover:text-fg md:inline-flex">
            Track a parcel
          </Link>
          <Link to="/login" className="hidden rounded-lg px-3 py-2 text-[14px] font-medium text-fg-muted hover:bg-surface-2 hover:text-fg md:inline-flex">
            Sign in
          </Link>
          <ThemeToggle className="text-fg-muted hover:bg-surface-2 hover:text-fg" />
          <Link to="/login" className={cn(linkButton("primary"), "hidden sm:inline-flex")}>
            Explore live demo
          </Link>
          <button
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
          </button>
        </div>
      </div>
      {open && (
        <nav id="mobile-menu" aria-label="Menu" className="border-t border-border bg-surface px-4 pb-4 pt-2 lg:hidden">
          <ul className="grid gap-1">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} onClick={() => setOpen(false)} className="flex h-11 items-center rounded-lg px-3 text-[15px] font-medium text-fg hover:bg-surface-2">
                  {l.label}
                </a>
              </li>
            ))}
            <li>
              <Link to="/track" className="flex h-11 items-center rounded-lg px-3 text-[15px] font-medium text-fg hover:bg-surface-2">
                Track a parcel
              </Link>
            </li>
            <li>
              <Link to="/login" className="flex h-11 items-center rounded-lg px-3 text-[15px] font-medium text-fg hover:bg-surface-2">
                Sign in
              </Link>
            </li>
          </ul>
          <Link to="/login" className={cn(linkButton("primary"), "mt-3 w-full")}>
            Explore live demo
          </Link>
        </nav>
      )}
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden bg-navy text-white" aria-labelledby="hero-title">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
        aria-hidden
      />
      <div className="pointer-events-none absolute -right-40 -top-40 h-[480px] w-[480px] rounded-full bg-blue-500/20 blur-3xl" aria-hidden />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[1.05fr_1fr] lg:py-24">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-sky-200">
            <Radio className="h-3.5 w-3.5" aria-hidden />
            RFID-verified last-mile logistics
          </p>
          <h1 id="hero-title" className="mt-5 text-[36px] font-semibold leading-[1.1] text-white sm:text-[48px] lg:text-[54px]">
            The right parcels, in the right vehicle, at the right time.
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-slate-300 sm:text-[18px]">
            SmartRoute Guardian is a low-cost, retrofit-friendly verification layer for small and medium delivery fleets. A scanner inside the van
            continuously checks which RFID-tagged parcels are on board — and alerts the team the moment one is missing, in the wrong vehicle, or
            removed where it shouldn’t be.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/login" className={linkButton("primary", "lg")}>
              Explore the live demo
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <a href="#how" className={linkButton("light", "lg")}>
              See how it works
            </a>
          </div>
          <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4 border-t border-white/10 pt-6">
            {[
              ["Raspberry Pi 4", "Edge computer"],
              ["UHF RFID", "Reads through boxes"],
              ["Firebase", "Live cloud sync"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[12px] text-slate-400">{v}</dt>
                <dd className="mt-0.5 text-[14px] font-semibold text-white">{k}</dd>
              </div>
            ))}
          </dl>
        </div>
        <HeroVisual />
      </div>
    </section>
  );
}

function Problem() {
  return (
    <section id="problem" className="scroll-mt-20 bg-bg py-16 sm:py-24" aria-labelledby="problem-title">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal>
          <SectionHeading id="problem-title" eyebrow="The problem" title="Parcel volumes are soaring. Smaller fleets still rely on memory and clipboards.">
            Many small and medium delivery operators depend on manual barcode scans, handwritten loading checks and driver memory. Large carriers are
            only now rolling out automated, in-vehicle visibility — at a scale smaller fleets can’t afford.
          </SectionHeading>
        </Reveal>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {STATS.map((s, i) => (
            <Reveal key={s.value} delay={i * 60}>
              <article className="card flex h-full flex-col p-6">
                <p className="font-display text-[40px] font-semibold leading-none text-fg tabular">{s.value}</p>
                <h3 className="mt-3 text-[16px] font-semibold">{s.label}</h3>
                <p className="mt-1.5 flex-1 text-[14px] text-fg-muted">{s.detail}</p>
                <a
                  href={s.href}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary hover:underline"
                >
                  Source: {s.source}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </article>
            </Reveal>
          ))}
        </div>
        <Reveal className="mt-6">
          <div className="grid gap-4 rounded-2xl border border-border bg-surface p-6 sm:grid-cols-3">
            {[
              ["Manual checks are slow", "Ticking parcels off a list at every load adds minutes per vehicle, every shift."],
              ["Mistakes surface late", "A parcel in the wrong van is usually discovered only when a customer complains."],
              ["No evidence trail", "Without timestamps, it’s hard to tell where and when a parcel went missing."],
            ].map(([t, d]) => (
              <div key={t}>
                <h3 className="text-[15px] font-semibold">{t}</h3>
                <p className="mt-1 text-[14px] text-fg-muted">{d}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-20 border-y border-border bg-surface py-16 sm:py-24" aria-labelledby="how-title">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal>
          <SectionHeading id="how-title" eyebrow="How it works" title="Each parcel gets a digital label. The van checks itself.">
            A scanner inside the vehicle continuously checks which parcels are present. If a parcel is missing, placed in the wrong vehicle or removed
            unexpectedly, the system records the event and alerts the dashboard.
          </SectionHeading>
        </Reveal>
        <Reveal className="mt-10">
          <SystemFlow />
        </Reveal>

        <div className="mt-14">
          <Reveal>
            <h3 className="text-[20px] font-semibold">Four things it catches automatically</h3>
          </Reveal>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {ALERTS.map((a, i) => (
              <Reveal key={a.title} delay={i * 50}>
                <article
                  className={cn(
                    "card flex h-full gap-4 border-l-4 p-5",
                    a.tone === "danger" ? "border-l-danger" : "border-l-orange",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                      a.tone === "danger" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning",
                    )}
                  >
                    <a.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div>
                    <h4 className="font-display text-[16px] font-semibold">{a.title}</h4>
                    <p className="mt-1 text-[14px] text-fg-muted">{a.plain}</p>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </div>

        <div className="mt-14">
          <Reveal>
            <h3 className="text-[20px] font-semibold">The driver’s day, in five steps</h3>
          </Reveal>
          <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Driver journey">
            {JOURNEY.map((j, i) => (
              <Reveal key={j.title} delay={i * 50}>
                <li className="card relative h-full p-4">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy font-display text-[14px] font-semibold text-white dark:bg-primary dark:text-primary-fg">
                      {i + 1}
                    </span>
                    <j.icon className="h-5 w-5 text-primary" aria-hidden />
                  </div>
                  <h4 className="mt-3 text-[15px] font-semibold">{j.title}</h4>
                  <p className="mt-1 text-[14px] text-fg-muted">{j.plain}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function Hardware() {
  return (
    <section id="hardware" className="scroll-mt-20 bg-bg py-16 sm:py-24" aria-labelledby="hardware-title">
      <div className="mx-auto grid max-w-6xl items-start gap-10 px-4 sm:px-6 lg:grid-cols-2">
        <div>
          <Reveal>
            <SectionHeading id="hardware-title" eyebrow="Hardware" title="A compact unit that retrofits into an ordinary van.">
              A matte silver aluminium enclosure (about 18 × 12 × 6 cm) with tech-blue accents, status LEDs, cooling vents and labelled ports holds the
              Raspberry Pi and power module. A slim UHF antenna near the cargo opening is angled toward the stacked parcels.
            </SectionHeading>
          </Reveal>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {COMPONENTS.map((c, i) => (
              <Reveal key={c.name} delay={i * 40}>
                <li className="flex h-full gap-3 rounded-xl border border-border bg-surface p-4">
                  <c.icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                  <div>
                    <p className="text-[14px] font-semibold">{c.name}</p>
                    <p className="text-[13px] text-fg-muted">{c.role}</p>
                  </div>
                </li>
              </Reveal>
            ))}
          </ul>
        </div>
        <Reveal>
          <HardwareVisual />
        </Reveal>
      </div>
    </section>
  );
}

function Dashboards() {
  return (
    <section id="dashboards" className="scroll-mt-20 border-y border-border bg-surface py-16 sm:py-24" aria-labelledby="dash-title">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal>
          <SectionHeading id="dash-title" eyebrow="Software" title="Dashboards for every person in the chain.">
            Operations managers, drivers and customers each get a screen designed for what they need to do — all synced live through Firebase.
          </SectionHeading>
        </Reveal>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {DASHBOARDS.map((d, i) => (
            <Reveal key={d.title} delay={(i % 4) * 50}>
              <li className="h-full">
                <Link
                  to={d.to}
                  className="card group flex h-full flex-col p-5 transition-shadow duration-200 hover:shadow-pop focus-visible:shadow-pop"
                >
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
                    <d.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <h3 className="mt-4 text-[16px] font-semibold">{d.title}</h3>
                  <p className="mt-1 flex-1 text-[14px] text-fg-muted">{d.plain}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-[13px] font-semibold text-primary">
                    {d.to === "/track" ? "Track a parcel" : "Open in demo"}
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </Link>
              </li>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Market() {
  return (
    <section id="market" className="scroll-mt-20 bg-bg py-16 sm:py-24" aria-labelledby="market-title">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal>
          <SectionHeading id="market-title" eyebrow="Market" title="Enterprise-grade visibility, scaled down for smaller operators.">
            Existing platforms are powerful but built for large organizations or a single carrier’s network. SmartRoute Guardian focuses on one
            practical workflow that a small fleet can actually adopt.
          </SectionHeading>
        </Reveal>

        {/* Desktop table */}
        <Reveal className="mt-10 hidden md:block">
          <div className="card overflow-hidden">
            <table className="w-full border-collapse text-left text-[14px]">
              <caption className="sr-only">Comparison of existing solutions with SmartRoute Guardian</caption>
              <thead>
                <tr className="bg-surface-2/70">
                  <th scope="col" className="w-[22%] px-5 py-3 text-[12px] font-semibold uppercase tracking-wide text-fg-muted">Existing solution</th>
                  <th scope="col" className="px-5 py-3 text-[12px] font-semibold uppercase tracking-wide text-fg-muted">Key limitation</th>
                  <th scope="col" className="px-5 py-3 text-[12px] font-semibold uppercase tracking-wide text-primary">How SmartRoute Guardian differs</th>
                </tr>
              </thead>
              <tbody>
                {MARKET.map((m) => (
                  <tr key={m.name} className="border-t border-border align-top">
                    <th scope="row" className="px-5 py-4 font-display text-[15px] font-semibold">{m.name}</th>
                    <td className="px-5 py-4 text-fg-muted">{m.limitation}</td>
                    <td className="bg-primary-soft/40 px-5 py-4 text-fg">{m.difference}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>

        {/* Mobile cards */}
        <ul className="mt-8 grid gap-4 md:hidden">
          {MARKET.map((m) => (
            <li key={m.name} className="card p-5">
              <h3 className="text-[16px] font-semibold">{m.name}</h3>
              <p className="mt-3 text-[12px] font-semibold uppercase tracking-wide text-fg-subtle">Key limitation</p>
              <p className="mt-1 text-[14px] text-fg-muted">{m.limitation}</p>
              <p className="mt-3 text-[12px] font-semibold uppercase tracking-wide text-primary">How SmartRoute differs</p>
              <p className="mt-1 text-[14px]">{m.difference}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function PilotTargets() {
  return (
    <section id="pilot" className="scroll-mt-20 bg-navy py-16 text-white sm:py-24" aria-labelledby="pilot-title">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal>
          <SectionHeading id="pilot-title" eyebrow="Pilot targets" title="What the field pilot has to prove." light>
            The prototype will be tested with a real vehicle (or vehicle-like cargo setup) and 30–50 tagged parcels, comparing RFID verification with
            manual loading checks. These are the goals the pilot is measured against — not results.
          </SectionHeading>
        </Reveal>
        <dl className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TARGETS.map((t, i) => (
            <Reveal key={t.label} delay={i * 50}>
              <div className="h-full rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                <t.icon className="h-5 w-5 text-sky-300" aria-hidden />
                <dt className="mt-4 text-[14px] text-slate-300">{t.label}</dt>
                <dd className="mt-1 font-display text-[34px] font-semibold leading-none text-white tabular">{t.value}</dd>
                <p className="mt-3 inline-flex rounded-full border border-white/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-300">Target</p>
              </div>
            </Reveal>
          ))}
        </dl>
        <p className="mt-6 text-[14px] text-slate-400">
          Pilot results will be published in the live Pilot report once field testing is complete.
        </p>
      </div>
    </section>
  );
}

function Roadmap() {
  return (
    <section id="roadmap" className="scroll-mt-20 bg-surface py-16 sm:py-24" aria-labelledby="roadmap-title">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal>
          <SectionHeading id="roadmap-title" eyebrow="Roadmap" title="Four months from idea to field-validated prototype." />
        </Reveal>
        <ol className="relative mt-10 grid gap-6 lg:grid-cols-4">
          <div className="absolute left-[19px] top-2 bottom-2 w-px bg-border lg:left-0 lg:right-0 lg:top-[19px] lg:bottom-auto lg:h-px lg:w-auto" aria-hidden />
          {ROADMAP.map((r, i) => (
            <Reveal key={r.month} delay={i * 60}>
              <li className="relative pl-14 lg:pl-0 lg:pt-14">
                <span className="absolute left-0 top-0 inline-flex h-10 w-10 items-center justify-center rounded-full border-4 border-surface bg-navy font-display text-[14px] font-semibold text-white dark:bg-primary dark:text-primary-fg">
                  {i + 1}
                </span>
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-primary">{r.month}</p>
                <h3 className="mt-1 text-[17px] font-semibold">{r.title}</h3>
                <p className="mt-1.5 text-[14px] text-fg-muted">{r.focus}</p>
                <ul className="mt-3 space-y-1.5">
                  {r.weeks.map((w, wi) => (
                    <li key={w} className="flex gap-2 text-[13px]">
                      <span className="tabular w-14 shrink-0 font-semibold text-fg-subtle">Week {i * 4 + wi + 1}</span>
                      <span className="text-fg-muted">{w}</span>
                    </li>
                  ))}
                </ul>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

function About() {
  return (
    <section id="about" className="scroll-mt-20 border-t border-border bg-bg py-16 sm:py-24" aria-labelledby="about-title">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1.2fr_1fr]">
        <Reveal>
          <SectionHeading id="about-title" eyebrow="About the project" title="Built by Joya Siwach.">
            SmartRoute Guardian is a student-built project by Joya Siwach that brings together hardware integration, Python on a Raspberry Pi, a cloud
            database, GPS tracking and web dashboards — aimed at a problem real delivery businesses face every day.
          </SectionHeading>
          <p className="mt-4 max-w-3xl text-[16px] text-fg-muted">
            The goal is to move from idea to prototype to field validation: a working unit in a test vehicle, a small pilot with a local courier, school or
            community logistics team, and a documented report of what worked.
          </p>
        </Reveal>
        <Reveal>
          <div className="card p-6">
            <h3 className="text-[16px] font-semibold">Interested in piloting it?</h3>
            <p className="mt-1.5 text-[14px] text-fg-muted">
              The pilot needs one vehicle and 30–50 parcels for a simple before/after comparison of loading accuracy. Explore the live demo to see the
              dashboards, or track a demo parcel.
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <Link to="/login" className={linkButton("primary")}>
                Explore the live demo
              </Link>
              <Link to="/track" className={linkButton("outline")}>
                Track a parcel
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function CtaBand() {
  return (
    <section className="bg-primary py-12 text-primary-fg" aria-labelledby="cta-title">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 sm:px-6 md:flex-row md:items-center">
        <div>
          <h2 id="cta-title" className="text-[24px] font-semibold text-primary-fg sm:text-[28px]">
            See every parcel, every vehicle, every hand-over.
          </h2>
          <p className="mt-1 text-[16px] opacity-90">Sign in as a read-only reviewer — no account needed.</p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Link
            to="/login"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-white px-6 text-[15px] font-semibold text-navy shadow-sm transition-colors hover:bg-slate-100 dark:bg-navy dark:text-white dark:hover:bg-navy-2"
          >
            Explore the live demo
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link
            to="/track"
            className="inline-flex h-12 items-center justify-center rounded-lg border border-current px-6 text-[15px] font-semibold opacity-95 transition-opacity hover:opacity-100"
          >
            Track a parcel
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-navy text-slate-300">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <Logo light />
          <p className="mt-4 max-w-sm text-[14px] text-slate-400">
            RFID-verified last-mile logistics intelligence for small and medium delivery fleets. A student project by Joya Siwach.
          </p>
        </div>
        <nav aria-label="Project">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-white">Project</h2>
          <ul className="mt-3 space-y-1">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="inline-flex min-h-[32px] items-center text-[14px] hover:text-white">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Product">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-white">Product</h2>
          <ul className="mt-3 space-y-1">
            {[
              ["/login", "Live demo"],
              ["/track", "Track a parcel"],
              ["/login", "Sign in"],
              ["/signup", "Request access"],
            ].map(([to, label]) => (
              <li key={label}>
                <Link to={to!} className="inline-flex min-h-[32px] items-center text-[14px] hover:text-white">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-6xl px-4 py-5 text-[13px] text-slate-400 sm:px-6">
          © {new Date().getFullYear()} SmartRoute Guardian · Statistics cited from their linked sources.
        </p>
      </div>
    </footer>
  );
}

export default function Landing() {
  useTitle("");
  return (
    <div className="min-h-dvh bg-bg">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <TopNav />
      <main id="main">
        <Hero />
        <Problem />
        <HowItWorks />
        <Hardware />
        <Dashboards />
        <Market />
        <PilotTargets />
        <Roadmap />
        <About />
        <CtaBand />
      </main>
      <Footer />
    </div>
  );
}
