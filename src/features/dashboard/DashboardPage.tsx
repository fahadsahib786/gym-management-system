import { useQuery } from "@tanstack/react-query";
import {
  Cake,
  CalendarClock,
  CircleX,
  HandCoins,
  LayoutDashboard,
  MessageCircle,
  Printer,
  RefreshCw,
  ScanLine,
  Snowflake,
  TrendingUp,
  UserPlus,
  Users,
  UserX,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import type { Dashboard, MemberQuick } from "@/api/bindings";
import { api } from "@/api/client";
import { ChartCard, ChartLegend, DataTable, SERIES } from "@/components/charts/kit";
import { MemberAvatar, StatusBadge, statusDetail } from "@/components/common/member";
import { ErrorState, PageContainer } from "@/components/common/page";
import { StatCard } from "@/components/common/widgets";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, Skeleton } from "@/components/ui/primitives";
import { useSettings, useTracksAttendance } from "@/hooks/queries";
import { delta, formatDate, formatTime, money, num, phoneDisplay, timeAgo } from "@/lib/format";
import { memberValues, type TemplateKey } from "@/lib/templates";
import { cn } from "@/lib/utils";
import { openDialog } from "@/stores/dialogs";
import { useSession } from "@/stores/session";
import {
  ActiveTrendChart,
  BarList,
  CheckinHeatmap,
  DailyCheckinsChart,
  DailyCollectionsChart,
  MemberFlowChart,
  RevenueChart,
  ShareBar,
  SmallStat,
} from "./charts";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function MemberListCard({
  title,
  icon,
  members,
  empty,
  detail,
  action,
  footerLink,
}: {
  title: string;
  icon: ReactNode;
  members: MemberQuick[];
  empty: string;
  detail: (m: MemberQuick) => ReactNode;
  action?: (m: MemberQuick) => ReactNode;
  footerLink?: { to: string; label: string };
}) {
  const navigate = useNavigate();
  return (
    <Card className="flex flex-col overflow-hidden">
      <CardHeader className="items-center">
        <CardTitle className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
          {icon} {title}
        </CardTitle>
        <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-xs tabular">
          {members.length}
        </span>
      </CardHeader>
      {members.length === 0 ? (
        <p className="px-5 pb-5 text-muted-foreground text-sm">{empty}</p>
      ) : (
        <ul className="flex-1 divide-y">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-5 py-2">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                onClick={() => navigate(`/members/${m.id}`)}
              >
                <MemberAvatar id={m.id} name={m.fullName} photoVersion={m.photoVersion} size="sm" />
                <div className="min-w-0">
                  <div className="truncate font-medium text-sm">{m.fullName}</div>
                  <div className="truncate text-muted-foreground text-xs">{detail(m)}</div>
                </div>
              </button>
              {action?.(m)}
            </li>
          ))}
        </ul>
      )}
      {footerLink && members.length > 0 && (
        <Link
          to={footerLink.to}
          className="border-t px-5 py-2.5 text-center font-medium text-primary text-sm hover:bg-muted/50"
        >
          {footerLink.label}
        </Link>
      )}
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <PageContainer>
      <Skeleton className="mb-5 h-10 w-80" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-72 rounded-xl" />
        ))}
      </div>
    </PageContainer>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const actor = useSession((s) => s.actor);
  const settings = useSettings();
  const tracks = useTracksAttendance();
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard.get, refetchInterval: 60_000 });

  if (dash.isPending) return <DashboardSkeleton />;
  if (dash.error) return <ErrorState className="py-24" error={dash.error} onRetry={() => dash.refetch()} />;
  const d: Dashboard = dash.data;
  const k = d.kpis;

  const whatsapp = (m: MemberQuick, template: TemplateKey) => {
    if (!settings.data) return;
    openDialog({
      type: "whatsapp",
      memberId: m.id,
      phone: m.phone,
      template,
      title: `WhatsApp ${m.fullName}`,
      values: memberValues(m, settings.data.gym),
    });
  };
  const waButton = (m: MemberQuick, template: TemplateKey) => (
    <Button
      size="icon-sm"
      variant="ghost"
      title="Send WhatsApp"
      aria-label="Send WhatsApp"
      onClick={() => whatsapp(m, template)}
    >
      <MessageCircle className="text-[#1fa855]" />
    </Button>
  );

  const monthsTable = d.months.map((m) => [m.label, money(m.collected), money(m.expenses), money(m.profit)]);
  const monthName = new Date().toLocaleDateString("en-GB", { month: "long" });

  return (
    <PageContainer className={cn(dash.isRefetching && "transition-opacity")}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-semibold text-xl tracking-tight">
            <LayoutDashboard className="size-5 text-muted-foreground" /> {greeting()},{" "}
            {actor?.name.split(" ")[0]}
          </h1>
          <p className="mt-0.5 text-muted-foreground text-sm">
            {new Date().toLocaleDateString("en-GB", {
              weekday: "long",
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}{" "}
            · updated {timeAgo(d.generatedAt)}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => dash.refetch()} disabled={dash.isFetching}>
          <RefreshCw className={cn(dash.isFetching && "animate-spin")} /> Refresh
        </Button>
      </div>

      {/* ---------------------------------------------------------------- KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active members"
          value={num(k.activeMembers)}
          icon={<Users />}
          tone="primary"
          delta={delta(k.activeMembers, k.activeMembers30dAgo)}
          deltaLabel="vs 30 days ago"
          onClick={() => navigate("/members?filter=active")}
        />
        <StatCard
          label="Collected today"
          value={money(k.collectedToday)}
          icon={<Wallet />}
          tone="success"
          hint={`${num(k.collectedTodayCount)} payment${k.collectedTodayCount === 1 ? "" : "s"}`}
          delta={d.showRevenue ? delta(k.collectedToday, k.collectedYesterday) : null}
          deltaLabel="vs yesterday"
          onClick={() => navigate("/payments")}
        />
        {d.showRevenue ? (
          <StatCard
            label={`Collected in ${monthName}`}
            value={money(k.collectedMonth)}
            icon={<TrendingUp />}
            tone="success"
            delta={delta(k.collectedMonth, k.collectedPrevPeriod)}
            deltaLabel="vs same days last month"
          />
        ) : tracks ? (
          <StatCard
            label="Check-ins today"
            value={num(k.checkInsToday)}
            icon={<ScanLine />}
            delta={delta(k.checkInsToday, k.checkInsYesterday)}
            deltaLabel="vs yesterday"
            onClick={() => navigate("/check-in")}
          />
        ) : (
          <StatCard
            label={`Renewals in ${monthName}`}
            value={num(k.renewalsMonth)}
            icon={<RefreshCw />}
            delta={delta(k.renewalsMonth, k.renewalsPrevPeriod)}
            deltaLabel="vs last month"
          />
        )}
        <StatCard
          label="Fee dues"
          value={money(k.duesTotal)}
          icon={<HandCoins />}
          tone={k.duesTotal > 0 ? "danger" : "default"}
          hint={`${num(k.duesMembers)} member${k.duesMembers === 1 ? "" : "s"}`}
          onClick={() => navigate("/dues")}
        />
        <StatCard
          label="Expiring in 7 days"
          value={num(k.expiringSoon)}
          icon={<CalendarClock />}
          tone={k.expiringSoon > 0 ? "warning" : "default"}
          hint="Remind them to renew"
          onClick={() => navigate("/members?filter=expiring")}
        />
        <StatCard
          label="Expired (last 30 days)"
          value={num(k.expiredRecent)}
          icon={<CircleX />}
          tone={k.expiredRecent > 0 ? "danger" : "default"}
          hint="Not renewed yet"
          onClick={() => navigate("/members?filter=expired")}
        />
        <StatCard
          label={`New members in ${monthName}`}
          value={num(k.newMembersMonth)}
          icon={<UserPlus />}
          delta={delta(k.newMembersMonth, k.newMembersPrevPeriod)}
          deltaLabel="vs last month"
        />
        {d.showRevenue && d.showExpenses ? (
          <StatCard
            label={`Profit in ${monthName}`}
            value={money(k.profitMonth)}
            icon={<TrendingUp />}
            tone={k.profitMonth >= 0 ? "success" : "danger"}
            hint={`Expenses ${money(k.expensesMonth)}`}
            onClick={() => navigate("/reports?tab=pnl")}
          />
        ) : (
          <StatCard
            label="Renewal rate (30 days)"
            value={k.retentionRate === null ? "—" : `${k.retentionRate}%`}
            icon={<RefreshCw />}
            hint={`${num(k.renewedOfEnded)} of ${num(k.endedLast30d)} renewed`}
          />
        )}
      </div>

      <div
        className={cn(
          "mt-3 grid grid-cols-2 gap-3",
          tracks ? "md:grid-cols-4 xl:grid-cols-6" : "md:grid-cols-3",
        )}
      >
        {tracks && (
          <>
            <SmallStat
              label="Check-ins today"
              value={num(k.checkInsToday)}
              sub={`avg ${k.avgDailyCheckIns}/day`}
            />
            <SmallStat label="Visitors (30 days)" value={num(k.uniqueVisitors30d)} sub="different members" />
          </>
        )}
        <SmallStat
          label="Renewals this month"
          value={num(k.renewalsMonth)}
          sub={`last month: ${num(k.renewalsPrevPeriod)}`}
        />
        <SmallStat
          label="Renewal rate"
          value={k.retentionRate === null ? "—" : `${k.retentionRate}%`}
          sub={`${num(k.renewedOfEnded)}/${num(k.endedLast30d)} last 30 days`}
        />
        {tracks && <SmallStat label="Not visiting" value={num(k.inactive)} sub="active, no recent visit" />}
        <SmallStat
          label="Frozen / no plan"
          value={`${num(k.frozen)} / ${num(k.noPlan)}`}
          sub={d.showRevenue ? `avg ${money(k.avgRevenuePerMember)}/member` : undefined}
        />
      </div>

      {/* ------------------------------------------------------- Attention lists */}
      <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <MemberListCard
          title="Expiring soon"
          icon={<CalendarClock />}
          members={d.expiring}
          empty="No memberships ending in the next days."
          detail={(m) => `${statusDetail(m.status, m.daysLeft, m.endDate)} · ${formatDate(m.endDate)}`}
          action={(m) => (
            <div className="flex">
              {waButton(m, "expiryReminder")}
              <Button size="sm" variant="ghost" onClick={() => openDialog({ type: "renew", memberId: m.id })}>
                Renew
              </Button>
            </div>
          )}
          footerLink={{ to: "/members?filter=expiring", label: "See all expiring" }}
        />
        <MemberListCard
          title="Biggest fee dues"
          icon={<HandCoins />}
          members={d.topDues}
          empty="Nobody owes fees. 🎉"
          detail={(m) => `${money(m.balance)} due · ${phoneDisplay(m.phone)}`}
          action={(m) => (
            <div className="flex">
              {waButton(m, "duesReminder")}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => openDialog({ type: "payment", memberId: m.id })}
              >
                Collect
              </Button>
            </div>
          )}
          footerLink={{ to: "/dues", label: "See all dues" }}
        />
        <MemberListCard
          title="Recently expired"
          icon={<CircleX />}
          members={d.expiredRecent}
          empty="No recently expired memberships."
          detail={(m) => `${statusDetail(m.status, m.daysLeft, m.endDate)} · ${m.planName ?? ""}`}
          action={(m) => (
            <div className="flex">
              {waButton(m, "expiredReminder")}
              <Button size="sm" variant="ghost" onClick={() => openDialog({ type: "renew", memberId: m.id })}>
                Renew
              </Button>
            </div>
          )}
          footerLink={{ to: "/members?filter=expired", label: "See all expired" }}
        />
      </div>

      {/* ---------------------------------------------------------------- Money */}
      {d.showRevenue && (
        <div className="mt-5 grid gap-5 xl:grid-cols-5">
          <ChartCard
            className="xl:col-span-3"
            title={d.showExpenses ? "Collected vs expenses — last 12 months" : "Collected — last 12 months"}
            description="Fees received each month (payments, not invoices)."
            legend={
              d.showExpenses && (
                <ChartLegend
                  items={[
                    { label: "Collected", color: SERIES[0] },
                    { label: "Expenses", color: SERIES[1] },
                  ]}
                />
              )
            }
            table={<DataTable columns={["Month", "Collected", "Expenses", "Profit"]} rows={monthsTable} />}
          >
            <RevenueChart months={d.months} showExpenses={d.showExpenses} />
          </ChartCard>
          <ChartCard
            className="xl:col-span-2"
            title="Payment methods this month"
            description="Cash vs JazzCash, Easypaisa, bank…"
            table={
              <DataTable
                columns={["Method", "Payments", "Amount"]}
                rows={d.methodsMonth.map((m) => [m.method, num(m.count), money(m.total)])}
              />
            }
          >
            <div className="pt-2">
              <BarList
                items={d.methodsMonth.map((m) => ({ name: m.method, value: m.total }))}
                formatValue={money}
              />
            </div>
          </ChartCard>
          <ChartCard
            className="xl:col-span-3"
            title="Daily collection — last 30 days"
            table={
              <DataTable
                columns={["Date", "Collected"]}
                rows={d.days.map((x) => [formatDate(x.date), money(x.collected)])}
              />
            }
          >
            <DailyCollectionsChart days={d.days} />
          </ChartCard>
          {d.showExpenses ? (
            <ChartCard
              className="xl:col-span-2"
              title={`Expenses in ${monthName}`}
              table={
                <DataTable
                  columns={["Category", "Amount"]}
                  rows={d.expenseCategoriesMonth.map((c) => [c.name, money(c.total)])}
                />
              }
            >
              <div className="pt-2">
                <BarList
                  items={d.expenseCategoriesMonth.map((c) => ({ name: c.name, value: c.total }))}
                  formatValue={money}
                />
              </div>
            </ChartCard>
          ) : (
            <ChartCard className="xl:col-span-2" title="Active members by plan">
              <div className="pt-2">
                <BarList items={d.planMix.map((p) => ({ name: p.name, value: p.count }))} />
              </div>
            </ChartCard>
          )}
        </div>
      )}

      {/* -------------------------------------------------------------- Members */}
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <ChartCard
          title="New members vs members who left"
          description="Per month. “Left” = membership ended and was not renewed."
          legend={
            <ChartLegend
              items={[
                { label: "New members", color: SERIES[0] },
                { label: "Left (not renewed)", color: SERIES[1] },
              ]}
            />
          }
          table={
            <DataTable
              columns={["Month", "New", "Left", "Renewals"]}
              rows={d.months.map((m) => [m.label, num(m.newMembers), num(m.lapsed), num(m.renewals)])}
            />
          }
        >
          <MemberFlowChart months={d.months} />
        </ChartCard>
        <ChartCard
          title="Active members over time"
          description="Members with a valid membership at the end of each month."
          table={
            <DataTable
              columns={["Month", "Active members"]}
              rows={d.months.map((m) => [m.label, num(m.activeAtEnd)])}
            />
          }
        >
          <ActiveTrendChart months={d.months} />
        </ChartCard>
      </div>

      {/* ----------------------------------------------------------- Attendance */}
      <div className={cn("mt-5 grid gap-5 xl:grid-cols-5", !tracks && "hidden")}>
        <ChartCard
          className="xl:col-span-3"
          title="Busy hours"
          description="Check-ins by weekday and hour, last 8 weeks."
        >
          <CheckinHeatmap cells={d.heatmap} />
        </ChartCard>
        <ChartCard
          className="xl:col-span-2"
          title="Check-ins per day"
          description="Last 30 days"
          table={
            <DataTable
              columns={["Date", "Check-ins"]}
              rows={d.days.map((x) => [formatDate(x.date), num(x.checkIns)])}
            />
          }
        >
          <DailyCheckinsChart days={d.days} />
        </ChartCard>
      </div>

      {/* --------------------------------------------------------- Demographics */}
      <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {d.showRevenue && (
          <ChartCard title="Active members by plan">
            <BarList items={d.planMix.map((p) => ({ name: p.name, value: p.count }))} />
          </ChartCard>
        )}
        <ChartCard title="Gender" description="Active members">
          <ShareBar items={d.genderMix} />
        </ChartCard>
        <ChartCard title="Age groups" description="Active members">
          <BarList items={d.ageGroups.map((a) => ({ name: a.name, value: a.count }))} />
        </ChartCard>
        <ChartCard title="Timings / batches" description="Active members">
          <BarList items={d.timingMix.map((a) => ({ name: a.name, value: a.count }))} />
        </ChartCard>
        <ChartCard title="Where members live" description="Top areas">
          <BarList items={d.areaMix.map((a) => ({ name: a.name, value: a.count }))} />
        </ChartCard>
        <ChartCard title="How they found us" description="Members who joined in the last 12 months">
          <BarList items={d.sourceMix.map((a) => ({ name: a.name, value: a.count }))} />
        </ChartCard>
      </div>

      {/* --------------------------------------------------------- More lists */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2 2xl:grid-cols-4">
        <Card className="overflow-hidden">
          <CardHeader className="items-center">
            <CardTitle className="flex items-center gap-2">
              <Cake className="size-4 text-muted-foreground" /> Birthdays this week
            </CardTitle>
          </CardHeader>
          {d.birthdays.length === 0 ? (
            <p className="px-5 pb-5 text-muted-foreground text-sm">No birthdays in the next 7 days.</p>
          ) : (
            <ul className="divide-y">
              {d.birthdays.map((b) => (
                <li key={b.member.id} className="flex items-center gap-3 px-5 py-2">
                  <MemberAvatar
                    id={b.member.id}
                    name={b.member.fullName}
                    photoVersion={b.member.photoVersion}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-sm">{b.member.fullName}</div>
                    <div className="text-muted-foreground text-xs">
                      {b.inDays === 0 ? "Today 🎂" : `In ${b.inDays} days`}
                    </div>
                  </div>
                  {waButton(b.member, "birthday")}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {tracks && (
          <MemberListCard
            title="Not visiting"
            icon={<UserX />}
            members={d.inactive}
            empty={
              d.inactivityTracked
                ? "Every active member visited recently."
                : `Shown once check-ins have been recorded for ${settings.data?.membership.inactiveDays ?? 10} days.`
            }
            detail={(m) => (m.lastVisitAt ? `Last visit ${timeAgo(m.lastVisitAt)}` : "No visit yet")}
            action={(m) => waButton(m, "inactive")}
            footerLink={{ to: "/members?filter=inactive", label: "See all" }}
          />
        )}
        <Card className="overflow-hidden">
          <CardHeader className="items-center">
            <CardTitle className="flex items-center gap-2">
              <Wallet className="size-4 text-muted-foreground" />{" "}
              {d.showRevenue ? "Latest payments" : "Today's payments"}
            </CardTitle>
          </CardHeader>
          {d.recentPayments.length === 0 ? (
            <p className="px-5 pb-5 text-muted-foreground text-sm">No payments yet.</p>
          ) : (
            <ul className="divide-y">
              {d.recentPayments.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-5 py-2">
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/members/${p.memberId}`}
                      className="truncate font-medium text-sm hover:underline"
                    >
                      {p.memberName}
                    </Link>
                    <div className="text-muted-foreground text-xs">
                      {p.receiptNo} · {p.method} · {formatTime(p.paidAt)}
                    </div>
                  </div>
                  <span className="font-semibold text-sm tabular">{money(p.amount)}</span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Receipt"
                    onClick={() => openDialog({ type: "receipt", paymentId: p.id })}
                  >
                    <Printer />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className={cn("overflow-hidden", !tracks && "hidden")}>
          <CardHeader className="items-center">
            <CardTitle className="flex items-center gap-2">
              <ScanLine className="size-4 text-muted-foreground" /> Latest check-ins
            </CardTitle>
            <Link to="/check-in" className="font-medium text-primary text-xs hover:underline">
              Open check-in
            </Link>
          </CardHeader>
          {d.recentCheckIns.length === 0 ? (
            <p className="px-5 pb-5 text-muted-foreground text-sm">No check-ins yet today.</p>
          ) : (
            <ul className="divide-y">
              {d.recentCheckIns.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-5 py-2">
                  <MemberAvatar
                    id={a.member.id}
                    name={a.member.fullName}
                    photoVersion={a.member.photoVersion}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-sm">{a.member.fullName}</div>
                    <div className="text-muted-foreground text-xs">{formatTime(a.checkedInAt)}</div>
                  </div>
                  {a.member.status === "frozen" ? (
                    <Snowflake className="size-4 text-info" />
                  ) : (
                    <StatusBadge status={a.member.status} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </PageContainer>
  );
}
