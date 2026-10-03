import { useQuery } from "@tanstack/react-query";
import { ChartColumn, Printer } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { GymSettings } from "@/api/bindings";
import { api } from "@/api/client";
import {
  BAR_MAX,
  BAR_RADIUS,
  ChartCard,
  ChartLegend,
  ChartTooltip,
  DataTable,
  gridProps,
  niceAxis,
  SERIES,
  xAxisProps,
  yAxisProps,
} from "@/components/charts/kit";
import { DateRangePicker, type RangeValue, rangeFromPreset } from "@/components/common/date-range";
import { StatusBadge } from "@/components/common/member";
import { ErrorState, LoadingBlock, PageContainer, PageHeader } from "@/components/common/page";
import { StatCard } from "@/components/common/widgets";
import { Button } from "@/components/ui/button";
import { DateField, quickDates } from "@/components/ui/date-field";
import { Select } from "@/components/ui/menus";
import { Badge, Card, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { BarList } from "@/features/dashboard/charts";
import { useSettings, useTracksAttendance } from "@/hooks/queries";
import { maxOf } from "@/lib/axis";
import { formatDate, formatTime, money, moneyCompact, num, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCan, useSession } from "@/stores/session";
import { printReport } from "./print";

const TABS = [
  { key: "closing", label: "Daily closing", perm: null },
  { key: "collections", label: "Collections", perm: "viewRevenue" },
  { key: "memberships", label: "Memberships", perm: "viewReports" },
  { key: "attendance", label: "Attendance", perm: "viewReports" },
  { key: "expenses", label: "Expenses", perm: "viewExpenses" },
  { key: "pnl", label: "Profit & loss", perm: "viewRevenue" },
] as const;

const noAnim = { isAnimationActive: false } as const;

function rangeText(r: RangeValue) {
  return r.from === r.to ? formatDate(r.from) : `${formatDate(r.from)} – ${formatDate(r.to)}`;
}

function SimpleColumns({
  data,
  xKey,
  yKey,
  name,
  money: isMoney = false,
  labelFormat,
}: {
  data: object[];
  xKey: string;
  yKey: string;
  name: string;
  money?: boolean;
  labelFormat?: (v: string) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="18%">
        <CartesianGrid {...gridProps} />
        <XAxis dataKey={xKey} {...xAxisProps} tickFormatter={labelFormat} interval="preserveStartEnd" />
        <YAxis
          {...yAxisProps}
          {...niceAxis(maxOf(data as Record<string, unknown>[], yKey), { integer: true })}
          width={isMoney ? 64 : 40}
          tickFormatter={(v: number) => (isMoney ? moneyCompact(v) : num(v))}
        />
        <Tooltip
          cursor={{ fill: "color-mix(in oklab, var(--muted-foreground) 8%, transparent)" }}
          content={
            <ChartTooltip
              format={(v) => (isMoney ? money(v) : num(v))}
              labelFormat={labelFormat ? (l) => labelFormat(String(l)) : undefined}
            />
          }
        />
        <Bar
          dataKey={yKey}
          name={name}
          fill={SERIES[0]}
          radius={BAR_RADIUS}
          maxBarSize={BAR_MAX}
          {...noAnim}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------------- Daily closing

function ClosingReport({ gym }: { gym: GymSettings }) {
  const canRevenue = useCan("viewRevenue");
  const actor = useSession((s) => s.actor);
  const tracks = useTracksAttendance();
  const [date, setDate] = useState(todayISO());
  const q = useQuery({ queryKey: ["report-closing", date], queryFn: () => api.reports.dailyClosing(date) });
  const r = q.data;
  const print = () =>
    r &&
    printReport({
      gym,
      title: "Daily closing",
      period: formatDate(r.date),
      preparedBy: actor?.name,
      kpis: [
        { label: "Total collected", value: money(r.totalCollected) },
        { label: "Cash collected", value: money(r.cashCollected) },
        { label: "Cash expenses", value: money(r.cashExpenses) },
        { label: "Cash in drawer", value: money(r.netCash) },
      ],
      sections: [
        {
          title: "By payment method",
          columns: ["Method", "Payments", "Amount"],
          rows: r.byMethod.map((m) => [m.method, m.count, money(m.total)]),
          footer: ["Total", r.payments.length, money(r.totalCollected)],
        },
        {
          title: "By staff",
          columns: ["Received by", "Payments", "Amount"],
          rows: r.byStaff.map((s) => [s.name, s.count, money(s.total)]),
        },
        {
          title: "Payments",
          columns: ["Receipt", "Time", "Member", "Method", "Amount"],
          rows: r.payments.map((p) => [
            p.receiptNo,
            formatTime(p.paidAt),
            `${p.memberName} (${p.memberCode})`,
            p.method,
            money(p.amount),
          ]),
        },
        {
          title: "Voided receipts",
          columns: ["Receipt", "Member", "Amount", "Reason"],
          rows: r.voided.map((p) => [p.receiptNo, p.memberName, money(p.amount), p.voidReason ?? ""]),
        },
        {
          title: "Expenses",
          columns: ["Category", "Paid to", "Method", "Amount"],
          rows: r.expenses.map((e) => [e.categoryName, e.payee ?? "", e.method, money(e.amount)]),
        },
      ],
    });
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <DateField
          className="w-48"
          value={date}
          onChange={setDate}
          max={todayISO()}
          quick={quickDates(0, -1)}
          disabled={!canRevenue}
        />
        {!canRevenue && (
          <span className="text-muted-foreground text-sm">Receptionists can see today's closing only.</span>
        )}
        <Button variant="outline" className="ml-auto" onClick={print} disabled={!r}>
          <Printer /> Print closing
        </Button>
      </div>
      {q.isPending ? (
        <LoadingBlock />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        r && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Total collected"
                value={money(r.totalCollected)}
                tone="success"
                hint={`${num(r.payments.length)} payments`}
              />
              <StatCard label="Cash collected" value={money(r.cashCollected)} />
              <StatCard
                label="Cash expenses"
                value={money(r.cashExpenses)}
                hint={`All expenses ${money(r.totalExpenses)}`}
              />
              <StatCard label="Cash that should be in the drawer" value={money(r.netCash)} tone="primary" />
              <StatCard label="New members" value={num(r.newMembers)} />
              <StatCard label="Renewals" value={num(r.renewals)} />
              {tracks && <StatCard label="Check-ins" value={num(r.checkIns)} />}
              <StatCard
                label="Voided receipts"
                value={num(r.voided.length)}
                tone={r.voided.length ? "warning" : "default"}
              />
            </div>
            <div className="grid gap-5 xl:grid-cols-2">
              <Card className="overflow-hidden">
                <CardHeader>
                  <CardTitle>By payment method</CardTitle>
                </CardHeader>
                <div className="px-5 pb-4">
                  <DataTable
                    columns={["Method", "Payments", "Amount"]}
                    rows={r.byMethod.map((m) => [m.method, num(m.count), money(m.total)])}
                  />
                </div>
              </Card>
              <Card className="overflow-hidden">
                <CardHeader>
                  <CardTitle>By staff member</CardTitle>
                </CardHeader>
                <div className="px-5 pb-4">
                  <DataTable
                    columns={["Received by", "Payments", "Amount"]}
                    rows={r.byStaff.map((s) => [s.name, num(s.count), money(s.total)])}
                  />
                </div>
              </Card>
            </div>
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>Payments</CardTitle>
              </CardHeader>
              <Table>
                <THead>
                  <tr>
                    <TH>Receipt</TH>
                    <TH>Time</TH>
                    <TH>Member</TH>
                    <TH>Method</TH>
                    <TH>By</TH>
                    <TH className="text-right">Amount</TH>
                  </tr>
                </THead>
                <TBody>
                  {[...r.payments, ...r.voided].map((p) => (
                    <TR key={p.id} className={cn(p.voidedAt && "text-muted-foreground line-through")}>
                      <TD className="tabular">
                        {p.receiptNo} {p.voidedAt && <Badge variant="danger">VOID</Badge>}
                      </TD>
                      <TD>{formatTime(p.paidAt)}</TD>
                      <TD>
                        <Link to={`/members/${p.memberId}`} className="hover:underline">
                          {p.memberName}
                        </Link>
                      </TD>
                      <TD>{p.method}</TD>
                      <TD>{p.receivedByName ?? "—"}</TD>
                      <TD className="text-right font-medium tabular">{money(p.amount)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          </>
        )
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------ Collections

function CollectionsReport({ gym }: { gym: GymSettings }) {
  const [range, setRange] = useState<RangeValue>(rangeFromPreset("month"));
  const q = useQuery({
    queryKey: ["report-collections", range.from, range.to],
    queryFn: () => api.reports.collections({ from: range.from, to: range.to }),
  });
  const r = q.data;
  const monthly = r ? r.byDay.length > 62 : false;
  const print = () =>
    r &&
    printReport({
      gym,
      title: "Collections report",
      period: rangeText(range),
      kpis: [
        { label: "Collected", value: money(r.total) },
        { label: "Payments", value: num(r.count) },
        { label: "Average payment", value: money(r.average) },
        { label: "Discounts given", value: money(r.discountsTotal) },
      ],
      sections: [
        {
          title: "By method",
          columns: ["Method", "Payments", "Amount"],
          rows: r.byMethod.map((m) => [m.method, m.count, money(m.total)]),
        },
        {
          title: "By staff",
          columns: ["Received by", "Payments", "Amount"],
          rows: r.byStaff.map((s) => [s.name, s.count, money(s.total)]),
        },
        {
          title: "Billed by type",
          columns: ["Type", "Count", "Amount"],
          rows: r.billedByKind.map((b) => [b.name, b.count, money(b.total)]),
        },
        {
          title: monthly ? "By month" : "By day",
          columns: ["Period", "Payments", "Amount"],
          rows: (monthly ? r.byMonth : r.byDay).map((d) => [d.label, d.count, money(d.total)]),
        },
      ],
    });
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <DateRangePicker value={range} onChange={setRange} />
        <Button variant="outline" className="ml-auto" onClick={print} disabled={!r}>
          <Printer /> Print
        </Button>
      </div>
      {q.isPending ? (
        <LoadingBlock />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        r && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <StatCard
                label="Collected"
                value={money(r.total)}
                tone="success"
                hint={`${num(r.count)} payments`}
              />
              <StatCard label="Average payment" value={money(r.average)} />
              <StatCard
                label="Billed in period"
                value={money(r.billedTotal)}
                hint="Fees charged (before payment)"
              />
              <StatCard label="Discounts given" value={money(r.discountsTotal)} />
              <StatCard
                label="Voided"
                value={money(r.voidedTotal)}
                hint={`${num(r.voidedCount)} receipts`}
                tone={r.voidedCount ? "warning" : "default"}
              />
            </div>
            <ChartCard
              title={monthly ? "Collected per month" : "Collected per day"}
              table={
                <DataTable
                  columns={["Period", "Payments", "Amount"]}
                  rows={(monthly ? r.byMonth : r.byDay).map((d) => [d.label, num(d.count), money(d.total)])}
                />
              }
            >
              <SimpleColumns
                data={monthly ? r.byMonth : r.byDay}
                xKey="label"
                yKey="total"
                name="Collected"
                money
              />
            </ChartCard>
            <div className="grid gap-5 xl:grid-cols-3">
              <ChartCard title="By payment method">
                <BarList
                  items={r.byMethod.map((m) => ({ name: m.method, value: m.total }))}
                  formatValue={money}
                />
              </ChartCard>
              <ChartCard title="By staff member">
                <BarList
                  items={r.byStaff.map((s) => ({ name: s.name, value: s.total }))}
                  formatValue={money}
                />
              </ChartCard>
              <ChartCard title="Billed by type" description="Membership, admission, training…">
                <BarList
                  items={r.billedByKind.map((b) => ({ name: b.name, value: b.total }))}
                  formatValue={money}
                />
              </ChartCard>
            </div>
          </>
        )
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------ Memberships

function MembershipsReport({ gym }: { gym: GymSettings }) {
  const canRevenue = useCan("viewRevenue");
  const [range, setRange] = useState<RangeValue>(rangeFromPreset("last90"));
  const q = useQuery({
    queryKey: ["report-memberships", range.from, range.to],
    queryFn: () => api.reports.memberships({ from: range.from, to: range.to }),
  });
  const r = q.data;
  const print = () =>
    r &&
    printReport({
      gym,
      title: "Memberships report",
      period: rangeText(range),
      kpis: [
        { label: "New members", value: num(r.newMembers) },
        { label: "Renewals", value: num(r.renewals) },
        { label: "Ended", value: num(r.ended) },
        { label: "Renewal rate", value: r.retentionRate === null ? "—" : `${r.retentionRate}%` },
      ],
      sections: [
        {
          title: "By month",
          columns: ["Month", "New", "Renewals", "Left"],
          rows: r.months.map((m) => [m.label, m.newMembers, m.renewals, m.lapsed]),
        },
        {
          title: "By plan",
          columns: canRevenue ? ["Plan", "New", "Renewals", "Billed"] : ["Plan", "New", "Renewals"],
          rows: r.byPlan.map((p) =>
            canRevenue
              ? [p.planName, p.newCount, p.renewalCount, money(p.billed)]
              : [p.planName, p.newCount, p.renewalCount],
          ),
        },
        {
          title: "Expiring in the next 30 days",
          columns: ["Member", "ID", "Plan", "Ends"],
          rows: r.expiringNext30.map((m) => [
            m.fullName,
            m.memberCode,
            m.planName ?? "",
            formatDate(m.endDate),
          ]),
        },
      ],
    });
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <DateRangePicker value={range} onChange={setRange} />
        <Button variant="outline" className="ml-auto" onClick={print} disabled={!r}>
          <Printer /> Print
        </Button>
      </div>
      {q.isPending ? (
        <LoadingBlock />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        r && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <StatCard label="New members" value={num(r.newMembers)} tone="primary" />
              <StatCard label="Renewals" value={num(r.renewals)} tone="success" />
              <StatCard label="Memberships ended" value={num(r.ended)} />
              <StatCard label="Renewed after ending" value={num(r.renewedAfterEnd)} />
              <StatCard
                label="Left (not renewed)"
                value={num(r.lapsed)}
                tone={r.lapsed ? "warning" : "default"}
              />
              <StatCard
                label="Renewal rate"
                value={r.retentionRate === null ? "—" : `${r.retentionRate}%`}
                hint={`${num(r.cancelled)} cancelled`}
              />
            </div>
            <ChartCard
              title="New, renewed and left — per month"
              legend={
                <ChartLegend
                  items={[
                    { label: "New members", color: SERIES[0] },
                    { label: "Renewals", color: SERIES[1] },
                    { label: "Left", color: SERIES[2] },
                  ]}
                />
              }
              table={
                <DataTable
                  columns={["Month", "New", "Renewals", "Left"]}
                  rows={r.months.map((m) => [m.label, num(m.newMembers), num(m.renewals), num(m.lapsed)])}
                />
              }
            >
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={r.months}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  barGap={2}
                  barCategoryGap="20%"
                >
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="label" {...xAxisProps} />
                  <YAxis
                    {...yAxisProps}
                    {...niceAxis(maxOf(r.months, "newMembers", "renewals", "lapsed"), { integer: true })}
                    width={36}
                  />
                  <Tooltip
                    cursor={{ fill: "color-mix(in oklab, var(--muted-foreground) 8%, transparent)" }}
                    content={<ChartTooltip format={(v) => num(v)} />}
                  />
                  <Bar
                    dataKey="newMembers"
                    name="New members"
                    fill={SERIES[0]}
                    radius={BAR_RADIUS}
                    maxBarSize={BAR_MAX}
                    {...noAnim}
                  />
                  <Bar
                    dataKey="renewals"
                    name="Renewals"
                    fill={SERIES[1]}
                    radius={BAR_RADIUS}
                    maxBarSize={BAR_MAX}
                    {...noAnim}
                  />
                  <Bar
                    dataKey="lapsed"
                    name="Left"
                    fill={SERIES[2]}
                    radius={BAR_RADIUS}
                    maxBarSize={BAR_MAX}
                    {...noAnim}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <div className="grid gap-5 xl:grid-cols-2">
              <Card className="overflow-hidden">
                <CardHeader>
                  <CardTitle>Plans sold</CardTitle>
                </CardHeader>
                <div className="px-5 pb-4">
                  <DataTable
                    columns={canRevenue ? ["Plan", "New", "Renewals", "Billed"] : ["Plan", "New", "Renewals"]}
                    rows={r.byPlan.map((p) =>
                      canRevenue
                        ? [p.planName, num(p.newCount), num(p.renewalCount), money(p.billed)]
                        : [p.planName, num(p.newCount), num(p.renewalCount)],
                    )}
                  />
                </div>
              </Card>
              <Card className="overflow-hidden">
                <CardHeader>
                  <CardTitle>Expiring in the next 30 days ({num(r.expiringNext30.length)})</CardTitle>
                </CardHeader>
                <ul className="max-h-80 divide-y overflow-y-auto">
                  {r.expiringNext30.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-2 text-sm">
                      <Link to={`/members/${m.id}`} className="truncate font-medium hover:underline">
                        {m.fullName} <span className="text-muted-foreground">{m.memberCode}</span>
                      </Link>
                      <span className="flex items-center gap-2">
                        {formatDate(m.endDate)} <StatusBadge status={m.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </>
        )
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------- Attendance

function AttendanceReport({ gym }: { gym: GymSettings }) {
  const [range, setRange] = useState<RangeValue>(rangeFromPreset("last30"));
  const q = useQuery({
    queryKey: ["report-attendance", range.from, range.to],
    queryFn: () => api.reports.attendance({ from: range.from, to: range.to }),
  });
  const r = q.data;
  const hourLabel = (h: string) => {
    const n = Number(h);
    return n === 0 ? "12 am" : n < 12 ? `${n} am` : n === 12 ? "12 pm" : `${n - 12} pm`;
  };
  const busiest = r ? [...r.byWeekday].sort((a, b) => b.count - a.count)[0] : null;
  const print = () =>
    r &&
    printReport({
      gym,
      title: "Attendance report",
      period: rangeText(range),
      kpis: [
        { label: "Total check-ins", value: num(r.total) },
        { label: "Different members", value: num(r.uniqueMembers) },
        { label: "Average per day", value: String(r.avgPerDay) },
        { label: "Busiest day", value: busiest?.name ?? "—" },
      ],
      sections: [
        {
          title: "Most regular members",
          columns: ["Member", "ID", "Visits"],
          rows: r.topMembers.map((t) => [t.member.fullName, t.member.memberCode, t.visits]),
        },
        {
          title: "By weekday",
          columns: ["Day", "Check-ins"],
          rows: r.byWeekday.map((w) => [w.name, w.count]),
        },
        {
          title: "By hour",
          columns: ["Hour", "Check-ins"],
          rows: r.byHour.map((h) => [hourLabel(String(h.hour)), h.count]),
        },
      ],
    });
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <DateRangePicker value={range} onChange={setRange} />
        <Button variant="outline" className="ml-auto" onClick={print} disabled={!r}>
          <Printer /> Print
        </Button>
      </div>
      {q.isPending ? (
        <LoadingBlock />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        r && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Total check-ins" value={num(r.total)} tone="primary" />
              <StatCard label="Different members" value={num(r.uniqueMembers)} />
              <StatCard label="Average per day" value={String(r.avgPerDay)} />
              <StatCard
                label="Busiest day"
                value={busiest?.name ?? "—"}
                hint={busiest ? `${num(busiest.count)} check-ins` : undefined}
              />
            </div>
            <ChartCard
              title="Check-ins per day"
              table={
                <DataTable
                  columns={["Date", "Check-ins"]}
                  rows={r.byDay.map((d) => [formatDate(d.date), num(d.count)])}
                />
              }
            >
              <SimpleColumns
                data={r.byDay}
                xKey="date"
                yKey="count"
                name="Check-ins"
                labelFormat={(v) => formatDate(v).slice(0, 6)}
              />
            </ChartCard>
            <div className="grid gap-5 xl:grid-cols-3">
              <ChartCard
                title="By hour of day"
                table={
                  <DataTable
                    columns={["Hour", "Check-ins"]}
                    rows={r.byHour.map((h) => [hourLabel(String(h.hour)), num(h.count)])}
                  />
                }
              >
                <SimpleColumns
                  data={r.byHour.map((h) => ({ ...h, label: String(h.hour) }))}
                  xKey="label"
                  yKey="count"
                  name="Check-ins"
                  labelFormat={hourLabel}
                />
              </ChartCard>
              <ChartCard title="By weekday">
                <SimpleColumns data={r.byWeekday} xKey="name" yKey="count" name="Check-ins" />
              </ChartCard>
              <Card className="overflow-hidden">
                <CardHeader>
                  <CardTitle>Most regular members</CardTitle>
                </CardHeader>
                <ul className="max-h-72 divide-y overflow-y-auto">
                  {r.topMembers.map((t, i) => (
                    <li
                      key={t.member.id}
                      className="flex items-center justify-between gap-3 px-5 py-2 text-sm"
                    >
                      <Link to={`/members/${t.member.id}`} className="truncate hover:underline">
                        <span className="mr-2 text-muted-foreground">{i + 1}.</span>
                        {t.member.fullName}
                      </Link>
                      <span className="font-medium tabular">{num(t.visits)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </>
        )
      )}
    </div>
  );
}

// --------------------------------------------------------------------------------------- Expenses

function ExpensesReport({ gym }: { gym: GymSettings }) {
  const [range, setRange] = useState<RangeValue>(rangeFromPreset("year"));
  const q = useQuery({
    queryKey: ["report-expenses", range.from, range.to],
    queryFn: () => api.reports.expenses({ from: range.from, to: range.to }),
  });
  const r = q.data;
  const print = () =>
    r &&
    printReport({
      gym,
      title: "Expenses report",
      period: rangeText(range),
      kpis: [{ label: "Total expenses", value: money(r.total) }],
      sections: [
        {
          title: "By category",
          columns: ["Category", "Entries", "Amount"],
          rows: r.byCategory.map((c) => [c.name, c.count, money(c.total)]),
          footer: ["Total", "", money(r.total)],
        },
        {
          title: "By month",
          columns: ["Month", "Entries", "Amount"],
          rows: r.byMonth.map((m) => [m.label, m.count, money(m.total)]),
        },
        {
          title: "By method",
          columns: ["Method", "Entries", "Amount"],
          rows: r.byMethod.map((m) => [m.method, m.count, money(m.total)]),
        },
      ],
    });
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <DateRangePicker value={range} onChange={setRange} />
        <Button variant="outline" className="ml-auto" onClick={print} disabled={!r}>
          <Printer /> Print
        </Button>
      </div>
      {q.isPending ? (
        <LoadingBlock />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        r && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="Total expenses" value={money(r.total)} tone="danger" />
              <StatCard
                label="Biggest category"
                value={r.byCategory[0]?.name ?? "—"}
                hint={r.byCategory[0] ? money(r.byCategory[0].total) : undefined}
              />
              <StatCard
                label="Months"
                value={num(r.byMonth.length)}
                hint={
                  r.byMonth.length ? `avg ${money(Math.round(r.total / r.byMonth.length))}/month` : undefined
                }
              />
            </div>
            <div className="grid gap-5 xl:grid-cols-5">
              <ChartCard
                className="xl:col-span-3"
                title="Expenses per month"
                table={
                  <DataTable
                    columns={["Month", "Amount"]}
                    rows={r.byMonth.map((m) => [m.label, money(m.total)])}
                  />
                }
              >
                <SimpleColumns data={r.byMonth} xKey="label" yKey="total" name="Expenses" money />
              </ChartCard>
              <ChartCard className="xl:col-span-2" title="By category">
                <BarList
                  items={r.byCategory.map((c) => ({ name: c.name, value: c.total }))}
                  formatValue={money}
                  max={12}
                />
              </ChartCard>
            </div>
          </>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------- Profit & loss

function PnlReport({ gym }: { gym: GymSettings }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const q = useQuery({ queryKey: ["report-pnl", year], queryFn: () => api.reports.pnl(year) });
  const r = q.data;
  const print = () =>
    r &&
    printReport({
      gym,
      title: `Profit & loss ${r.year}`,
      period: `January – December ${r.year}`,
      kpis: [
        { label: "Income", value: money(r.totalIncome) },
        { label: "Expenses", value: money(r.totalExpenses) },
        { label: "Profit", value: money(r.totalProfit) },
        {
          label: "Margin",
          value: r.totalIncome ? `${Math.round((r.totalProfit / r.totalIncome) * 100)}%` : "—",
        },
      ],
      sections: [
        {
          title: "Month by month",
          columns: ["Month", "Income", "Expenses", "Profit"],
          rows: r.months.map((m) => [m.label, money(m.income), money(m.expenses), money(m.profit)]),
          footer: ["Total", money(r.totalIncome), money(r.totalExpenses), money(r.totalProfit)],
        },
        {
          title: "Expenses by category",
          columns: ["Category", "Amount"],
          rows: r.expenseCategories.map((c) => [c.name, money(c.total)]),
        },
      ],
    });
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          className="w-32"
          value={String(year)}
          onValueChange={(v) => setYear(Number(v))}
          options={Array.from({ length: 6 }, (_, i) => thisYear - i).map((y) => ({
            value: String(y),
            label: String(y),
          }))}
        />
        <Button variant="outline" className="ml-auto" onClick={print} disabled={!r}>
          <Printer /> Print
        </Button>
      </div>
      {q.isPending ? (
        <LoadingBlock />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        r && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Income (fees received)" value={money(r.totalIncome)} tone="success" />
              <StatCard label="Expenses" value={money(r.totalExpenses)} tone="danger" />
              <StatCard
                label="Profit"
                value={money(r.totalProfit)}
                tone={r.totalProfit >= 0 ? "primary" : "danger"}
              />
              <StatCard
                label="Profit margin"
                value={r.totalIncome ? `${Math.round((r.totalProfit / r.totalIncome) * 100)}%` : "—"}
              />
            </div>
            <ChartCard
              title={`Income vs expenses ${r.year}`}
              legend={
                <ChartLegend
                  items={[
                    { label: "Income", color: SERIES[0] },
                    { label: "Expenses", color: SERIES[1] },
                  ]}
                />
              }
              table={
                <DataTable
                  columns={["Month", "Income", "Expenses", "Profit"]}
                  rows={r.months.map((m) => [m.label, money(m.income), money(m.expenses), money(m.profit)])}
                />
              }
            >
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={r.months}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  barGap={2}
                  barCategoryGap="22%"
                >
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="label" {...xAxisProps} />
                  <YAxis
                    {...yAxisProps}
                    {...niceAxis(maxOf(r.months, "income", "expenses"))}
                    tickFormatter={(v: number) => moneyCompact(v)}
                  />
                  <Tooltip
                    cursor={{ fill: "color-mix(in oklab, var(--muted-foreground) 8%, transparent)" }}
                    content={<ChartTooltip format={(v) => money(v)} />}
                  />
                  <Bar
                    dataKey="income"
                    name="Income"
                    fill={SERIES[0]}
                    radius={BAR_RADIUS}
                    maxBarSize={BAR_MAX}
                    {...noAnim}
                  />
                  <Bar
                    dataKey="expenses"
                    name="Expenses"
                    fill={SERIES[1]}
                    radius={BAR_RADIUS}
                    maxBarSize={BAR_MAX}
                    {...noAnim}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <Card className="overflow-hidden">
              <Table>
                <THead>
                  <tr>
                    <TH>Month</TH>
                    <TH className="text-right">Income</TH>
                    <TH className="text-right">Expenses</TH>
                    <TH className="text-right">Profit</TH>
                  </tr>
                </THead>
                <TBody>
                  {r.months.map((m) => (
                    <TR key={m.month}>
                      <TD>{m.label}</TD>
                      <TD className="text-right tabular">{money(m.income)}</TD>
                      <TD className="text-right tabular">{money(m.expenses)}</TD>
                      <TD
                        className={cn("text-right font-semibold tabular", m.profit < 0 && "text-danger-ink")}
                      >
                        {money(m.profit)}
                      </TD>
                    </TR>
                  ))}
                  <TR className="bg-muted/50 font-semibold">
                    <TD>Total</TD>
                    <TD className="text-right tabular">{money(r.totalIncome)}</TD>
                    <TD className="text-right tabular">{money(r.totalExpenses)}</TD>
                    <TD className={cn("text-right tabular", r.totalProfit < 0 && "text-danger-ink")}>
                      {money(r.totalProfit)}
                    </TD>
                  </TR>
                </TBody>
              </Table>
            </Card>
          </>
        )
      )}
    </div>
  );
}

export function ReportsPage() {
  const settings = useSettings();
  const actor = useSession((s) => s.actor);
  const [params, setParams] = useSearchParams();
  const tracks = useTracksAttendance();
  const visible = TABS.filter(
    (t) => (!t.perm || actor?.permissions.includes(t.perm)) && (tracks || t.key !== "attendance"),
  );
  const requested = params.get("tab");
  const tab = visible.find((t) => t.key === requested)?.key ?? visible[0]?.key ?? "closing";

  return (
    <PageContainer>
      <PageHeader
        icon={<ChartColumn />}
        title="Reports"
        description="Detailed figures for any period — print them or export to Excel."
      />
      <div className="mb-5 flex flex-wrap gap-1 rounded-lg bg-muted p-1">
        {visible.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setParams({ tab: t.key }, { replace: true })}
            className={cn(
              "rounded-md px-3.5 py-1.5 font-medium text-sm text-muted-foreground transition-colors hover:text-foreground",
              tab === t.key && "bg-card text-foreground shadow-sm",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {!settings.data ? (
        <LoadingBlock />
      ) : (
        <>
          {tab === "closing" && <ClosingReport gym={settings.data.gym} />}
          {tab === "collections" && <CollectionsReport gym={settings.data.gym} />}
          {tab === "memberships" && <MembershipsReport gym={settings.data.gym} />}
          {tab === "attendance" && <AttendanceReport gym={settings.data.gym} />}
          {tab === "expenses" && <ExpensesReport gym={settings.data.gym} />}
          {tab === "pnl" && <PnlReport gym={settings.data.gym} />}
        </>
      )}
    </PageContainer>
  );
}
