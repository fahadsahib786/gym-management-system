import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import { Ban, Download, MessageCircle, Printer, RefreshCw, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import type { PaymentRow } from "@/api/bindings";
import { api } from "@/api/client";
import { errorMessage } from "@/api/errors";
import { DateRangePicker, type RangeValue, rangeFromPreset } from "@/components/common/date-range";
import { SearchInput } from "@/components/common/fields";
import { EmptyState, ErrorState, LoadingBlock, PageContainer, PageHeader } from "@/components/common/page";
import { ConfirmDialog, Pagination } from "@/components/common/widgets";
import { Button } from "@/components/ui/button";
import { Select, Switch } from "@/components/ui/menus";
import { Badge, Card } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useDebounce } from "@/hooks/common";
import { useSettings } from "@/hooks/queries";
import { formatDate, formatTime, money, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { openDialog } from "@/stores/dialogs";
import { useCan } from "@/stores/session";
import { whatsappForReceipt } from "./followups";

export function PaymentsPage() {
  const settings = useSettings();
  const canVoid = useCan("voidPayments");
  const canExport = useCan("exportData");
  const canRevenue = useCan("viewRevenue");
  const canUsers = useCan("manageUsers");
  const [range, setRange] = useState<RangeValue>(rangeFromPreset("today"));
  const [method, setMethod] = useState("");
  const [staff, setStaff] = useState("");
  const [search, setSearch] = useState("");
  const [includeVoided, setIncludeVoided] = useState(true);
  const [page, setPage] = useState(1);
  const [voiding, setVoiding] = useState<PaymentRow | null>(null);
  const q = useDebounce(search.trim(), 160);
  const users = useQuery({
    queryKey: ["users", true],
    queryFn: () => api.users.list(true),
    enabled: canUsers,
  });

  const query = useMemo(
    () => ({
      from: range.from,
      to: range.to,
      method: method || null,
      receivedBy: staff || null,
      search: q || null,
      includeVoided,
      page,
      pageSize: 50,
    }),
    [range, method, staff, q, includeVoided, page],
  );
  const list = useQuery({
    queryKey: ["payments", query],
    queryFn: () => api.payments.list(query),
    placeholderData: keepPreviousData,
  });

  const exportCsv = async () => {
    const path = await save({
      defaultPath: `payments-${range.from}-to-${range.to}.csv`,
      filters: [{ name: "CSV (Excel)", extensions: ["csv"] }],
    });
    if (!path) return;
    try {
      const r = await api.exports.csv({ kind: "payments", from: range.from, to: range.to, path });
      toast.success(`Exported ${num(r.rows)} payments`, {
        action: { label: "Show file", onClick: () => void api.app.revealFile(r.path) },
      });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const sendReceipt = async (p: PaymentRow) => {
    if (!settings.data) return;
    try {
      whatsappForReceipt(await api.payments.receipt(p.id), settings.data);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const data = list.data;
  return (
    <PageContainer>
      <PageHeader
        icon={<Wallet />}
        title="Payments"
        description="Every fee received, with receipt numbers. Voided receipts stay visible for checking."
        actions={
          <>
            {canExport && canRevenue && (
              <Button variant="outline" onClick={exportCsv}>
                <Download /> Export
              </Button>
            )}
            <Button onClick={() => openDialog({ type: "payment" })}>
              <Wallet /> Receive payment
            </Button>
          </>
        }
      />

      {data && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="p-4">
            <div className="text-muted-foreground text-xs">Total received</div>
            <div className="mt-1 font-semibold text-2xl">{money(data.sumAmount)}</div>
            <div className="mt-1 text-muted-foreground text-xs">
              {num(data.total - (includeVoided ? data.voidedCount : 0))} payments
            </div>
          </Card>
          <Card className="p-4 sm:col-span-1 xl:col-span-2">
            <div className="text-muted-foreground text-xs">By method</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {data.byMethod.length === 0 && <span className="text-muted-foreground text-sm">—</span>}
              {data.byMethod.map((m) => (
                <button
                  key={m.method}
                  type="button"
                  onClick={() => {
                    setMethod(method === m.method ? "" : m.method);
                    setPage(1);
                  }}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                    method === m.method && "border-primary/40 bg-accent text-accent-foreground",
                  )}
                >
                  <div className="font-semibold tabular">{money(m.total)}</div>
                  <div className="text-muted-foreground text-xs">
                    {m.method} · {num(m.count)}
                  </div>
                </button>
              ))}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-muted-foreground text-xs">Voided (corrections)</div>
            <div className="mt-1 font-semibold text-2xl">{num(data.voidedCount)}</div>
            <div className="mt-1 text-muted-foreground text-xs">{money(data.voidedAmount)} not counted</div>
          </Card>
        </div>
      )}

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
            className="w-40"
            aria-label="Method"
            value={method || "__all"}
            onValueChange={(v) => {
              setMethod(v === "__all" ? "" : v);
              setPage(1);
            }}
            options={[
              { value: "__all", label: "All methods" },
              ...(settings.data?.billing.paymentMethods ?? []).map((m) => ({ value: m, label: m })),
            ]}
          />
          {canUsers && (
            <Select
              className="w-44"
              aria-label="Received by"
              value={staff || "__all"}
              onValueChange={(v) => {
                setStaff(v === "__all" ? "" : v);
                setPage(1);
              }}
              options={[
                { value: "__all", label: "All staff" },
                ...(users.data ?? []).map((u) => ({ value: u.id, label: u.name })),
              ]}
            />
          )}
          <SearchInput
            wrapperClassName="w-64"
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Receipt #, member, phone, TID…"
          />
          <label className="ml-auto flex items-center gap-2 text-muted-foreground text-sm">
            <Switch checked={includeVoided} onCheckedChange={setIncludeVoided} /> Show voided
          </label>
          {list.isFetching && !list.isPending && (
            <RefreshCw className="size-4 animate-spin text-muted-foreground" />
          )}
        </div>
        {data?.visibleFrom && (
          <div className="border-b bg-muted/50 px-5 py-2 text-muted-foreground text-xs">
            You can see payments from {formatDate(data.visibleFrom)} onwards. Ask the owner for older records.
          </div>
        )}
        {list.isPending ? (
          <LoadingBlock />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : data && data.items.length === 0 ? (
          <EmptyState icon={<Wallet />} title="No payments in this period" />
        ) : (
          data && (
            <>
              <Table className={cn(list.isPlaceholderData && "opacity-60")}>
                <THead>
                  <tr>
                    <TH>Receipt</TH>
                    <TH>Date</TH>
                    <TH>Member</TH>
                    <TH>For</TH>
                    <TH>Method</TH>
                    <TH className="text-right">Amount</TH>
                    <TH>Received by</TH>
                    <TH />
                  </tr>
                </THead>
                <TBody>
                  {data.items.map((p) => (
                    <TR key={p.id} className={cn(p.voidedAt && "text-muted-foreground")}>
                      <TD className="font-medium tabular">
                        <span className={cn(p.voidedAt && "line-through")}>{p.receiptNo}</span>
                        {p.voidedAt && (
                          <Badge variant="danger" className="ml-2" title={p.voidReason ?? ""}>
                            VOID
                          </Badge>
                        )}
                      </TD>
                      <TD className="whitespace-nowrap">
                        {formatDate(p.paidAt)}
                        <div className="text-muted-foreground text-xs">{formatTime(p.paidAt)}</div>
                      </TD>
                      <TD>
                        <Link to={`/members/${p.memberId}`} className="font-medium hover:underline">
                          {p.memberName}
                        </Link>
                        <div className="text-muted-foreground text-xs">{p.memberCode}</div>
                      </TD>
                      <TD className="max-w-48 truncate text-sm">{p.planName ?? p.note ?? "Balance"}</TD>
                      <TD className="text-sm">
                        {p.method}
                        {p.reference && (
                          <div className="max-w-32 truncate text-muted-foreground text-xs">{p.reference}</div>
                        )}
                      </TD>
                      <TD className={cn("text-right font-semibold tabular", p.voidedAt && "line-through")}>
                        {money(p.amount)}
                      </TD>
                      <TD className="text-sm">{p.receivedByName ?? "—"}</TD>
                      <TD className="whitespace-nowrap text-right">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="Receipt"
                          aria-label="Receipt"
                          onClick={() => openDialog({ type: "receipt", paymentId: p.id })}
                        >
                          <Printer />
                        </Button>
                        {!p.voidedAt && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title="WhatsApp receipt"
                            aria-label="WhatsApp receipt"
                            onClick={() => sendReceipt(p)}
                          >
                            <MessageCircle />
                          </Button>
                        )}
                        {canVoid && !p.voidedAt && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title="Void (mistake)"
                            aria-label="Void"
                            onClick={() => setVoiding(p)}
                          >
                            <Ban />
                          </Button>
                        )}
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
      <ConfirmDialog
        open={!!voiding}
        onOpenChange={(o) => !o && setVoiding(null)}
        title={`Void receipt ${voiding?.receiptNo ?? ""}?`}
        description={`${voiding ? money(voiding.amount) : ""} from ${voiding?.memberName ?? ""} will no longer count. Use only for mistakes — the receipt stays on record marked VOID.`}
        confirmLabel="Void payment"
        destructive
        requireReason
        onConfirm={async (reason) => {
          if (!voiding) return;
          try {
            await api.payments.void(voiding.id, reason);
            toast.success("Payment voided");
          } catch (e) {
            toast.error(errorMessage(e));
            throw e;
          }
        }}
      />
    </PageContainer>
  );
}
