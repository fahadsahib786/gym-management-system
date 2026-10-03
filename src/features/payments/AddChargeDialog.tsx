import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { ChargeKind } from "@/api/bindings";
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
import { useSettings } from "@/hooks/queries";
import { money, todayISO } from "@/lib/format";
import { useCan } from "@/stores/session";

const KINDS: { value: ChargeKind; label: string }[] = [
  { value: "training", label: "Personal training" },
  { value: "locker", label: "Locker" },
  { value: "product", label: "Product (supplement, water…)" },
  { value: "fine", label: "Fine" },
  { value: "admission", label: "Admission fee" },
  { value: "other", label: "Other" },
];

export function AddChargeDialog({
  memberId,
  onOpenChange,
}: {
  memberId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const settings = useSettings();
  const canPay = useCan("recordPayments");
  const member = useQuery({
    queryKey: ["member-quick", memberId],
    queryFn: () => api.members.quick(memberId),
  });
  const [kind, setKind] = useState<ChargeKind>("training");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [date, setDate] = useState(todayISO());
  const [payNow, setPayNow] = useState(true);
  const [method, setMethod] = useState("Cash");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings.data) setMethod(settings.data.billing.paymentMethods[0] ?? "Cash");
  }, [settings.data]);

  const net = Math.max(0, amount - discount);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.charges.add({
        memberId,
        kind,
        description: description.trim() || null,
        amount,
        discount,
        chargeDate: date,
        payment:
          payNow && canPay && net > 0
            ? { amount: net, method, reference: null, note: null, paidAt: null }
            : null,
      });
      toast.success(
        r.payment
          ? `Charge added and paid — receipt ${r.payment.receiptNo}`
          : "Charge added to the member's balance",
      );
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
          <DialogTitle>Add a charge</DialogTitle>
          <DialogDescription>
            Personal training, locker rent, products or fines — added to the member's account.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {member.data && <MemberSummary member={member.data} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type">
              <Select value={kind} onValueChange={(v) => setKind(v as ChargeKind)} options={KINDS} />
            </Field>
            <Field label="Date">
              <DateField value={date} onChange={setDate} max={todayISO()} />
            </Field>
            <Field
              label="Description"
              className="sm:col-span-2"
              hint="Optional, e.g. PT October (12 sessions)"
            >
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field label="Amount" required>
              <MoneyInput value={amount} onChange={setAmount} autoFocus />
            </Field>
            <Field label="Discount">
              <MoneyInput value={discount} onChange={setDiscount} invalid={discount > amount} />
            </Field>
          </div>
          {canPay && (
            <div className="flex flex-col gap-3 rounded-lg border p-3">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">Paid now ({money(net)})</span>
                <Switch checked={payNow} onCheckedChange={setPayNow} />
              </label>
              {payNow && (
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
              )}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} disabled={amount <= 0 || discount > amount}>
            Add charge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
