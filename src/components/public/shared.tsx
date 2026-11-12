import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/layout/Logo";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { buttonClass } from "@/components/ui/primitives";

/** Sets the browser tab title for a public page. */
export function useTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = title ? `${title} · SmartRoute Guardian` : "SmartRoute Guardian — RFID-verified last-mile logistics";
    return () => {
      document.title = prev;
    };
  }, [title]);
}

/**
 * Button-styled classes for <Link>/<a>. Delegates to the shared buttonClass;
 * adds one extra "light" variant for use on the navy hero background.
 */
export function linkButton(variant: "primary" | "outline" | "ghost" | "light" | "navy" = "primary", size: "md" | "lg" = "md") {
  if (variant === "light") return buttonClass("outline", size, "border-white/25 bg-white/10 text-white hover:bg-white/20");
  return buttonClass(variant, size);
}

/**
 * Fades content in once it scrolls into view. Renders visible immediately
 * when IntersectionObserver is unavailable or the user prefers reduced motion.
 */
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={cn("transition-[opacity,transform] duration-500 ease-out", shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0", className)}
      style={{ transitionDelay: shown ? `${delay}ms` : "0ms" }}
    >
      {children}
    </div>
  );
}

/** Compact header for secondary public pages (tracking, auth, 404). */
export function PublicHeader({ right }: { right?: ReactNode }) {
  return (
    <header className="border-b border-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link to="/" aria-label="SmartRoute Guardian home" className="rounded-lg">
          <Logo />
        </Link>
        <div className="flex items-center gap-1">
          {right}
          <ThemeToggle className="text-fg-muted hover:bg-surface-2 hover:text-fg" />
        </div>
      </div>
    </header>
  );
}

/** Section heading used across the landing page. */
export function SectionHeading({
  eyebrow,
  title,
  children,
  align = "left",
  light,
  id,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
  align?: "left" | "center";
  light?: boolean;
  id?: string;
}) {
  return (
    <div className={cn("max-w-3xl", align === "center" && "mx-auto text-center")}>
      <p className={cn("text-[12px] font-semibold uppercase tracking-[0.14em]", light ? "text-sky-300" : "text-primary")}>{eyebrow}</p>
      <h2 id={id} className={cn("mt-2 text-[28px] font-semibold leading-tight sm:text-[36px]", light && "text-white")}>
        {title}
      </h2>
      {children && <p className={cn("mt-3 text-[16px] leading-relaxed sm:text-[17px]", light ? "text-slate-300" : "text-fg-muted")}>{children}</p>}
    </div>
  );
}
