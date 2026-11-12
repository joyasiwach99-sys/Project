import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("h-8 w-8", className)} aria-hidden>
      <rect width="64" height="64" rx="14" fill="#0B1F3A" />
      <path d="M32 12l16 6v12c0 10.5-6.8 18.6-16 22-9.2-3.4-16-11.5-16-22V18l16-6z" fill="none" stroke="#60A5FA" strokeWidth="4" strokeLinejoin="round" />
      <path d="M24 33l6 6 11-12" fill="none" stroke="#FB923C" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className, light }: { className?: string; light?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="leading-tight">
        <span className={cn("block font-display text-[15px] font-semibold", light ? "text-white" : "text-fg")}>SmartRoute</span>
        <span className={cn("block text-[11px] font-semibold uppercase tracking-[0.14em]", light ? "text-sky-300" : "text-primary")}>Guardian</span>
      </span>
    </span>
  );
}
