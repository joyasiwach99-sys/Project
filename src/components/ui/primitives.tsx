import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Link, type LinkProps } from "react-router-dom";
import { Loader2, type LucideIcon } from "lucide-react";
import { cn, initials } from "@/lib/utils";

/* --------------------------------------------------------------- Button */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline" | "navy";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-fg hover:bg-primary/90 shadow-sm",
  navy: "bg-navy text-white hover:bg-navy-2 shadow-sm dark:bg-primary dark:text-primary-fg",
  secondary: "bg-surface-2 text-fg hover:bg-border/70",
  outline: "border border-border bg-surface text-fg hover:bg-surface-2",
  ghost: "text-fg-muted hover:bg-surface-2 hover:text-fg",
  danger: "bg-danger text-white hover:bg-danger/90 shadow-sm dark:text-bg",
};
const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-[13px] gap-1.5",
  md: "h-11 px-4 text-[14px] gap-2",
  lg: "h-12 px-6 text-[15px] gap-2",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(
    "inline-flex select-none items-center justify-center whitespace-nowrap rounded-lg font-semibold transition-colors duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
    variants[variant],
    sizes[size],
    className,
  );
}

/** A router link that looks like a button (never nest <button> inside <a>). */
export function LinkButton({
  variant = "primary",
  size = "md",
  icon: Icon,
  className,
  children,
  ...rest
}: LinkProps & { variant?: Variant; size?: Size; icon?: LucideIcon }) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden />}
      {children}
    </Link>
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: LucideIcon;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon: Icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : Icon ? (
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
      ) : null}
      {children}
    </button>
  );
});

export function IconButton({
  label,
  icon: Icon,
  className,
  ...rest
}: { label: string; icon: LucideIcon } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-10 w-10 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50",
        className,
      )}
      {...rest}
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden />
    </button>
  );
}

/* ----------------------------------------------------------------- Card */

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card", className)} {...rest} />;
}

export function CardHeader({
  title,
  description,
  actions,
  icon: Icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-6">{title}</h2>
          {description && <p className="text-[13px] text-fg-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- Badge */

export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "navy";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-fg-muted ring-border",
  primary: "bg-primary-soft text-primary ring-primary/20",
  success: "bg-success-soft text-success ring-success/20",
  warning: "bg-warning-soft text-warning ring-warning/25",
  danger: "bg-danger-soft text-danger ring-danger/25",
  navy: "bg-navy text-white ring-navy dark:bg-primary-soft dark:text-primary",
};
const dots: Record<Tone, string> = {
  neutral: "bg-fg-subtle",
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-orange",
  danger: "bg-danger",
  navy: "bg-white",
};

export function Badge({
  tone = "neutral",
  icon: Icon,
  dot,
  pulse,
  className,
  children,
}: {
  tone?: Tone;
  icon?: LucideIcon;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      {dot && (
        <span className="relative inline-flex h-1.5 w-1.5" aria-hidden>
          {pulse && <span className={cn("absolute inline-flex h-full w-full animate-pulse-ring rounded-full", dots[tone])} />}
          <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", dots[tone])} />
        </span>
      )}
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
      <span className="truncate">{children}</span>
    </span>
  );
}

/* ---------------------------------------------------------------- Forms */

export function Field({
  label,
  help,
  error,
  required,
  children,
  className,
}: {
  label: string;
  help?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const helpId = `${id}-help`;
  const errId = `${id}-err`;
  const describedBy = [help ? helpId : null, error ? errId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="label block">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden>
            *
          </span>
        )}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {help && !error && (
        <p id={helpId} className="help">
          {help}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="text-[13px] font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const control =
  "block w-full rounded-lg border border-border bg-surface px-3 text-[15px] text-fg placeholder:text-fg-subtle transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 aria-[invalid=true]:border-danger";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(control, "h-11", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(control, "min-h-[88px] py-2.5", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cn(control, "h-11 pr-8", className)} {...rest}>
      {children}
    </select>
  );
});

/* ------------------------------------------------------------- Feedback */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-2", className)} aria-hidden />;
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-fg-subtle">
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {children && <p className="mt-1 max-w-sm text-[14px] text-fg-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Progress({ value, tone = "primary", label }: { value: number; tone?: Tone; label: string }) {
  const v = Math.max(0, Math.min(100, value));
  const bar: Record<Tone, string> = {
    primary: "bg-primary",
    success: "bg-success",
    warning: "bg-orange",
    danger: "bg-danger",
    neutral: "bg-fg-subtle",
    navy: "bg-navy",
  };
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={label} aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", bar[tone])} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft font-display text-[13px] font-semibold text-primary",
        className,
      )}
      aria-hidden
    >
      {initials(name) || "?"}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">{children}</kbd>;
}

/* ------------------------------------------------------------ Segmented */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("inline-flex flex-wrap gap-1 rounded-lg bg-surface-2 p-1", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold transition-colors",
              active ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
            )}
          >
            {o.label}
            {o.count != null && (
              <span className={cn("tabular rounded-full px-1.5 text-[11px]", active ? "bg-primary-soft text-primary" : "bg-border/60")}>
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------- Page title */

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-primary">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[15px] text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- Table */

export function Table({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] border-collapse text-left text-[14px]" aria-label={label}>
        {children}
      </table>
    </div>
  );
}
export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th scope="col" className={cn("border-b border-border bg-surface-2/60 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-fg-muted", className)}>
      {children}
    </th>
  );
}
export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn("border-b border-border px-4 py-3 align-middle", className)}>
      {children}
    </td>
  );
}
