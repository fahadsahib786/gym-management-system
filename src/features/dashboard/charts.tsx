import { format } from "date-fns";
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DayPoint, HeatCell, MonthPoint, NameCount } from "@/api/bindings";
import {
  BAR_MAX,
  BAR_RADIUS,
  BLUE_RAMP,
  ChartTooltip,
  gridProps,
  niceAxis,
  SERIES,
  xAxisProps,
  yAxisProps,
} from "@/components/charts/kit";
import { maxOf } from "@/lib/axis";
import { compact, money, moneyCompact, num, parseDate, percent } from "@/lib/format";
import { cn } from "@/lib/utils";

const noAnim = { isAnimationActive: false } as const;
const cursor = { fill: "color-mix(in oklab, var(--muted-foreground) 8%, transparent)" };

export function RevenueChart({ months, showExpenses }: { months: MonthPoint[]; showExpenses: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart
        data={months}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        barGap={2}
        barCategoryGap="22%"
      >
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="label" {...xAxisProps} />
        <YAxis
          {...yAxisProps}
          {...niceAxis(showExpenses ? maxOf(months, "collected", "expenses") : maxOf(months, "collected"))}
          tickFormatter={(v: number) => moneyCompact(v)}
        />
        <Tooltip
          cursor={cursor}
          content={
            <ChartTooltip
              format={(v) => money(v)}
              footer={
                showExpenses
                  ? (p) => {
                      const row = p[0]?.payload as MonthPoint | undefined;
                      return row ? (
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">Profit</span>
                          <span className={cn("font-semibold tabular", row.profit < 0 && "text-danger-ink")}>
                            {money(row.profit)}
                          </span>
                        </div>
                      ) : null;
                    }
                  : undefined
              }
            />
          }
        />
        <Bar
          dataKey="collected"
          name="Collected"
          fill={SERIES[0]}
          radius={BAR_RADIUS}
          maxBarSize={BAR_MAX}
          {...noAnim}
        />
        {showExpenses && (
          <Bar
            dataKey="expenses"
            name="Expenses"
            fill={SERIES[1]}
            radius={BAR_RADIUS}
            maxBarSize={BAR_MAX}
            {...noAnim}
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

const dayLabel = (d: string) => {
  const p = parseDate(d);
  return p ? format(p, "dd MMM") : d;
};

export function DailyCollectionsChart({ days }: { days: DayPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={days} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="date" {...xAxisProps} tickFormatter={dayLabel} interval="preserveStartEnd" />
        <YAxis
          {...yAxisProps}
          {...niceAxis(maxOf(days, "collected"))}
          tickFormatter={(v: number) => moneyCompact(v)}
        />
        <Tooltip
          cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }}
          content={<ChartTooltip format={(v) => money(v)} labelFormat={(l) => dayLabel(String(l))} />}
        />
        <Area
          type="linear"
          dataKey="collected"
          name="Collected"
          stroke={SERIES[0]}
          strokeWidth={2}
          fill={SERIES[0]}
          fillOpacity={0.1}
          dot={false}
          activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }}
          {...noAnim}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MemberFlowChart({ months }: { months: MonthPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart
        data={months}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        barGap={2}
        barCategoryGap="22%"
      >
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="label" {...xAxisProps} />
        <YAxis
          {...yAxisProps}
          {...niceAxis(maxOf(months, "newMembers", "lapsed"), { integer: true })}
          width={36}
        />
        <Tooltip cursor={cursor} content={<ChartTooltip format={(v) => num(v)} />} />
        <Bar
          dataKey="newMembers"
          name="New members"
          fill={SERIES[0]}
          radius={BAR_RADIUS}
          maxBarSize={BAR_MAX}
          {...noAnim}
        />
        <Bar
          dataKey="lapsed"
          name="Left (not renewed)"
          fill={SERIES[1]}
          radius={BAR_RADIUS}
          maxBarSize={BAR_MAX}
          {...noAnim}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ActiveTrendChart({ months }: { months: MonthPoint[] }) {
  const last = months[months.length - 1];
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={months} margin={{ top: 16, right: 28, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="label" {...xAxisProps} />
        <YAxis {...yAxisProps} {...niceAxis(maxOf(months, "activeAtEnd"), { integer: true })} width={36} />
        <Tooltip
          cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }}
          content={<ChartTooltip format={(v) => `${num(v)} members`} />}
        />
        <Line
          type="monotone"
          dataKey="activeAtEnd"
          name="Active members"
          stroke={SERIES[0]}
          strokeWidth={2}
          dot={{ r: 3, fill: SERIES[0], stroke: "var(--card)", strokeWidth: 2 }}
          activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }}
          label={(props: { x?: number | string; y?: number | string; index?: number }) =>
            props.index === months.length - 1 && last ? (
              <text
                x={Number(props.x ?? 0) + 6}
                y={Number(props.y ?? 0) - 8}
                fill="var(--foreground)"
                fontSize={12}
                fontWeight={600}
              >
                {num(last.activeAtEnd)}
              </text>
            ) : (
              <g />
            )
          }
          {...noAnim}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DailyCheckinsChart({ days }: { days: DayPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={days} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="18%">
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="date" {...xAxisProps} tickFormatter={dayLabel} interval="preserveStartEnd" />
        <YAxis {...yAxisProps} {...niceAxis(maxOf(days, "checkIns"), { integer: true })} width={36} />
        <Tooltip
          cursor={cursor}
          content={<ChartTooltip format={(v) => num(v)} labelFormat={(l) => dayLabel(String(l))} />}
        />
        <Bar
          dataKey="checkIns"
          name="Check-ins"
          fill={SERIES[0]}
          radius={BAR_RADIUS}
          maxBarSize={BAR_MAX}
          {...noAnim}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SUN_FIRST_TO_MON_FIRST = [6, 0, 1, 2, 3, 4, 5]; // index by Sunday-first dow → row

/** Weekday × hour grid, single-hue sequential ramp. Shows the gym's busy times. */
export function CheckinHeatmap({ cells }: { cells: HeatCell[] }) {
  const { grid, max, hours } = useMemo(() => {
    const g = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    let mx = 0;
    let lo = 23;
    let hi = 0;
    for (const c of cells) {
      const row = SUN_FIRST_TO_MON_FIRST[c.dow] ?? 0;
      g[row][c.hour] += c.count;
      mx = Math.max(mx, g[row][c.hour]);
      if (c.count > 0) {
        lo = Math.min(lo, c.hour);
        hi = Math.max(hi, c.hour);
      }
    }
    const hrs = mx === 0 ? [] : Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    return { grid: g, max: mx, hours: hrs };
  }, [cells]);

  if (max === 0)
    return (
      <p className="py-10 text-center text-muted-foreground text-sm">No check-ins in the last 8 weeks.</p>
    );
  const color = (v: number) => {
    if (v === 0) return "var(--muted)";
    const idx = Math.min(BLUE_RAMP.length - 1, Math.floor((v / max) * BLUE_RAMP.length));
    return BLUE_RAMP[idx];
  };
  const hourLabel = (h: number) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`);
  return (
    <div className="overflow-x-auto px-2">
      <table className="w-full border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th />
            {hours.map((h) => (
              <th key={h} className="pb-1 font-normal text-[10px] text-muted-foreground">
                {hourLabel(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, r) => (
            <tr key={DOW[r]}>
              <td className="pr-1.5 text-right text-[11px] text-muted-foreground">{DOW[r]}</td>
              {hours.map((h) => (
                <td
                  key={h}
                  title={`${DOW[r]} ${hourLabel(h)}: ${row[h]} check-ins (8 weeks)`}
                  className="h-6 min-w-5 rounded-[3px]"
                  style={{ background: color(row[h]) }}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
        Fewer
        {BLUE_RAMP.map((c) => (
          <span key={c} className="inline-block h-3 w-5 rounded-[2px]" style={{ background: c }} />
        ))}
        More
      </div>
    </div>
  );
}

/** Horizontal bar list: one series → one colour, value at the bar end, share in muted text. */
export function BarList({
  items,
  formatValue = (v) => num(v),
  showShare = true,
  max: maxItems = 8,
  onSelect,
}: {
  items: { name: string; value: number }[];
  formatValue?: (v: number) => string;
  showShare?: boolean;
  max?: number;
  onSelect?: (name: string) => void;
}) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const top = items.slice(0, maxItems);
  const peak = Math.max(1, ...top.map((i) => i.value));
  if (items.length === 0)
    return <p className="px-2 py-6 text-center text-muted-foreground text-sm">No data yet.</p>;
  return (
    <ul className="flex flex-col gap-2.5 px-2">
      {top.map((i) => (
        <li key={i.name}>
          <button
            type="button"
            className={cn("w-full text-left", !onSelect && "cursor-default")}
            onClick={() => onSelect?.(i.name)}
          >
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate">{i.name}</span>
              <span className="shrink-0 font-medium tabular">
                {formatValue(i.value)}
                {showShare && (
                  <span className="ml-1.5 font-normal text-muted-foreground text-xs">
                    {percent(i.value, total)}
                  </span>
                )}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${(i.value / peak) * 100}%`, background: SERIES[0] }}
              />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Part-to-whole for ≤ 3 categories (gender): one 100% bar with 2px gaps + labelled legend. */
export function ShareBar({ items }: { items: NameCount[] }) {
  const total = items.reduce((s, i) => s + i.count, 0);
  if (!total) return <p className="px-2 py-6 text-center text-muted-foreground text-sm">No data yet.</p>;
  return (
    <div className="px-2">
      <div className="flex h-4 gap-[2px] overflow-hidden rounded-full">
        {items.map((i, idx) => (
          <div
            key={i.name}
            title={`${i.name}: ${num(i.count)}`}
            style={{ width: `${(i.count / total) * 100}%`, background: SERIES[idx] }}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-col gap-1.5">
        {items.map((i, idx) => (
          <li key={i.name} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2">
              <span className="size-2.5 rounded-sm" style={{ background: SERIES[idx] }} />
              {i.name}
            </span>
            <span className="tabular">
              {num(i.count)} <span className="text-muted-foreground text-xs">{percent(i.count, total)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SmallStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="font-semibold">{value}</div>
      {sub && <div className="text-muted-foreground text-xs">{sub}</div>}
    </div>
  );
}

export { compact };
