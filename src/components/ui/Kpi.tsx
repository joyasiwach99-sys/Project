import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "./primitives";

type KpiTone = "neutral" | "success" | "warning" | "danger" | "primary";

/**
 * KPI tile: label, big tabular value, optional unit, context line and
 * target state. Status is conveyed by text + icon, not colour alone.
 */
export function Kpi({
  label,
  value,
  unit,
  icon: Icon,
  hint,
  tone = "neutral",
  loading,
  footer,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  icon: LucideIcon;
  hint?: ReactNode;
  tone?: KpiTone;
  loading?: boolean;
  footer?: ReactNode;
}) {
  const toneCls: Record<KpiTone, string> = {
    neutral: "bg-surface-2 text-fg-muted",
    primary: "bg-primary-soft text-primary",
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
  };
  return (
    <div className="card flex flex-col p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-semibold text-fg-muted">{label}</p>
        <span className={cn("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", toneCls[tone])}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-20" />
      ) : (
        <p className="mt-1 font-display text-[28px] font-semibold leading-tight tabular">
          {value}
          {unit && <span className="ml-1 text-[15px] font-medium text-fg-muted">{unit}</span>}
        </p>
      )}
      {hint && <p className="mt-1 text-[13px] text-fg-muted">{hint}</p>}
      {footer && <div className="mt-3">{footer}</div>}
    </div>
  );
}
