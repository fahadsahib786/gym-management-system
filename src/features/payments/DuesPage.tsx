import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, FileDown, HandCoins, MessageCircle, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import type { DueRow } from "@/api/bindings";
import { api } from "@/api/client";
import { errorMessage } from "@/api/errors";
import { SearchInput } from "@/components/common/fields";
import { MemberCell, StatusBadge } from "@/components/common/member";
import { EmptyState, ErrorState, LoadingBlock, PageContainer, PageHeader } from "@/components/common/page";
import { Pagination, StatCard } from "@/components/common/widgets";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/menus";
import { Card } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useDebounce } from "@/hooks/common";
import { useSettings } from "@/hooks/queries";
import { formatDate, money, num, phoneDisplay, plural, timeAgo, todayISO } from "@/lib/format";
import { memberValues } from "@/lib/templates";
import { cn } from "@/lib/utils";
import { openDialog } from "@/stores/dialogs";
import { useCan } from "@/stores/session";
import { saveInvoicePdf } from "./invoice";

export function DuesPage() {
  const navigate = useNavigate();
  const settings = useSettings();
  const canExport = useCan("exportData");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"amount" | "age" | "name">("amount");
  const [page, setPage] = useState(1);
  const q = useDebounce(search.trim(), 160);
  const query = useMemo(() => ({ search: q || null, sort, page, pageSize: 40 }), [q, sort, page]);
  const dues = useQuery({
    queryKey: ["dues", query],
    queryFn: () => api.dues.list(query),
    placeholderData: keepPreviousData,
  });

  const remind = (d: DueRow) => {
    if (!settings.data) return;
    openDialog({
      type: "whatsapp",
      memberId: d.member.id,
      phone: d.member.phone,
      template: "duesReminder",
      title: `Fee reminder to ${d.member.fullName}`,
      values: memberValues(
        {
          fullName: d.member.fullName,
          memberCode: d.member.memberCode,
          planName: d.member.planName,
          endDate: d.member.endDate,
          daysLeft: d.member.daysLeft,
          balance: d.member.balance,
        },
        settings.data.gym,
      ),
    });
  };

  const exportCsv = async () => {
    const path = await save({
      defaultPath: `fee-dues-${todayISO()}.csv`,
      filters: [{ name: "CSV (Excel)", extensions: ["csv"] }],
    });
    if (!path) return;
    try {
      const r = await api.exports.csv({ kind: "dues", path });
      toast.success(`Exported ${num(r.rows)} members with dues`, {
        action: { label: "Show file", onClick: () => void api.app.revealFile(r.path) },
      });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const data = dues.data;
  const aging = data?.aging;
  return (
    <PageContainer>
      <PageHeader
        icon={<HandCoins />}
        title="Fee dues"
        description="Members who owe money, oldest unpaid fee first in the ageing."
        actions={
          canExport && (
            <Button variant="outline" onClick={exportCsv}>
              <Download /> Export
            </Button>
          )
        }
      />
      {data && aging && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard
            label="Total due"
            value={money(data.totalAmount)}
            tone="danger"
            icon={<HandCoins />}
            hint={`${num(data.total)} members`}
          />
          <StatCard label="0–30 days" value={money(aging.d030)} hint="Recent" />
          <StatCard
            label="31–60 days"
            value={money(aging.d3160)}
            tone={aging.d3160 > 0 ? "warning" : "default"}
          />
          <StatCard
            label="61–90 days"
            value={money(aging.d6190)}
            tone={aging.d6190 > 0 ? "warning" : "default"}
          />
          <StatCard
            label="Over 90 days"
            value={money(aging.d90Plus)}
            tone={aging.d90Plus > 0 ? "danger" : "default"}
            hint="Hard to recover"
          />
        </div>
      )}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <SearchInput
            wrapperClassName="w-72"
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search name, phone or ID…"
          />
          <Segmented
            value={sort}
            onChange={(v) => {
              setSort(v);
              setPage(1);
            }}
            options={[
              { value: "amount", label: "Highest due" },
              { value: "age", label: "Oldest due" },
              { value: "name", label: "Name" },
            ]}
          />
        </div>
        {dues.isPending ? (
          <LoadingBlock />
        ) : dues.error ? (
          <ErrorState error={dues.error} onRetry={() => dues.refetch()} />
        ) : data && data.items.length === 0 ? (
          <EmptyState
            icon={<HandCoins />}
            title={q ? "No member with dues matches your search" : "No dues — everyone has paid 🎉"}
          />
        ) : (
          data && (
            <>
              <Table className={cn(dues.isPlaceholderData && "opacity-60")}>
                <THead>
                  <tr>
                    <TH>Member</TH>
                    <TH>Phone</TH>
                    <TH className="text-right">Due</TH>
                    <TH>Unpaid since</TH>
                    <TH>Last payment</TH>
                    <TH>Membership</TH>
                    <TH />
                  </tr>
                </THead>
                <TBody>
                  {data.items.map((d) => (
                    <TR key={d.member.id} interactive onClick={() => navigate(`/members/${d.member.id}`)}>
                      <TD>
                        <MemberCell
                          id={d.member.id}
                          name={d.member.fullName}
                          code={d.member.memberCode}
                          photoVersion={d.member.photoVersion}
                        />
                      </TD>
                      <TD className="tabular">{phoneDisplay(d.member.phone)}</TD>
                      <TD className="text-right font-semibold text-danger-ink tabular">
                        {money(d.member.balance)}
                      </TD>
                      <TD>
                        {formatDate(d.oldestDueDate)}
                        <div
                          className={cn(
                            "text-xs",
                            d.ageDays > 60 ? "font-medium text-danger-ink" : "text-muted-foreground",
                          )}
                        >
                          {d.ageDays === 0 ? "Today" : `${plural(d.ageDays, "day")} ago`}
                        </div>
                      </TD>
                      <TD className="text-muted-foreground text-sm">
                        {d.lastPaymentAt ? timeAgo(d.lastPaymentAt) : "Never"}
                      </TD>
                      <TD>
                        <StatusBadge status={d.member.status} />
                      </TD>
                      <TD className="whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Invoice PDF"
                          title="Invoice PDF"
                          onClick={() => settings.data && void saveInvoicePdf(d.member.id, settings.data)}
                        >
                          <FileDown />
                        </Button>{" "}
                        <Button size="sm" variant="outline" onClick={() => remind(d)}>
                          <MessageCircle /> Remind
                        </Button>{" "}
                        <Button
                          size="sm"
                          onClick={() => openDialog({ type: "payment", memberId: d.member.id })}
                        >
                          <Wallet /> Collect
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
            </>
          )
        )}
      </Card>
    </PageContainer>
  );
}
