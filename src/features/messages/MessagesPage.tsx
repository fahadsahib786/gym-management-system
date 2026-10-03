import { useQuery } from "@tanstack/react-query";
import { Cake, CalendarClock, CircleX, HandCoins, MessageCircle, Send, UserX } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import type { ReminderKind, ReminderRow } from "@/api/bindings";
import { api } from "@/api/client";
import { MemberCell } from "@/components/common/member";
import { EmptyState, ErrorState, LoadingBlock, PageContainer, PageHeader } from "@/components/common/page";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader, CardTitle } from "@/components/ui/primitives";
import { useSettings, useTracksAttendance } from "@/hooks/queries";
import { formatDate, formatDateTime, money, num, phoneDisplay, timeAgo } from "@/lib/format";
import { memberValues, TEMPLATE_INFO, type TemplateKey } from "@/lib/templates";
import { cn } from "@/lib/utils";
import { openDialog } from "@/stores/dialogs";

const QUEUES: {
  kind: ReminderKind;
  label: string;
  icon: typeof Cake;
  template: TemplateKey;
  empty: string;
}[] = [
  {
    kind: "expiring",
    label: "Expiring soon",
    icon: CalendarClock,
    template: "expiryReminder",
    empty: "No membership is about to expire.",
  },
  {
    kind: "expired",
    label: "Expired (30 days)",
    icon: CircleX,
    template: "expiredReminder",
    empty: "No recently expired members.",
  },
  { kind: "dues", label: "Fee due", icon: HandCoins, template: "duesReminder", empty: "Nobody owes fees." },
  {
    kind: "birthday",
    label: "Birthdays",
    icon: Cake,
    template: "birthday",
    empty: "No birthdays in the next 7 days.",
  },
  {
    kind: "inactive",
    label: "Not visiting",
    icon: UserX,
    template: "inactive",
    empty: "All active members are visiting regularly.",
  },
];

/** "today" / "tomorrow" / "in 3 days" */
function inDays(days: number): string {
  return days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
}

function detail(kind: ReminderKind, r: ReminderRow): string {
  const m = r.member;
  switch (kind) {
    case "expiring":
      return `Expires ${inDays(m.daysLeft ?? 0)} · ${formatDate(m.endDate)}`;
    case "expired": {
      const ago = -(m.daysLeft ?? 0);
      return `Expired ${ago <= 1 ? "yesterday" : `${ago} days ago`} · ${formatDate(m.endDate)}`;
    }
    case "dues":
      return `Due ${money(m.balance)}`;
    case "birthday":
      return r.birthdayInDays === 0
        ? "Birthday today 🎂"
        : `Birthday ${inDays(r.birthdayInDays ?? 0)} · ${formatDate(r.dateOfBirth)}`;
    case "inactive":
      return m.lastVisitAt ? `Last visit ${timeAgo(m.lastVisitAt)}` : "Has not visited yet";
  }
}

