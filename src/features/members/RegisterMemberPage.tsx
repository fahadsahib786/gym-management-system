import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { FileClock, MessageCircle, Printer, Save, TriangleAlert, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import type { MemberQuick, PhotoInput } from "@/api/bindings";
import { api } from "@/api/client";
import { errorMessage, toAppError } from "@/api/errors";
import { Field, MoneyInput } from "@/components/common/fields";
import { StatusBadge } from "@/components/common/member";
import { PageContainer, PageHeader } from "@/components/common/page";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Segmented, Select, Switch } from "@/components/ui/menus";
import { Card, CardContent, CardHeader, CardTitle, Separator } from "@/components/ui/primitives";
import { useHotkeys } from "@/hooks/common";
import { usePlans, useSettings } from "@/hooks/queries";
import { formatDate, money, phoneDisplay, todayISO } from "@/lib/format";
import { planEnd } from "@/lib/plans";
import { memberValues } from "@/lib/templates";
import { openDialog } from "@/stores/dialogs";
import {
  emptyMember,
  formToInput,
  MemberDetails,
  MemberEssentials,
  type MemberFormValues,
  memberSchema,
} from "./memberForm";
import { PhotoCapture } from "./PhotoCapture";

type SaveAction = "save" | "print" | "whatsapp";

