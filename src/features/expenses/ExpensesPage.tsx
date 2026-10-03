import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, Pencil, Plus, Receipt, Trash } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Expense } from "@/api/bindings";
import { api } from "@/api/client";
import { errorMessage } from "@/api/errors";
import { DateRangePicker, type RangeValue, rangeFromPreset } from "@/components/common/date-range";
import { Field, MoneyInput, SearchInput } from "@/components/common/fields";
import { EmptyState, ErrorState, LoadingBlock, PageContainer, PageHeader } from "@/components/common/page";
import { ConfirmDialog, Pagination } from "@/components/common/widgets";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/menus";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useDebounce } from "@/hooks/common";
import { useExpenseCategories, useSettings } from "@/hooks/queries";
import { formatDate, money, num, percent, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCan } from "@/stores/session";

function ExpenseDialog({
  expense,
  onOpenChange,
}: {
  expense: Expense | null;
  onOpenChange: (o: boolean) => void;
}) {
  const categories = useExpenseCategories(false);
  const settings = useSettings();
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? "");
  const [amount, setAmount] = useState(expense?.amount ?? 0);
  const [date, setDate] = useState(expense?.expenseDate ?? todayISO());
  const [method, setMethod] = useState(expense?.method ?? "Cash");
  const [payee, setPayee] = useState(expense?.payee ?? "");
  const [description, setDescription] = useState(expense?.description ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!categoryId && categories.data?.length) setCategoryId(categories.data[0].id);
  }, [categories.data, categoryId]);

  const submit = async () => {
    setBusy(true);
    try {
      await api.expenses.save({
        id: expense?.id ?? null,
        categoryId,
        amount,
        expenseDate: date,
        method,
        payee: payee.trim() || null,
        description: description.trim() || null,
      });
      toast.success(expense ? "Expense updated" : "Expense added");
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{expense ? "Edit expense" : "Add expense"}</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" required>
            <Select
              value={categoryId}
              onValueChange={setCategoryId}
              options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            />
          </Field>
          <Field label="Amount" required>
            <MoneyInput value={amount} onChange={setAmount} autoFocus />
          </Field>
          <Field label="Date">
            <DateField value={date} onChange={setDate} max={todayISO()} />
          </Field>
          <Field label="Paid by">
            <Select
              value={method}
              onValueChange={setMethod}
              options={(settings.data?.billing.paymentMethods ?? ["Cash"]).map((m) => ({
                value: m,
                label: m,
              }))}
            />
          </Field>
          <Field label="Paid to" hint="e.g. MEPCO, landlord, trainer name" className="sm:col-span-2">
            <Input value={payee} onChange={(e) => setPayee(e.target.value)} />
          </Field>
          <Field label="Details" className="sm:col-span-2">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!categoryId || amount <= 0}>
            {expense ? "Save" : "Add expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ExpensesPage() {
  const canManage = useCan("manageExpenses");
  const canExport = useCan("exportData");
  const categories = useExpenseCategories(true);
  const [range, setRange] = useState<RangeValue>(rangeFromPreset("month"));
  const [categoryId, setCategoryId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Expense | null | "new">(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const q = useDebounce(search.trim(), 160);
  const query = useMemo(
    () => ({
      from: range.from,
      to: range.to,
      categoryId: categoryId || null,
      search: q || null,
      page,
      pageSize: 50,
    }),
    [range, categoryId, q, page],
  );
  const list = useQuery({
    queryKey: ["expenses", query],
    queryFn: () => api.expenses.list(query),
    placeholderData: keepPreviousData,
  });

  const exportCsv = async () => {
    const path = await save({
      defaultPath: `expenses-${range.from}-to-${range.to}.csv`,
      filters: [{ name: "CSV (Excel)", extensions: ["csv"] }],
    });
    if (!path) return;
    try {
      const r = await api.exports.csv({ kind: "expenses", from: range.from, to: range.to, path });
      toast.success(`Exported ${num(r.rows)} expenses`, {
        action: { label: "Show file", onClick: () => void api.app.revealFile(r.path) },
      });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const data = list.data;
  const maxCat = Math.max(1, ...(data?.byCategory.map((c) => c.total) ?? [1]));
  return (
    <PageContainer>
      <PageHeader
        icon={<Receipt />}
        title="Expenses"
        description="Rent, electricity, salaries and every other cost — needed for real profit figures."
        actions={
          <>
            {canExport && (
              <Button variant="outline" onClick={exportCsv}>
                <Download /> Export
              </Button>
            )}
            {canManage && (
              <Button onClick={() => setEditing("new")}>
                <Plus /> Add expense
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
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
              className="w-48"
              aria-label="Category"
              value={categoryId || "__all"}
              onValueChange={(v) => {
                setCategoryId(v === "__all" ? "" : v);
                setPage(1);
              }}
              options={[
                { value: "__all", label: "All categories" },
                ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <SearchInput
              wrapperClassName="w-56"
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="Search…"
            />
          </div>
          {list.isPending ? (
            <LoadingBlock />
          ) : list.error ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : data && data.items.length === 0 ? (
            <EmptyState
              icon={<Receipt />}
              title="No expenses in this period"
              action={
                canManage && (
                  <Button onClick={() => setEditing("new")}>
                    <Plus /> Add expense
                  </Button>
                )
              }
            />
          ) : (
            data && (
              <>
                <Table className={cn(list.isPlaceholderData && "opacity-60")}>
                  <THead>
                    <tr>
                      <TH>Date</TH>
                      <TH>Category</TH>
                      <TH>Paid to / details</TH>
                      <TH>Method</TH>
                      <TH className="text-right">Amount</TH>
                      {canManage && <TH />}
                    </tr>
                  </THead>
                  <TBody>
                    {data.items.map((e) => (
                      <TR key={e.id}>
                        <TD className="whitespace-nowrap">{formatDate(e.expenseDate)}</TD>
                        <TD>
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="size-2.5 rounded-full"
                              style={{ background: e.categoryColor ?? "var(--muted-foreground)" }}
                            />
                            {e.categoryName}
                          </span>
                        </TD>
                        <TD className="max-w-72">
                          <div className="truncate">{e.payee ?? "—"}</div>
                          {e.description && (
                            <div className="truncate text-muted-foreground text-xs">{e.description}</div>
                          )}
                        </TD>
                        <TD className="text-sm">{e.method}</TD>
                        <TD className="text-right font-semibold tabular">{money(e.amount)}</TD>
                        {canManage && (
                          <TD className="whitespace-nowrap text-right">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setEditing(e)}
                              aria-label="Edit"
                            >
                              <Pencil />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setDeleting(e)}
                              aria-label="Delete"
                            >
                              <Trash />
                            </Button>
                          </TD>
                        )}
                      </TR>
                    ))}
                  </TBody>
                </Table>
                <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
              </>
            )
          )}
        </Card>
        <Card className="self-start">
          <CardHeader>
            <div>
              <CardTitle>Total {money(data?.totalAmount ?? 0)}</CardTitle>
              <p className="mt-1 text-muted-foreground text-xs">
                {formatDate(range.from)} – {formatDate(range.to)}
              </p>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {(data?.byCategory ?? []).length === 0 && (
              <p className="text-muted-foreground text-sm">Nothing recorded.</p>
            )}
            {data?.byCategory.map((c) => (
              <button
                key={c.categoryId}
                type="button"
                className="flex flex-col gap-1 text-left"
                onClick={() => {
                  setCategoryId(categoryId === c.categoryId ? "" : c.categoryId);
                  setPage(1);
                }}
              >
                <div className="flex justify-between gap-2 text-sm">
                  <span className={cn(categoryId === c.categoryId && "font-semibold")}>{c.name}</span>
                  <span className="tabular">
                    {money(c.total)}{" "}
                    <span className="text-muted-foreground text-xs">
                      {percent(c.total, data.totalAmount)}
                    </span>
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-chart-1"
                    style={{ width: `${(c.total / maxCat) * 100}%` }}
                  />
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>
      {editing && (
        <ExpenseDialog
          expense={editing === "new" ? null : editing}
          onOpenChange={(o) => !o && setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this expense?"
        description={
          deleting
            ? `${deleting.categoryName} · ${money(deleting.amount)} on ${formatDate(deleting.expenseDate)}`
            : ""
        }
        confirmLabel="Delete"
        destructive
        requireReason
        onConfirm={async (reason) => {
          if (!deleting) return;
          try {
            await api.expenses.remove(deleting.id, reason);
            toast.success("Expense deleted");
          } catch (e) {
            toast.error(errorMessage(e));
            throw e;
          }
        }}
      />
    </PageContainer>
  );
}