export function MessagesPage() {
  const settings = useSettings();
  const tracks = useTracksAttendance();
  const queues = QUEUES.filter((q) => tracks || q.kind !== "inactive");
  const [kind, setKind] = useState<ReminderKind>("expiring");
  const counts = useQuery({ queryKey: ["reminder-counts"], queryFn: api.messages.counts });
  const queue = useQuery({ queryKey: ["reminders", kind], queryFn: () => api.messages.queue(kind, 300) });
  const log = useQuery({ queryKey: ["messages", "recent"], queryFn: () => api.messages.list(null, 40) });
  const current = queues.find((q) => q.kind === kind) ?? queues[0];

  const send = (r: ReminderRow) => {
    if (!settings.data) return;
    openDialog({
      type: "whatsapp",
      memberId: r.member.id,
      phone: r.whatsapp ?? r.member.phone,
      template: current.template,
      title: `${current.label}: ${r.member.fullName}`,
      values: memberValues(
        {
          fullName: r.member.fullName,
          memberCode: r.member.memberCode,
          planName: r.member.planName,
          endDate: r.member.endDate,
          daysLeft: r.member.daysLeft,
          balance: r.member.balance,
        },
        settings.data.gym,
      ),
    });
  };

  return (
    <PageContainer>
      <PageHeader
        icon={<MessageCircle />}
        title="WhatsApp reminders"
        description="Ready-made lists of members to message. Each message opens in WhatsApp — just press Send."
        actions={
          <Button variant="outline" asChild>
            <Link to="/settings?tab=whatsapp">Edit message templates</Link>
          </Button>
        }
      />
      <div className={cn("mb-5 grid gap-3 sm:grid-cols-3", tracks ? "xl:grid-cols-5" : "xl:grid-cols-4")}>
        {queues.map((q) => (
          <button
            key={q.kind}
            type="button"
            onClick={() => setKind(q.kind)}
            className={cn(
              "flex items-center gap-3 rounded-xl border bg-card p-4 text-left shadow-xs transition-colors hover:bg-muted/50",
              kind === q.kind && "border-primary/50 ring-2 ring-primary/15",
            )}
          >
            <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <q.icon className="size-5" />
            </span>
            <span>
              <span className="block font-semibold text-xl">
                {counts.data ? num(counts.data[q.kind]) : "·"}
              </span>
              <span className="text-muted-foreground text-sm">{q.label}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="overflow-hidden">
          <CardHeader>
            <div>
              <CardTitle>{current.label}</CardTitle>
              <p className="mt-1 text-muted-foreground text-xs">
                Message: {TEMPLATE_INFO[current.template].label}
              </p>
            </div>
          </CardHeader>
          {queue.isPending ? (
            <LoadingBlock />
          ) : queue.error ? (
            <ErrorState error={queue.error} onRetry={() => queue.refetch()} />
          ) : queue.data.length === 0 ? (
            <EmptyState icon={<current.icon />} title={current.empty} />
          ) : (
            <ul className="divide-y">
              {queue.data.map((r) => {
                const recent =
                  r.lastRemindedAt &&
                  Date.now() - new Date(r.lastRemindedAt.replace(" ", "T")).getTime() < 3 * 86_400_000;
                return (
                  <li
                    key={r.member.id}
                    className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto_auto] items-center gap-4 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <Link to={`/members/${r.member.id}`}>
                        <MemberCell
                          id={r.member.id}
                          name={r.member.fullName}
                          code={r.member.memberCode}
                          photoVersion={r.member.photoVersion}
                          sub={phoneDisplay(r.member.phone)}
                        />
                      </Link>
                    </div>
                    <div className="min-w-0 text-sm">{detail(kind, r)}</div>
                    <div className="text-xs">
                      {r.lastRemindedAt ? (
                        <Badge variant={recent ? "success" : "neutral"}>
                          Reminded {timeAgo(r.lastRemindedAt)}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">Not reminded yet</span>
                      )}
                    </div>
                    <Button size="sm" variant={recent ? "outline" : "whatsapp"} onClick={() => send(r)}>
                      <Send /> {recent ? "Send again" : "Send"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card className="flex max-h-[calc(100vh-14rem)] flex-col overflow-hidden">
          <CardHeader>
            <CardTitle>Recently sent</CardTitle>
          </CardHeader>
          {!log.data?.length ? (
            <EmptyState title="No messages sent yet" className="py-10" />
          ) : (
            <ul className="flex-1 divide-y overflow-y-auto">
              {log.data.map((m) => (
                <li key={m.id} className="px-5 py-2.5">
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{m.memberName ?? phoneDisplay(m.phone)}</span>
                    <span className="shrink-0 text-muted-foreground text-xs">
                      {formatDateTime(m.createdAt)}
                    </span>
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {TEMPLATE_INFO[m.template as TemplateKey]?.label ?? "Custom"}
                    {m.createdByName ? ` · ${m.createdByName}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </PageContainer>
  );
}
