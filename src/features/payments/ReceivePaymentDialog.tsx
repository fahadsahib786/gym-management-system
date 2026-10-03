import { useQuery } from "@tanstack/react-query";
import { MessageCircle, Printer, RefreshCw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { MemberQuick } from "@/api/bindings";
import { api } from "@/api/client";
import { errorMessage } from "@/api/errors";
import { Field, MoneyInput } from "@/components/common/fields";
import { MemberPicker, MemberSummary } from "@/components/common/member-picker";
import { Button } from "@/components/ui/button";
import { DateField, quickDates } from "@/components/ui/date-field";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/menus";
import { useSettings } from "@/hooks/queries";
import { money, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { openDialog } from "@/stores/dialogs";
import { useCan } from "@/stores/session";
import { whatsappForReceipt } from "./followups";

type Action = "save" | "print" | "whatsapp";

export function ReceivePaymentDialog({
  memberId,
  onOpenChange,
}: {
  memberId?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const settings = useSettings();
  const canBackdate = useCan("backdatePayments");
  const canRenew = useCan("renewMemberships");
  const [selectedId, setSelectedId] = useState<string | undefined>(memberId);
  const member = useQuery({
    queryKey: ["member-quick", selectedId],
    queryFn: () => api.members.quick(selectedId as string),
    enabled: !!selectedId,
  });
  const [amount, setAmount] = useState(0);
  const [touched, setTouched] = useState(false);
  const [method, setMethod] = useState("Cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [paidOn, setPaidOn] = useState(todayISO());
  const [busy, setBusy] = useState<Action | null>(null);

  useEffect(() => {
    if (settings.data) setMethod(settings.data.billing.paymentMethods[0] ?? "Cash");
  }, [settings.data]);
  useEffect(() => {
    if (member.data && !touched) setAmount(Math.max(0, member.data.balance));
  }, [member.data, touched]);

  const pick = (m: MemberQuick) => {
    setSelectedId(m.id);
    setTouched(false);
  };

  const m = member.data;
  const after = (m?.balance ?? 0) - amount;
  const methods = settings.data?.billing.paymentMethods ?? ["Cash"];
  const expiredNoDues = m && (m.status === "expired" || m.status === "none") && m.balance <= 0;

  const save = async (action: Action) => {
    if (!m || amount <= 0) return;
    setBusy(action);
    try {
      const result = await api.payments.record({
        memberId: m.id,
        amount,
        method,
        reference: reference.trim() || null,
        note: note.trim() || null,
        paidAt: canBackdate && paidOn !== todayISO() ? paidOn : null,
        subscriptionId: null,
      });
      toast.success(`Received ${money(amount)} from ${m.fullName}`, {
        description: `Receipt ${result.receiptNo}${result.balanceAfter > 0 ? ` · still due ${money(result.balanceAfter)}` : ""}`,
      });
      onOpenChange(false);
      if (action === "print") openDialog({ type: "receipt", paymentId: result.paymentId, autoPrint: true });
      if (action === "whatsapp" && settings.data) {
        const receipt = await api.payments.receipt(result.paymentId);
        whatsappForReceipt(receipt, settings.data);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Receive payment</DialogTitle>
          <DialogDescription>Fee dues, advance payments or any outstanding balance.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {!selectedId ? (
            <MemberPicker onPick={pick} />
          ) : !m ? (
            <div className="h-16 animate-pulse rounded-xl bg-muted" />
          ) : (
            <>
              <MemberSummary member={m} onChange={memberId ? undefined : () => setSelectedId(undefined)} />
              <div
                className={cn(
                  "flex items-center justify-between rounded-lg px-3 py-2 text-sm",
                  m.balance > 0 ? "bg-danger-soft text-danger-ink" : "bg-muted text-muted-foreground",
                )}
              >
                <span>
                  {m.balance > 0
                    ? "Current balance due"
                    : m.balance < 0
                      ? "Advance already paid"
                      : "No balance due"}
                </span>
                <span className="font-semibold tabular">{money(Math.abs(m.balance))}</span>
              </div>
              {expiredNoDues && canRenew && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-ink">
                  <span>Membership has ended. To take next month's fee, renew the membership.</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      onOpenChange(false);
                      openDialog({ type: "renew", memberId: m.id });
                    }}
                  >
                    <RefreshCw /> Renew
                  </Button>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Amount received" required>
                  <MoneyInput
                    autoFocus
                    value={amount}
                    onChange={(v) => {
                      setAmount(v);
                      setTouched(true);
                    }}
                  />
                </Field>
                <Field label="Method">
                  <Select
                    value={method}
                    onValueChange={setMethod}
                    options={methods.map((x) => ({ value: x, label: x }))}
                  />
                </Field>
                {method.toLowerCase() !== "cash" && (
                  <Field label="Transaction ID / reference" hint="Optional">
                    <Input value={reference} onChange={(e) => setReference(e.target.value)} />
                  </Field>
                )}
                {canBackdate && (
                  <Field
                    label="Payment date"
                    hint={paidOn !== todayISO() ? "Past date (admin only)" : undefined}
                  >
                    <DateField
                      value={paidOn}
                      onChange={setPaidOn}
                      max={todayISO()}
                      quick={quickDates(0, -1)}
                    />
                  </Field>
                )}
                <Field label="Note" className="sm:col-span-2">
                  <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
                </Field>
              </div>
              {amount > 0 && (
                <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">After this payment</span>
                  <span
                    className={cn(
                      "font-semibold",
                      after > 0 ? "text-danger-ink" : after < 0 ? "text-info-ink" : "text-success-ink",
                    )}
                  >
                    {after > 0
                      ? `Still due ${money(after)}`
                      : after < 0
                        ? `Advance ${money(-after)}`
                        : "Fully paid"}
                  </span>
                </div>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="whatsapp"
            onClick={() => save("whatsapp")}
            disabled={!m || amount <= 0 || !!busy}
            loading={busy === "whatsapp"}
          >
            <MessageCircle /> Save & WhatsApp
          </Button>
          <Button
            variant="outline"
            onClick={() => save("print")}
            disabled={!m || amount <= 0 || !!busy}
            loading={busy === "print"}
          >
            <Printer /> Save & print
          </Button>
          <Button
            onClick={() => save("save")}
            disabled={!m || amount <= 0 || !!busy}
            loading={busy === "save"}
          >
            <Save /> Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
