import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Info, MessageCircle, Printer, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { errorMessage } from "@/api/errors";
import { Field, MoneyInput } from "@/components/common/fields";
import { MemberSummary } from "@/components/common/member-picker";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
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
import { Select, Switch } from "@/components/ui/menus";
import { Separator } from "@/components/ui/primitives";
import { whatsappForReceipt } from "@/features/payments/followups";
import { usePlans, useSettings } from "@/hooks/queries";
import { formatDate, money } from "@/lib/format";
import { planEnd } from "@/lib/plans";
import { memberValues } from "@/lib/templates";
import { cn } from "@/lib/utils";
import { openDialog } from "@/stores/dialogs";
import { useCan } from "@/stores/session";

type Action = "save" | "print" | "whatsapp";

export function RenewDialog({
  memberId,
  onOpenChange,
}: {
  memberId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const settings = useSettings();
  const plans = usePlans(false);
  const canPay = useCan("recordPayments");
  const member = useQuery({
    queryKey: ["member-quick", memberId],
    queryFn: () => api.members.quick(memberId),
  });
  const [planId, setPlanId] = useState<string | null>(null);
  const preview = useQuery({
    queryKey: ["renew-preview", memberId, planId],
    queryFn: () => api.memberships.preview(memberId, planId),
    placeholderData: (prev) => prev,
  });
  const [startDate, setStartDate] = useState("");
  const [startTouched, setStartTouched] = useState(false);
  const [endDate, setEndDate] = useState("");
  const [endTouched, setEndTouched] = useState(false);
  const [fee, setFee] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [includeDues, setIncludeDues] = useState(true);
  const [paid, setPaid] = useState(0);
  const [paidTouched, setPaidTouched] = useState(false);
  const [method, setMethod] = useState("Cash");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState<Action | null>(null);

  const p = preview.data;
  const plan = plans.data?.find((x) => x.id === (planId ?? p?.planId));

  useEffect(() => {
    if (p && !planId && p.planId) setPlanId(p.planId);
  }, [p, planId]);
  useEffect(() => {
    if (p && !startTouched) setStartDate(p.startDate);
  }, [p, startTouched]);
  useEffect(() => {
    if (plan) setFee(plan.price);
  }, [plan]);
  useEffect(() => {
    if (!endTouched) setEndDate(planEnd(startDate, plan));
  }, [startDate, plan, endTouched]);
  useEffect(() => {
    if (settings.data) setMethod(settings.data.billing.paymentMethods[0] ?? "Cash");
  }, [settings.data]);

  const previousDue = Math.max(0, p?.balance ?? 0);
  const advance = Math.max(0, -(p?.balance ?? 0));
  const net = Math.max(0, fee - discount);
  const suggested = Math.max(0, net + (includeDues ? previousDue : 0) - advance);
  useEffect(() => {
    if (!paidTouched) setPaid(suggested);
  }, [suggested, paidTouched]);
  const after = net + previousDue - advance - paid;

  const planOptions = useMemo(
    () => (plans.data ?? []).map((x) => ({ value: x.id, label: `${x.name} — ${money(x.price)}` })),
    [plans.data],
  );

  const save = async (action: Action) => {
    if (!plan || !member.data) return;
    setBusy(action);
    try {
      const r = await api.memberships.renew({
        memberId,
        planId: plan.id,
        startDate,
        endDate: endTouched ? endDate : null,
        price: fee !== plan.price ? fee : null,
        discount,
        notes: null,
        payment:
          canPay && paid > 0
            ? { amount: paid, method, reference: reference.trim() || null, note: null, paidAt: null }
            : null,
      });
      toast.success(`Renewed till ${formatDate(r.endDate)}`, {
        description: r.payment
          ? `Receipt ${r.payment.receiptNo}${r.balanceAfter > 0 ? ` · due ${money(r.balanceAfter)}` : ""}`
          : `Fee ${money(r.netAmount)} added to balance`,
      });
      onOpenChange(false);
      if (action === "print" && r.payment)
        openDialog({ type: "receipt", paymentId: r.payment.paymentId, autoPrint: true });
      if (action === "whatsapp" && settings.data) {
        if (r.payment) {
          whatsappForReceipt(await api.payments.receipt(r.payment.paymentId), settings.data, "renewal");
        } else {
          openDialog({
            type: "whatsapp",
            memberId,
            phone: member.data.phone,
            template: "renewal",
            values: memberValues(
              {
                fullName: member.data.fullName,
                memberCode: member.data.memberCode,
                planName: r.planName,
                startDate: r.startDate,
                endDate: r.endDate,
                balance: r.balanceAfter,
              },
              settings.data.gym,
            ),
          });
        }
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const disabled = !plan || !startDate || !!busy;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Renew membership</DialogTitle>
          <DialogDescription>Choose the plan; dates are filled in automatically.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {member.data && <MemberSummary member={member.data} />}
          {p && (
            <div className="flex items-start gap-2 rounded-lg bg-info-soft px-3 py-2 text-info-ink text-sm">
              <Info className="mt-0.5 size-4 shrink-0" /> {p.note}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Plan" className="sm:col-span-2">
              <Select
                value={plan?.id ?? ""}
                onValueChange={(v) => {
                  setPlanId(v);
                  setPaidTouched(false);
                }}
                options={planOptions}
                placeholder="Choose a plan"
              />
            </Field>
            <Field label="Starts">
              <DateField
                value={startDate}
                onChange={(v) => {
                  setStartDate(v);
                  setStartTouched(true);
                }}
              />
            </Field>
            <Field
              label="Ends"
              aside={
                endTouched && (
                  <button type="button" className="text-primary text-xs" onClick={() => setEndTouched(false)}>
                    Auto
                  </button>
                )
              }
            >
              <DateField
                value={endDate}
                onChange={(v) => {
                  setEndDate(v);
                  setEndTouched(true);
                }}
                min={startDate}
              />
            </Field>
            <Field label="Fee">
              <MoneyInput value={fee} onChange={setFee} />
            </Field>
            <Field label="Discount">
              <MoneyInput value={discount} onChange={setDiscount} invalid={discount > fee} />
            </Field>
          </div>

          {canPay && (
            <div className="grid gap-4 rounded-xl border p-4 sm:grid-cols-[1fr_1fr]">
              <div className="flex flex-col gap-1.5 text-sm sm:col-span-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">New membership fee</span>
                  <span className="tabular">{money(net)}</span>
                </div>
                {previousDue > 0 && (
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-muted-foreground">
                      <Switch
                        checked={includeDues}
                        onCheckedChange={(v) => {
                          setIncludeDues(v);
                          setPaidTouched(false);
                        }}
                      />{" "}
                      Also collect previous dues
                    </label>
                    <span className="text-danger-ink tabular">{money(previousDue)}</span>
                  </div>
                )}
                {advance > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Advance already paid</span>
                    <span className="text-info-ink tabular">−{money(advance)}</span>
                  </div>
                )}
                <Separator className="my-1" />
              </div>
              <Field label="Paid now">
                <MoneyInput
                  value={paid}
                  onChange={(v) => {
                    setPaid(v);
                    setPaidTouched(true);
                  }}
                />
              </Field>
              <Field label="Method">
                <Select
                  value={method}
                  onValueChange={setMethod}
                  options={(settings.data?.billing.paymentMethods ?? ["Cash"]).map((x) => ({
                    value: x,
                    label: x,
                  }))}
                />
              </Field>
              {method.toLowerCase() !== "cash" && paid > 0 && (
                <Field label="Transaction ID / reference" className="sm:col-span-2">
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} />
                </Field>
              )}
              <div
                className={cn(
                  "flex items-center justify-between rounded-lg px-3 py-2 font-semibold text-sm sm:col-span-2",
                  after > 0
                    ? "bg-danger-soft text-danger-ink"
                    : after < 0
                      ? "bg-info-soft text-info-ink"
                      : "bg-success-soft text-success-ink",
                )}
              >
                <span>
                  {after > 0 ? "Balance due after this" : after < 0 ? "Advance after this" : "Fully paid"}
                </span>
                <span className="tabular">{money(Math.abs(after))}</span>
              </div>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="whatsapp"
            onClick={() => save("whatsapp")}
            disabled={disabled}
            loading={busy === "whatsapp"}
          >
            <MessageCircle /> Renew & WhatsApp
          </Button>
          <Button
            variant="outline"
            onClick={() => save("print")}
            disabled={disabled || paid <= 0}
            loading={busy === "print"}
          >
            <Printer /> Renew & print
          </Button>
          <Button onClick={() => save("save")} disabled={disabled} loading={busy === "save"}>
            {paid > 0 ? <Save /> : <CalendarClock />} Renew
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
