/**
 * Shared chart conventions (see docs/ARCHITECTURE.md §UI and the data-viz rules):
 * fixed categorical slot order, 2px lines, ≤24px bars with 4px rounded data-ends, hairline solid grid,
 * text in ink tokens (never series colours), legends for ≥2 series, tooltips on hover and a table view.
 */
import { ChartColumn, Table2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { niceTicks } from "@/lib/axis";
import { cn } from "@/lib/utils";

/** Categorical slots in fixed order (validated palette; colour follows the entity, never its rank). */
export const SERIES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

/** Sequential single-hue ramp (blue), light → dark, for heatmaps. */
export const BLUE_RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"];

export const axisTick = { fill: "var(--chart-axis)", fontSize: 11 };

export const xAxisProps = {
  tickLine: false,
  axisLine: { stroke: "var(--chart-grid)" },
  tick: axisTick,
  tickMargin: 8,
  minTickGap: 12,
} as const;

export const yAxisProps = {
  tickLine: false,
  axisLine: false,
  tick: axisTick,
  width: 64,
} as const;

/**
 * Round ticks for a zero-based value axis (0 / 100K / … / 500K for a 455K peak), spread after `yAxisProps`:
 * `<YAxis {...yAxisProps} {...niceAxis(maxOf(rows, "amount"))} />`.
 */
export function niceAxis(max: number, options?: { count?: number; integer?: boolean }) {
  const ticks = niceTicks(max, options);
  return { ticks, domain: [0, ticks[ticks.length - 1]] as [number, number], interval: 0 as const };
}

export const gridProps = {
  vertical: false,
  stroke: "var(--chart-grid)",
  strokeDasharray: undefined,
} as const;

/** Bar data-end: 4px rounded top, square at the baseline. */
export const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];
export const BAR_RADIUS_H: [number, number, number, number] = [0, 4, 4, 0];
export const BAR_MAX = 24;

interface TooltipEntry {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

/** Card-style tooltip. `format` renders values; `labelFormat` renders the heading. */
export function ChartTooltip({
  active,
  payload,
  label,
  format = (v) => String(v),
  labelFormat,
  footer,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  format?: (value: number, entry: TooltipEntry) => string;
  labelFormat?: (label: string | number | undefined, payload?: TooltipEntry[]) => ReactNode;
  footer?: (payload: TooltipEntry[]) => ReactNode;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-40 rounded-lg border bg-popover px-3 py-2 text-popover-foreground text-xs shadow-lg">
      <div className="mb-1.5 font-medium">{labelFormat ? labelFormat(label, payload) : label}</div>
      <div className="flex flex-col gap-1">
        {payload.map((p) => (
          <div key={String(p.dataKey ?? p.name)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="inline-block size-2.5 rounded-sm" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="font-medium tabular">
              {typeof p.value === "number" ? format(p.value, p) : p.value}
            </span>
          </div>
        ))}
      </div>
      {footer && <div className="mt-1.5 border-t pt-1.5">{footer(payload)}</div>}
    </div>
  );
}

export function ChartLegend({
  items,
  className,
}: {
  items: { label: string; color: string; shape?: "box" | "line" }[];
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-xs", className)}
    >
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.shape === "line" ? (
            <span className="inline-block h-0.5 w-4 rounded-full" style={{ background: i.color }} />
          ) : (
            <span className="inline-block size-2.5 rounded-sm" style={{ background: i.color }} />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Card wrapper with a chart ⇄ table toggle (every chart has an accessible table twin). */
export function ChartCard({
  title,
  description,
  legend,
  actions,
  table,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  description?: ReactNode;
  legend?: ReactNode;
  actions?: ReactNode;
  table?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        <div className="flex items-center gap-1">
          {actions}
          {table && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setAsTable((t) => !t)}
              aria-label={asTable ? "Show chart" : "Show as table"}
              title={asTable ? "Show chart" : "Show as table"}
            >
              {asTable ? <ChartColumn /> : <Table2 />}
            </Button>
          )}
        </div>
      </CardHeader>
      {legend && !asTable && <div className="px-5 pb-2">{legend}</div>}
      <div className={cn("flex-1 px-3 pb-4", bodyClassName)}>
        {asTable && table ? <div className="max-h-80 overflow-auto px-2">{table}</div> : children}
      </div>
    </Card>
  );
}

/** Minimal table used as the chart's table view. */
export function DataTable({ columns, rows }: { columns: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-muted-foreground text-xs">
          {columns.map((c, i) => (
            <th key={c} className={cn("py-2 pr-3 font-medium", i > 0 && "text-right")}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className="border-b last:border-0">
            {r.map((cell, ci) => (
              <td key={ci} className={cn("py-1.5 pr-3", ci > 0 && "text-right tabular")}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