export function RegisterMemberPage() {
  const navigate = useNavigate();
  const settings = useSettings();
  const plans = usePlans(false);
  const nextCode = useQuery({ queryKey: ["next-code"], queryFn: api.members.nextCode });
  const form = useForm<MemberFormValues>({
    resolver: zodResolver(memberSchema),
    defaultValues: emptyMember(),
    mode: "onTouched",
  });

  const [existing, setExisting] = useState(false);
  const [photo, setPhoto] = useState<PhotoInput | null>(null);
  const [withMembership, setWithMembership] = useState(true);
  const [planId, setPlanId] = useState("");
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState("");
  const [endTouched, setEndTouched] = useState(false);
  const [fee, setFee] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [admission, setAdmission] = useState(0);
  const [paid, setPaid] = useState(0);
  const [paidTouched, setPaidTouched] = useState(false);
  const [method, setMethod] = useState("Cash");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const [duplicates, setDuplicates] = useState<MemberQuick[]>([]);
  const [saving, setSaving] = useState<SaveAction | null>(null);

  const plan = plans.data?.find((p) => p.id === planId);

  useEffect(() => {
    if (plans.data?.length && !planId) setPlanId(plans.data[0].id);
  }, [plans.data, planId]);
  useEffect(() => {
    if (settings.data) {
      setAdmission(settings.data.membership.defaultAdmissionFee);
      setMethod(settings.data.billing.paymentMethods[0] ?? "Cash");
    }
  }, [settings.data]);
  useEffect(() => {
    if (plan) setFee(plan.price);
  }, [plan]);
  useEffect(() => {
    if (!endTouched) setEndDate(planEnd(startDate, plan));
  }, [startDate, plan, endTouched]);

  const admissionCharged = existing ? 0 : admission;
  const membershipNet = withMembership ? Math.max(0, fee - discount) : 0;
  const total = membershipNet + admissionCharged;
  useEffect(() => {
    if (!paidTouched) setPaid(total);
  }, [total, paidTouched]);
  const balance = total - paid;

  const checkDuplicates = async () => {
    const v = form.getValues();
    if (!v.phone && !v.cnic && v.fullName.trim().length < 3) return;
    try {
      setDuplicates(
        await api.members.duplicates({
          phone: v.phone || null,
          cnic: v.cnic || null,
          fullName: v.fullName || null,
        }),
      );
    } catch {
      /* ignore */
    }
  };

  const methods = settings.data?.billing.paymentMethods ?? ["Cash"];
  const isCash = method.toLowerCase() === "cash";

  const submit = (action: SaveAction) =>
    form.handleSubmit(async (values) => {
      if (withMembership && !planId) {
        toast.error("Choose a membership plan, or turn off “Add membership now”.");
        return;
      }
      if (discount > fee) {
        toast.error("Discount cannot be more than the fee.");
        return;
      }
      setSaving(action);
      try {
        const result = await api.members.register({
          member: formToInput(values),
          photo,
          membership: withMembership
            ? {
                planId,
                startDate,
                endDate: endTouched ? endDate : null,
                price: plan && fee !== plan.price ? fee : null,
                discount,
                notes: null,
              }
            : null,
          admissionFee: existing ? 0 : admission,
          payment:
            paid > 0
              ? {
                  amount: paid,
                  method,
                  reference: reference.trim() || null,
                  note: null,
                  paidAt: existing && paidOn ? paidOn : null,
                }
              : null,
          existingMember: existing,
        });
        toast.success(`${values.fullName.trim()} registered as ${result.memberCode}`, {
          description: result.balance > 0 ? `Balance due: ${money(result.balance)}` : undefined,
        });
        navigate(`/members/${result.memberId}`, { replace: true });
        if (action === "print" && result.payment) {
          openDialog({ type: "receipt", paymentId: result.payment.paymentId, autoPrint: true });
        } else if (action === "whatsapp" && settings.data) {
          openDialog({
            type: "whatsapp",
            memberId: result.memberId,
            phone: values.phone,
            template: "welcome",
            title: `Welcome message for ${values.fullName.trim()}`,
            values: {
              ...memberValues(
                {
                  fullName: values.fullName.trim(),
                  memberCode: result.memberCode,
                  planName: withMembership ? plan?.name : null,
                  startDate: withMembership ? startDate : null,
                  endDate: withMembership ? endDate : null,
                  balance: result.balance,
                },
                settings.data.gym,
              ),
              paid: paid > 0 ? money(paid) : "",
            },
          });
        }
      } catch (e) {
        const err = toAppError(e);
        if (err.field && err.field in values) {
          form.setError(err.field as keyof MemberFormValues, { message: err.message });
        }
        toast.error(errorMessage(e));
      } finally {
        setSaving(null);
      }
    })();

  useHotkeys({ "ctrl+s": () => void submit("save"), "ctrl+enter": () => void submit("save") });

  const planOptions = useMemo(
    () => (plans.data ?? []).map((p) => ({ value: p.id, label: `${p.name} — ${money(p.price)}` })),
    [plans.data],
  );

  return (
    <PageContainer className="max-w-[1400px]">
      <PageHeader
        icon={<UserPlus />}
        title={existing ? "Add existing member" : "New member"}
        description={
          existing
            ? "For members who joined before this software — keep their real dates and old register number."
            : "Fill the essentials, take a photo, choose the plan and take the fee."
        }
        actions={
          <Segmented
            value={existing ? "existing" : "new"}
            onChange={(v) => {
              setExisting(v === "existing");
              setPaidTouched(false);
            }}
            options={[
              { value: "new", label: "New member", icon: <UserPlus /> },
              { value: "existing", label: "Existing (from register)", icon: <FileClock /> },
            ]}
          />
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Member details</CardTitle>
            </CardHeader>
            <CardContent>
              <MemberEssentials
                form={form}
                onPhoneBlur={checkDuplicates}
                onNameBlur={checkDuplicates}
                codePlaceholder={nextCode.data ? `Automatic (${nextCode.data})` : "Automatic"}
                existingMode={existing}
              />
              {duplicates.length > 0 && (
                <div className="mt-4 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm">
                  <div className="mb-2 flex items-center gap-2 font-medium text-warning-ink">
                    <TriangleAlert className="size-4" /> Possible duplicate — check before saving
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {duplicates.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-2">
                        <Link to={`/members/${d.id}`} className="font-medium underline underline-offset-2">
                          {d.fullName} ({d.memberCode})
                        </Link>
                        <span className="text-muted-foreground">{phoneDisplay(d.phone)}</span>
                        <StatusBadge status={d.status} />
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-muted-foreground text-xs">
                    Family members may share a phone number — that is allowed.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
          <MemberDetails form={form} />
        </div>

        <div className="flex flex-col gap-5 lg:sticky lg:top-5 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle>Photo</CardTitle>
            </CardHeader>
            <CardContent>
              <PhotoCapture value={photo} onChange={setPhoto} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="items-center">
              <CardTitle>Membership & fee</CardTitle>
              <label className="flex items-center gap-2 text-muted-foreground text-xs">
                Add now <Switch checked={withMembership} onCheckedChange={setWithMembership} />
              </label>
            </CardHeader>
            {withMembership && (
              <CardContent className="flex flex-col gap-3">
                <Field label="Plan">
                  <Select
                    value={planId}
                    onValueChange={(v) => setPlanId(v)}
                    options={planOptions}
                    placeholder="Choose a plan"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Starts">
                    <DateField
                      value={startDate}
                      onChange={(v) => setStartDate(v)}
                      max={existing ? undefined : format(addDays(new Date(), 60), "yyyy-MM-dd")}
                    />
                  </Field>
                  <Field
                    label="Ends"
                    aside={
                      endTouched && (
                        <button
                          type="button"
                          className="text-primary text-xs"
                          onClick={() => setEndTouched(false)}
                        >
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
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Fee">
                    <MoneyInput value={fee} onChange={setFee} />
                  </Field>
                  <Field label="Discount">
                    <MoneyInput value={discount} onChange={setDiscount} invalid={discount > fee} />
                  </Field>
                </div>
              </CardContent>
            )}
            {!existing && (
              <CardContent className={withMembership ? "pt-0" : ""}>
                <Field
                  label="Admission fee (one time)"
                  hint={admission === 0 ? "No admission fee" : undefined}
                >
                  <MoneyInput value={admission} onChange={setAdmission} />
                </Field>
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{existing ? "Fee already paid" : "Payment"}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-1 rounded-lg bg-muted/60 p-3 text-sm">
                {withMembership && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{plan?.name ?? "Membership"}</span>
                    <span className="tabular">{money(fee)}</span>
                  </div>
                )}
                {withMembership && discount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Discount</span>
                    <span className="tabular">−{money(discount)}</span>
                  </div>
                )}
                {admissionCharged > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Admission fee</span>
                    <span className="tabular">{money(admissionCharged)}</span>
                  </div>
                )}
                <Separator className="my-1" />
                <div className="flex justify-between font-semibold">
                  <span>Total</span>
                  <span className="tabular">{money(total)}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
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
                    options={methods.map((m) => ({ value: m, label: m }))}
                  />
                </Field>
              </div>
              {!isCash && paid > 0 && (
                <Field label="Transaction ID / reference" hint="e.g. JazzCash TID">
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} />
                </Field>
              )}
              {existing && paid > 0 && (
                <Field label="Paid on" hint={`Leave empty to use the start date (${formatDate(startDate)})`}>
                  <DateField
                    value={paidOn}
                    onChange={setPaidOn}
                    max={todayISO()}
                    clearable
                    placeholder="Start date"
                  />
                </Field>
              )}
              <div
                className={`flex items-center justify-between rounded-lg px-3 py-2 font-semibold text-sm ${balance > 0 ? "bg-danger-soft text-danger-ink" : balance < 0 ? "bg-info-soft text-info-ink" : "bg-success-soft text-success-ink"}`}
              >
                <span>{balance > 0 ? "Balance due" : balance < 0 ? "Advance (credit)" : "Fully paid"}</span>
                <span className="tabular">{money(Math.abs(balance))}</span>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-2">
            <Button
              size="xl"
              onClick={() => void submit("save")}
              loading={saving === "save"}
              disabled={!!saving}
            >
              <Save /> Save member
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={() => void submit("print")}
                loading={saving === "print"}
                disabled={!!saving || paid <= 0}
              >
                <Printer /> Save & print
              </Button>
              <Button
                variant="whatsapp"
                onClick={() => void submit("whatsapp")}
                loading={saving === "whatsapp"}
                disabled={!!saving}
              >
                <MessageCircle /> Save & WhatsApp
              </Button>
            </div>
            <p className="text-center text-muted-foreground text-xs">Tip: press Ctrl + S to save</p>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
