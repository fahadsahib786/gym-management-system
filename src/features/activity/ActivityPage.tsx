import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/api/client";
import { DateRangePicker, type RangeValue, rangeFromPreset } from "@/components/common/date-range";
import { SearchInput } from "@/components/common/fields";
import { EmptyState, ErrorState, LoadingBlock, PageContainer, PageHeader } from "@/components/common/page";
import { Pagination } from "@/components/common/widgets";
import { Select } from "@/components/ui/menus";
import { Badge, type BadgeVariant, Card } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useDebounce } from "@/hooks/common";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const ACTIONS = [
  { value: "", label: "Everything" },
  { value: "payment.", label: "Payments" },
  { value: "charge.", label: "Charges" },
  { value: "member.", label: "Members" },
  { value: "membership.", label: "Memberships & freezes" },
  { value: "attendance.", label: "Check-ins" },
  { value: "measurement.", label: "Measurements" },
  { value: "expense", label: "Expenses" },
  { value: "plan.", label: "Plans & fees" },
  { value: "auth.", label: "Logins" },
  { value: "user.", label: "Users" },
  { value: "settings.", label: "Settings" },
  { value: "backup.", label: "Backups & restore" },
  { value: "data.", label: "Exports" },
];

/** Plain-language names for the recorded actions. */
const LABELS: Record<string, string> = {
  "attendance.delete": "Check-in removed",
  "auth.lockout": "Locked out",
  "auth.login": "Login",
  "backup.restore": "Backup restored",
  "charge.create": "Charge added",
  "charge.void": "Charge voided",
  "data.export": "Export",
  "expense.create": "Expense added",
  "expense.delete": "Expense deleted",
  "expense.update": "Expense edited",
  "expense_category.save": "Expense category",
  "measurement.delete": "Measurement deleted",
  "measurement.save": "Measurement",
  "member.archive": "Member archived",
  "member.delete": "Member deleted",
  "member.photo": "Photo updated",
  "member.photo_remove": "Photo removed",
  "member.register": "New member",
  "member.restore": "Member restored",
  "member.update": "Member edited",
  "membership.cancel": "Membership cancelled",
  "membership.create": "Membership added",
  "membership.edit_dates": "Dates changed",
  "membership.freeze": "Freeze",
  "membership.renew": "Renewal",
  "membership.unfreeze": "Freeze ended",
  "payment.create": "Payment",
  "payment.void": "Receipt voided",
  "plan.create": "Plan added",
  "plan.delete": "Plan deleted",
  "plan.update": "Plan edited",
  "settings.update": "Settings changed",
  "system.setup": "First setup",
  "user.change_pin": "PIN changed",
  "user.create": "User added",
  "user.reset_pin": "PIN reset",
  "user.update": "User edited",
};

function actionLabel(action: string): string {
  const known = LABELS[action];
  if (known) return known;
  const words = action.replace(/[._]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function tone(action: string): BadgeVariant {
  if (
    action.endsWith(".void") ||
    action.endsWith(".delete") ||
    action.endsWith(".cancel") ||
    action === "auth.lockout"
  )
    return "danger";
  if (action.startsWith("payment.") || action.startsWith("charge.")) return "success";
  if (action.startsWith("membership.") || action === "member.register") return "info";
  if (action.startsWith("settings.") || action.startsWith("user.") || action.startsWith("backup."))
    return "upcoming";
  return "neutral";
}

export function ActivityPage() {
  const [range, setRange] = useState<RangeValue>(rangeFromPreset("last7"));
  const [action, setAction] = useState("");
  const [userId, setUserId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounce(search.trim(), 200);
  const users = useQuery({ queryKey: ["users", true], queryFn: () => api.users.list(true) });
  const query = useMemo(
    () => ({
      from: range.from,
      to: range.to,
      action: action || null,
      userId: userId || null,
      search: q || null,
      page,
      pageSize: 60,
    }),
    [range, action, userId, q, page],
  );
  const list = useQuery({
    queryKey: ["audit", query],
    queryFn: () => api.audit.list(query),
    placeholderData: keepPreviousData,
  });

  return (
    <PageContainer>
      <PageHeader
        icon={<ScrollText />}
        title="Activity log"
        description="Who did what and when. Entries cannot be edited or deleted — it protects the owner and honest staff."
      />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <DateRangePicker
            value={range}
            onChange={(v) => {
              setRange(v);
              setPage(1);
            }}
          />
          <Select
            className="w-52"
            aria-label="Type"
            value={action || "__all"}
            onValueChange={(v) => {
              setAction(v === "__all" ? "" : v);
              setPage(1);
            }}
            options={ACTIONS.map((a) => ({ value: a.value || "__all", label: a.label }))}
          />
          <Select
            className="w-44"
            aria-label="User"
            value={userId || "__all"}
            onValueChange={(v) => {
              setUserId(v === "__all" ? "" : v);
              setPage(1);
            }}
            options={[
              { value: "__all", label: "All users" },
              ...(users.data ?? []).map((u) => ({ value: u.id, label: u.name })),
            ]}
          />
          <SearchInput
            wrapperClassName="w-80"
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search member, receipt, amount…"
          />
        </div>
        {list.isPending ? (
          <LoadingBlock />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <EmptyState icon={<ScrollText />} title="Nothing recorded for these filters" />
        ) : (
          <>
            <Table className={cn(list.isPlaceholderData && "opacity-60")}>
              <THead>
                <tr>
                  <TH className="w-36">When</TH>
                  <TH className="w-36">Who</TH>
                  <TH className="w-40">Type</TH>
                  <TH>What happened</TH>
                </tr>
              </THead>
              <TBody>
                {list.data.items.map((a) => (
                  <TR key={a.id}>
                    <TD className="whitespace-nowrap">
                      {formatDate(a.at)}
                      <div className="text-muted-foreground text-xs">{formatTime(a.at)}</div>
                    </TD>
                    <TD className="font-medium">{a.userName ?? "System"}</TD>
                    <TD>
                      <Badge variant={tone(a.action)}>{actionLabel(a.action)}</Badge>
                    </TD>
                    <TD className="text-sm">{a.summary}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </PageContainer>
  );
}
