/**
 * Chart kit (Recharts) following the dataviz method:
 *  - categorical slots in fixed order, validated for CVD + contrast in both themes
 *    (light #2a78d6 #eb6834 #1baf7a on #fff; dark #3987e5 #d95926 #199e70 on #0d1628)
 *  - status colours reserved for severity, always paired with labels
 *  - thin marks (≤24px bars, 4px rounded data-end, 2px lines, ≥8px dots with surface ring)
 *  - hairline solid grid, legend for ≥2 series, tooltip on hover, table view for every chart
 */
import { useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { BarChart3, Table2 } from "lucide-react";
import { useTheme } from "../layout/ThemeToggle";
import { cn } from "@/lib/utils";
import { EmptyState } from "../ui/primitives";

export function useViz() {
  const { dark } = useTheme();
  return dark
    ? {
        series: ["#3987e5", "#d95926", "#199e70"],
        critical: "#d03b3b",
        serious: "#ec835a",
        good: "#0ca30c",
        neutral: "#6b7a90",
        grid: "#23314c",
        axis: "#a0aec4",
        surface: "#0d1628",
        target: "#cbd5e1",
      }
    : {
        series: ["#2a78d6", "#eb6834", "#1baf7a"],
        critical: "#d03b3b",
        serious: "#ec835a",
        good: "#0ca30c",
        neutral: "#94a3b8",
        grid: "#e6ebf2",
        axis: "#475569",
        surface: "#ffffff",
        target: "#0f172a",
      };
}

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
}

function VizTooltip({ active, payload, label, unit }: TooltipProps<number, string> & { unit?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] shadow-pop">
      <div className="mb-1 font-semibold text-fg">{label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2 text-fg-muted">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} aria-hidden />
          <span>{p.name}</span>
          <span className="tabular ml-auto pl-3 font-semibold text-fg">
            {typeof p.value === "number" ? Math.round(p.value * 10) / 10 : p.value}
            {unit ? ` ${unit}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ series }: { series: SeriesDef[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-fg-muted" aria-label="Legend">
      {series.map((s) => (
        <li key={s.key} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** Card wrapper: title, legend, chart/table toggle, screen-reader summary, empty state. */
export function ChartFrame({
  title,
  description,
  summary,
  series = [],
  columns,
  rows,
  empty,
  children,
  className,
  actions,
}: {
  title: string;
  description?: string;
  summary: string;
  series?: SeriesDef[];
  columns: { key: string; label: string; numeric?: boolean }[];
  rows: Record<string, string | number | null>[];
  empty?: boolean;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  const [table, setTable] = useState(false);
  return (
    <section className={cn("card flex flex-col", className)} aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {description && <p className="text-[13px] text-fg-muted">{description}</p>}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <button
            onClick={() => setTable((t) => !t)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[13px] font-semibold text-fg-muted hover:bg-surface-2 hover:text-fg"
            aria-pressed={table}
          >
            {table ? <BarChart3 className="h-4 w-4" aria-hidden /> : <Table2 className="h-4 w-4" aria-hidden />}
            {table ? "Chart" : "Table"}
          </button>
        </div>
      </div>
      <div className="px-5 pt-2">
        <Legend series={series} />
      </div>
      <p className="sr-only">{summary}</p>
      <div className="flex-1 px-2 pb-3 pt-2">
        {empty ? (
          <EmptyState icon={BarChart3} title="No data yet">
            This chart fills in as vehicles report RFID events.
          </EmptyState>
        ) : table ? (
          <div className="max-h-80 overflow-auto px-3">
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} scope="col" className={cn("border-b border-border py-2 pr-3 text-left font-semibold text-fg-muted", c.numeric && "text-right")}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {columns.map((c) => (
                      <td key={c.key} className={cn("border-b border-border py-1.5 pr-3", c.numeric && "tabular text-right")}>
                        {r[c.key] ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div aria-hidden>{children}</div>
        )}
      </div>
    </section>
  );
}

export function BarSeries({
  data,
  xKey,
  series,
  stacked,
  height = 240,
  unit,
  layout = "horizontal",
  reference,
  yDomain,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: SeriesDef[];
  stacked?: boolean;
  height?: number;
  unit?: string;
  layout?: "horizontal" | "vertical";
  reference?: { value: number; label: string };
  yDomain?: [number, number | "auto"];
}) {
  const v = useViz();
  const vertical = layout === "vertical";
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={vertical ? "vertical" : "horizontal"} margin={{ top: 8, right: 16, left: vertical ? 8 : -12, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid stroke={v.grid} strokeWidth={1} horizontal={!vertical} vertical={vertical} />
        {vertical ? (
          <>
            <XAxis type="number" tick={{ fill: v.axis, fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey={xKey} tick={{ fill: v.axis, fontSize: 12 }} axisLine={false} tickLine={false} width={130} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={{ fill: v.axis, fontSize: 12 }} axisLine={{ stroke: v.grid }} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: v.axis, fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} domain={yDomain ?? [0, "auto"]} />
          </>
        )}
        <Tooltip content={<VizTooltip unit={unit} />} cursor={{ fill: v.grid, opacity: 0.5 }} />
        {reference && (
          <ReferenceLine
            {...(vertical ? { x: reference.value } : { y: reference.value })}
            stroke={v.target}
            strokeDasharray="4 4"
            strokeWidth={1.5}
            label={{ value: reference.label, fill: v.axis, fontSize: 11, position: vertical ? "top" : "insideTopRight" }}
          />
        )}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={s.color}
            stackId={stacked ? "a" : undefined}
            maxBarSize={24}
            stroke={v.surface}
            strokeWidth={stacked ? 1 : 0}
            radius={!stacked || i === series.length - 1 ? (vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function LineSeries({
  data,
  xKey,
  series,
  height = 240,
  unit,
  references = [],
  yDomain,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: SeriesDef[];
  height?: number;
  unit?: string;
  references?: { value: number; label: string }[];
  yDomain?: [number | "auto", number | "auto"];
}) {
  const v = useViz();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 12, right: 16, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={v.grid} strokeWidth={1} vertical={false} />
        <XAxis dataKey={xKey} tick={{ fill: v.axis, fontSize: 12 }} axisLine={{ stroke: v.grid }} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fill: v.axis, fontSize: 12 }} axisLine={false} tickLine={false} domain={yDomain ?? ["auto", "auto"]} />
        <Tooltip content={<VizTooltip unit={unit} />} cursor={{ stroke: v.axis, strokeWidth: 1 }} />
        {references.map((r) => (
          <ReferenceLine
            key={r.label}
            y={r.value}
            stroke={v.target}
            strokeDasharray="4 4"
            strokeWidth={1.5}
            label={{ value: r.label, fill: v.axis, fontSize: 11, position: "insideBottomRight" }}
          />
        ))}
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            strokeLinecap="round"
            dot={{ r: 4, fill: s.color, stroke: v.surface, strokeWidth: 2 }}
            activeDot={{ r: 6, fill: s.color, stroke: v.surface, strokeWidth: 2 }}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
