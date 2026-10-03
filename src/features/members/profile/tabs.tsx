import { useQuery } from "@tanstack/react-query";
import { addDays, format, startOfWeek, subDays } from "date-fns";
import {
  Ban,
  CalendarClock,
  ChevronDown,
  FileDown,
  FileText,
  MessageCircle,
  Pencil,
  Plus,
  Printer,
  Ruler,
  ScrollText,
  Snowflake,
  Trash,
  Wallet,
} from "lucide-react";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import type {
  FreezeRow,
  Measurement,
  Member,
  PaidStatus,
  SubscriptionRow,
  SubscriptionState,
} from "@/api/bindings";
import { api } from "@/api/client";
import { errorMessage } from "@/api/errors";
import { BLUE_RAMP, ChartTooltip, gridProps, xAxisProps, yAxisProps } from "@/components/charts/kit";
import { Field } from "@/components/common/fields";
import { EmptyState, ErrorState, InfoRow, LoadingBlock } from "@/components/common/page";
import { ConfirmDialog } from "@/components/common/widgets";
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
import { AffixInput, Textarea } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menus";
import {
  Badge,
  type BadgeVariant,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { printInvoice, saveInvoicePdf } from "@/features/payments/invoice";
import { useSettings } from "@/hooks/queries";
import {
  formatDate,
  formatDateTime,
  formatShortDate,
  formatTime,
  isoDate,
  money,
  num,
  parseDate,
  phoneDisplay,
  timeAgo,
  todayISO,
} from "@/lib/format";
import { TEMPLATE_INFO, type TemplateKey } from "@/lib/templates";
import { cn } from "@/lib/utils";
import { openDialog } from "@/stores/dialogs";
import { useCan } from "@/stores/session";

// ============================================================================================ Overview

export function OverviewTab({ member: m, freezes }: { member: Member; freezes: FreezeRow[] }) {
  const canFreeze = useCan("manageFreezes");
  const endFreeze = async (id: string) => {
    try {
      await api.freezes.end(id);
      toast.success("Freeze ended — unused days were given back");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const genderLabel = m.gender === "male" ? "Male" : m.gender === "female" ? "Female" : "Other";
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>Personal</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <InfoRow label="Father / husband">{m.fatherName}</InfoRow>
          <InfoRow label="Gender">{genderLabel}</InfoRow>
          <InfoRow label="Date of birth">
            {m.dateOfBirth ? `${formatDate(m.dateOfBirth)} (${m.age} yrs)` : null}
          </InfoRow>
          <InfoRow label="CNIC">{m.cnic}</InfoRow>
          <InfoRow label="Blood group">{m.bloodGroup}</InfoRow>
          <InfoRow label="Occupation">{m.occupation}</InfoRow>
          <InfoRow label="Heard about us">{m.source}</InfoRow>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Contact</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <InfoRow label="Mobile">{phoneDisplay(m.phone)}</InfoRow>
          <InfoRow label="WhatsApp">{m.whatsapp ? phoneDisplay(m.whatsapp) : "Same as mobile"}</InfoRow>
          <InfoRow label="Email">{m.email}</InfoRow>
          <InfoRow label="Area">{m.area}</InfoRow>
          <InfoRow label="Address">{m.address}</InfoRow>
          <InfoRow label="Emergency">
            {m.emergencyName || m.emergencyPhone
              ? `${m.emergencyName ?? ""} ${m.emergencyPhone ? phoneDisplay(m.emergencyPhone) : ""}`.trim()
              : null}
          </InfoRow>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Membership</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <InfoRow label="Plan">{m.planName}</InfoRow>
          <InfoRow label="Valid">
            {m.startDate ? `${formatDate(m.startDate)} – ${formatDate(m.endDate)}` : null}
          </InfoRow>
          <InfoRow label="Timing">{m.timing}</InfoRow>
          <InfoRow label="Joined">{formatDate(m.joinDate)}</InfoRow>
          <InfoRow label="Total visits">{num(m.visitCount)}</InfoRow>
          <InfoRow label="Last payment">{m.lastPaymentAt ? formatDateTime(m.lastPaymentAt) : null}</InfoRow>
          <InfoRow label="Registered by">{m.createdByName ?? "—"}</InfoRow>
        </CardContent>
      </Card>
      {(m.notes || m.medicalNotes) && (
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {m.medicalNotes && (
              <div>
                <div className="mb-1 font-medium text-danger-ink text-xs">Health / injuries</div>
                <p className="whitespace-pre-wrap">{m.medicalNotes}</p>
              </div>
            )}
            {m.notes && (
              <div>
                <div className="mb-1 font-medium text-muted-foreground text-xs">Other notes</div>
                <p className="whitespace-pre-wrap">{m.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {freezes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Freezes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {freezes.map((f) => (
              <div
                key={f.id}
                className="flex items-start justify-between gap-3 rounded-lg border p-2.5 text-sm"
              >
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    <Snowflake className="size-3.5 text-info" /> {f.days} days
                    <Badge
                      variant={
                        f.state === "active" ? "info" : f.state === "scheduled" ? "upcoming" : "neutral"
                      }
                    >
                      {f.state}
                    </Badge>
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {formatDate(f.startDate)} – {formatDate(f.endDate)}
                    {f.reason ? ` · ${f.reason}` : ""}
                  </div>
                </div>
                {canFreeze && (f.state === "active" || f.state === "scheduled") && (
                  <Button size="sm" variant="outline" onClick={() => endFreeze(f.id)}>
                    {f.state === "active" ? "End now" : "Cancel"}
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ======================================================================================= Memberships

const paidMeta: Record<PaidStatus, { label: string; variant: BadgeVariant }> = {
  paid: { label: "Paid", variant: "success" },
  partial: { label: "Part paid", variant: "warning" },
  unpaid: { label: "Unpaid", variant: "danger" },
  void: { label: "Void", variant: "neutral" },
};

const stateMeta: Record<SubscriptionState, { label: string; variant: BadgeVariant }> = {
  current: { label: "Current", variant: "success" },
  upcoming: { label: "Upcoming", variant: "upcoming" },
  past: { label: "Past", variant: "neutral" },
  cancelled: { label: "Cancelled", variant: "neutral" },
};

function EditDatesDialog({
  sub,
  onOpenChange,
}: {
  sub: SubscriptionRow;
  onOpenChange: (o: boolean) => void;
}) {
  const [start, setStart] = useState(sub.startDate);
  const [end, setEnd] = useState(sub.endDate);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.memberships.updateDates({ subscriptionId: sub.id, startDate: start, endDate: end, reason });
      toast.success("Membership dates corrected");
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Correct membership dates</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start">
              <DateField value={start} onChange={setStart} />
            </Field>
            <Field label="End">
              <DateField value={end} onChange={setEnd} min={start} />
            </Field>
          </div>
          <Field label="Reason" hint="Saved in the activity log">
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Entered wrong start date"
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} disabled={reason.trim().length < 3}>
            Save dates
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MembershipsTab({ member }: { member: Member }) {
  const canRenew = useCan("renewMemberships");
  const canEdit = useCan("editMemberships");
  const canCancel = useCan("cancelMemberships");
  const subs = useQuery({
    queryKey: ["subscriptions", member.id],
    queryFn: () => api.memberships.list(member.id),
  });
  const [editing, setEditing] = useState<SubscriptionRow | null>(null);
  const [cancelling, setCancelling] = useState<SubscriptionRow | null>(null);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="items-center">
        <CardTitle>Membership history</CardTitle>
        {canRenew && (
          <Button size="sm" onClick={() => openDialog({ type: "renew", memberId: member.id })}>
            <CalendarClock /> Renew
          </Button>
        )}
      </CardHeader>
      {subs.isPending ? (
        <LoadingBlock />
      ) : subs.error ? (
        <ErrorState error={subs.error} />
      ) : subs.data.length === 0 ? (
        <EmptyState
          icon={<CalendarClock />}
          title="No memberships yet"
          description="Use Renew to start the first membership."
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Plan</TH>
              <TH>Period</TH>
              <TH>Type</TH>
              <TH className="text-right">Fee</TH>
              <TH>Payment</TH>
              <TH>Status</TH>
              {(canEdit || canCancel) && <TH />}
            </tr>
          </THead>
          <TBody>
            {subs.data.map((s) => (
              <TR key={s.id} className={cn(s.state === "cancelled" && "text-muted-foreground")}>
                <TD className="font-medium">
                  {s.planName}
                  {s.freezeDays > 0 && (
                    <span className="ml-1 text-info-ink text-xs">(+{s.freezeDays} frozen days)</span>
                  )}
                </TD>
                <TD className="whitespace-nowrap">
                  {formatDate(s.startDate)} – {formatDate(s.endDate)}
                </TD>
                <TD className="capitalize">{s.kind === "migrated" ? "From register" : s.kind}</TD>
                <TD className="text-right tabular">
                  {money(s.netAmount)}
                  {s.discount > 0 && (
                    <div className="text-muted-foreground text-xs">−{money(s.discount)} discount</div>
                  )}
                </TD>
                <TD>
                  <Badge variant={paidMeta[s.paidStatus].variant}>{paidMeta[s.paidStatus].label}</Badge>
                </TD>
                <TD>
                  <Badge variant={stateMeta[s.state].variant}>{stateMeta[s.state].label}</Badge>
                  {s.cancelReason && <div className="mt-1 max-w-48 truncate text-xs">{s.cancelReason}</div>}
                </TD>
                {(canEdit || canCancel) && (
                  <TD className="whitespace-nowrap text-right">
                    {s.state !== "cancelled" && canEdit && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setEditing(s)}
                        aria-label="Correct dates"
                        title="Correct dates"
                      >
                        <Pencil />
                      </Button>
                    )}
                    {s.state !== "cancelled" && canCancel && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setCancelling(s)}
                        aria-label="Cancel membership"
                        title="Cancel membership"
                      >
                        <Ban />
                      </Button>
                    )}
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {editing && <EditDatesDialog sub={editing} onOpenChange={(o) => !o && setEditing(null)} />}
      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Cancel this membership?"
        description="The membership fee is voided. Money already paid stays on the account as credit (or void the payment if you returned it)."
        confirmLabel="Cancel membership"
        destructive
        requireReason
        onConfirm={async (reason) => {
          if (!cancelling) return;
          try {
            await api.memberships.cancel(cancelling.id, reason);
            toast.success("Membership cancelled");
          } catch (e) {
            toast.error(errorMessage(e));
            throw e;
          }
        }}
      />
    </Card>
  );
}

// ============================================================================================ Ledger

export function LedgerTab({ member }: { member: Member }) {
  const canPay = useCan("recordPayments");
  const canCharge = useCan("addCharges");
  const canVoidPayment = useCan("voidPayments");
  const canVoidCharge = useCan("voidCharges");
  const ledger = useQuery({ queryKey: ["ledger", member.id], queryFn: () => api.ledger.get(member.id) });
  const settings = useSettings();
  const [voiding, setVoiding] = useState<{ id: string; type: string; label: string } | null>(null);
  const rows = useMemo(() => [...(ledger.data ?? [])].reverse(), [ledger.data]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="items-center">
        <div>
          <CardTitle>Payments & fees</CardTitle>
          <p className="mt-1 text-muted-foreground text-xs">
            Charged {money(member.totalCharged)} · Paid {money(member.totalPaid)} ·{" "}
            <span className={member.balance > 0 ? "font-medium text-danger-ink" : ""}>
              {member.balance > 0
                ? `Due ${money(member.balance)}`
                : member.balance < 0
                  ? `Advance ${money(-member.balance)}`
                  : "Nothing due"}
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                <FileText /> Invoice <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => settings.data && void saveInvoicePdf(member.id, settings.data)}
              >
                <FileDown /> Save invoice as PDF
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => settings.data && void printInvoice(member.id, settings.data)}>
                <Printer /> Print invoice (A4)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {canCharge && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => openDialog({ type: "charge", memberId: member.id })}
            >
              <Plus /> Add charge
            </Button>
          )}
          {canPay && (
            <Button size="sm" onClick={() => openDialog({ type: "payment", memberId: member.id })}>
              <Wallet /> Receive payment
            </Button>
          )}
        </div>
      </CardHeader>
      {ledger.isPending ? (
        <LoadingBlock />
      ) : ledger.error ? (
        <ErrorState error={ledger.error} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Wallet />} title="No fees or payments yet" />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Date</TH>
              <TH>Details</TH>
              <TH className="text-right">Charged</TH>
              <TH className="text-right">Paid</TH>
              <TH className="text-right">Balance</TH>
              <TH />
            </tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={`${r.entryType}-${r.id}`} className={cn(r.voided && "text-muted-foreground")}>
                <TD className="whitespace-nowrap">
                  {formatDate(r.date)}
                  {r.entryType === "payment" && (
                    <div className="text-muted-foreground text-xs">{formatTime(r.date)}</div>
                  )}
                </TD>
                <TD>
                  <div className={cn(r.voided && "line-through")}>{r.description}</div>
                  <div className="text-muted-foreground text-xs">
                    {r.entryType === "payment" ? `${r.receiptNo} · ${r.method}` : "Charge"}
                    {r.voided && <Badge className="ml-2">VOID</Badge>}
                  </div>
                </TD>
                <TD className="text-right tabular">{r.debit ? money(r.debit) : ""}</TD>
                <TD className="text-right text-success-ink tabular">{r.credit ? money(r.credit) : ""}</TD>
                <TD className={cn("text-right font-medium tabular", r.balance > 0 && "text-danger-ink")}>
                  {money(r.balance)}
                </TD>
                <TD className="whitespace-nowrap text-right">
                  {r.entryType === "payment" && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Receipt"
                      aria-label="Receipt"
                      onClick={() => openDialog({ type: "receipt", paymentId: r.id })}
                    >
                      <Printer />
                    </Button>
                  )}
                  {!r.voided &&
                    ((r.entryType === "payment" && canVoidPayment) ||
                      (r.entryType === "charge" && canVoidCharge)) && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Void (mistake)"
                        aria-label="Void"
                        onClick={() => setVoiding({ id: r.id, type: r.entryType, label: r.description })}
                      >
                        <Ban />
                      </Button>
                    )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <ConfirmDialog
        open={!!voiding}
        onOpenChange={(o) => !o && setVoiding(null)}
        title={voiding?.type === "payment" ? "Void this payment?" : "Void this charge?"}
        description={
          voiding?.type === "payment"
            ? "Use only for mistakes (e.g. entered twice). The receipt stays on record marked VOID and the balance is recalculated."
            : "Use only for mistakes. Membership fees are removed by cancelling the membership instead."
        }
        confirmLabel="Void"
        destructive
        requireReason
        onConfirm={async (reason) => {
          if (!voiding) return;
          try {
            if (voiding.type === "payment") await api.payments.void(voiding.id, reason);
            else await api.charges.void(voiding.id, reason);
            toast.success("Voided");
          } catch (e) {
            toast.error(errorMessage(e));
            throw e;
          }
        }}
      />
    </Card>
  );
}

// ======================================================================================== Attendance

const HEATMAP_WEEKS = 26;

export function AttendanceTab({ member }: { member: Member }) {
  const canDelete = useCan("deleteAttendance");
  const to = todayISO();
  // Week columns (Monday first) covering the last six months, up to today.
  const { from, columns } = useMemo(() => {
    const today = parseDate(to) ?? new Date();
    const gridStart = startOfWeek(subDays(today, HEATMAP_WEEKS * 7 - 1), { weekStartsOn: 1 });
    const cols: { date: Date; key: string }[][] = [];
    for (let w = 0; w < HEATMAP_WEEKS + 1; w++) {
      const col: { date: Date; key: string }[] = [];
      for (let d = 0; d < 7; d++) {
        const date = addDays(gridStart, w * 7 + d);
        if (date > today) break;
        col.push({ date, key: isoDate(date) });
      }
      if (col.length) cols.push(col);
    }
    return { from: isoDate(gridStart), columns: cols };
  }, [to]);
  const days = useQuery({
    queryKey: ["member-days", member.id, from, to],
    queryFn: () => api.attendance.memberDays(member.id, from, to),
  });
  const recent = useQuery({
    queryKey: ["member-attendance", member.id],
    queryFn: () => api.attendance.list({ memberId: member.id, pageSize: 25 }),
  });
  const [removing, setRemoving] = useState<number | null>(null);

  const counts = useMemo(() => new Map((days.data ?? []).map((d) => [d.date, d.count])), [days.data]);

  const total = (days.data ?? []).reduce((s, d) => s + d.count, 0);
  // Average over the weeks since joining when that is shorter than the window (new members).
  const joined = parseDate(member.joinDate);
  const sinceJoin = joined ? Math.ceil((Date.now() - joined.getTime()) / (7 * 86_400_000)) : columns.length;
  const activeWeeks = Math.max(1, Math.min(columns.length, sinceJoin));

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Visits — last 6 months</CardTitle>
            <p className="mt-1 text-muted-foreground text-xs">
              {num(total)} visits · {(total / activeWeeks).toFixed(1)} per week · last visit{" "}
              {member.lastVisitAt ? timeAgo(member.lastVisitAt) : "never"}
            </p>
          </div>
        </CardHeader>
        <CardContent>
          {days.isPending ? (
            <LoadingBlock />
          ) : (
            <div className="overflow-x-auto">
              <div className="flex gap-[3px]">
                <div className="mr-1 flex flex-col gap-[3px] pt-0 text-[10px] text-muted-foreground">
                  {["Mon", "", "Wed", "", "Fri", "", "Sun"].map((l, i) => (
                    <span key={i} className="flex h-[14px] items-center">
                      {l}
                    </span>
                  ))}
                </div>
                {columns.map((col) => (
                  <div key={col[0].key} className="flex flex-col gap-[3px]">
                    {col.map(({ key, date }) => {
                      const c = counts.get(key) ?? 0;
                      return (
                        <span
                          key={key}
                          title={`${format(date, "EEE dd MMM yyyy")}: ${c ? `${c} visit${c > 1 ? "s" : ""}` : "no visit"}`}
                          className="size-[14px] rounded-[3px]"
                          style={{
                            background: c === 0 ? "var(--muted)" : c === 1 ? BLUE_RAMP[2] : BLUE_RAMP[4],
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-3 text-muted-foreground text-xs">
                <span className="inline-flex items-center gap-1">
                  <span className="size-3 rounded-[3px] bg-muted" /> No visit
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="size-3 rounded-[3px]" style={{ background: BLUE_RAMP[2] }} /> 1 visit
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="size-3 rounded-[3px]" style={{ background: BLUE_RAMP[4] }} /> 2+ visits
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Recent check-ins</CardTitle>
        </CardHeader>
        {recent.isPending ? (
          <LoadingBlock />
        ) : !recent.data?.items.length ? (
          <EmptyState title="No check-ins yet" />
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {recent.data.items.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <div>
                  <div className="font-medium">{formatDate(a.checkedInAt)}</div>
                  <div className="text-muted-foreground text-xs">
                    {formatTime(a.checkedInAt)} · {a.method === "scan" ? "Card scan" : "Manual"}
                    {a.recordedBy ? ` · ${a.recordedBy}` : ""}
                  </div>
                </div>
                {canDelete && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setRemoving(a.id)}
                    aria-label="Remove check-in"
                    title="Remove (mistake)"
                  >
                    <Trash />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this check-in?"
        description="Use only for check-ins recorded by mistake."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (removing === null) return;
          try {
            await api.attendance.remove(removing);
            toast.success("Check-in removed");
          } catch (e) {
            toast.error(errorMessage(e));
            throw e;
          }
        }}
      />
    </div>
  );
}

// ========================================================================================== Progress

const MEASURE_FIELDS: { key: keyof Measurement & string; label: string; unit: string }[] = [
  { key: "weightKg", label: "Weight", unit: "kg" },
  { key: "heightCm", label: "Height", unit: "cm" },
  { key: "bodyFatPct", label: "Body fat", unit: "%" },
  { key: "chestCm", label: "Chest", unit: "cm" },
  { key: "waistCm", label: "Waist", unit: "cm" },
  { key: "hipsCm", label: "Hips", unit: "cm" },
  { key: "armCm", label: "Arm", unit: "cm" },
  { key: "thighCm", label: "Thigh", unit: "cm" },
];

function MeasurementDialog({
  memberId,
  last,
  onOpenChange,
}: {
  memberId: string;
  last?: Measurement;
  onOpenChange: (o: boolean) => void;
}) {
  const [date, setDate] = useState(todayISO());
  const [values, setValues] = useState<Record<string, string>>(() => ({
    heightCm: last?.heightCm ? String(last.heightCm) : "",
  }));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const toNum = (v: string | undefined) => (v?.trim() ? Number(v) : null);
  const save = async () => {
    setBusy(true);
    try {
      await api.measurements.save({
        memberId,
        measuredOn: date,
        weightKg: toNum(values.weightKg),
        heightCm: toNum(values.heightCm),
        bodyFatPct: toNum(values.bodyFatPct),
        chestCm: toNum(values.chestCm),
        waistCm: toNum(values.waistCm),
        hipsCm: toNum(values.hipsCm),
        armCm: toNum(values.armCm),
        thighCm: toNum(values.thighCm),
        notes: notes.trim() || null,
      });
      toast.success("Measurements saved");
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
          <DialogTitle>Add measurements</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <Field label="Date">
            <DateField value={date} onChange={setDate} max={todayISO()} />
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {MEASURE_FIELDS.map((f) => (
              <Field key={f.key} label={f.label}>
                <AffixInput
                  suffix={f.unit}
                  inputMode="decimal"
                  value={values[f.key] ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [f.key]: e.target.value.replace(/[^\d.]/g, "").slice(0, 6) }))
                  }
                />
              </Field>
            ))}
          </div>
          <Field label="Notes">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProgressTab({ member }: { member: Member }) {
  const canEdit = useCan("manageMeasurements");
  const list = useQuery({
    queryKey: ["measurements", member.id],
    queryFn: () => api.measurements.list(member.id),
  });
  const [adding, setAdding] = useState(false);
  const data = list.data ?? [];
  const weights = data
    .filter((d) => d.weightKg !== null)
    .map((d) => ({ label: formatShortDate(d.measuredOn), date: d.measuredOn, weight: d.weightKg }));
  const first = data.find((d) => d.weightKg !== null);
  const last = [...data].reverse().find((d) => d.weightKg !== null);
  const change =
    first && last && first !== last
      ? Math.round(((last.weightKg ?? 0) - (first.weightKg ?? 0)) * 10) / 10
      : null;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader className="items-center">
          <div>
            <CardTitle>Weight</CardTitle>
            <p className="mt-1 text-muted-foreground text-xs">
              {last
                ? `Latest ${last.weightKg} kg${last.bmi ? ` · BMI ${last.bmi}` : ""}`
                : "No weight recorded yet"}
              {change !== null &&
                ` · ${change > 0 ? "+" : ""}${change} kg since ${formatDate(first?.measuredOn)}`}
            </p>
          </div>
          {canEdit && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus /> Add measurements
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {weights.length < 2 ? (
            <EmptyState
              icon={<Ruler />}
              title="Add two or more measurements to see progress"
              className="py-10"
            />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={weights} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...xAxisProps} />
                <YAxis
                  {...yAxisProps}
                  width={44}
                  domain={["dataMin - 2", "dataMax + 2"]}
                  tickFormatter={(v: number) => `${Math.round(v)}`}
                  unit=" kg"
                />
                <Tooltip
                  content={<ChartTooltip format={(v) => `${v} kg`} />}
                  cursor={{ stroke: "var(--chart-grid)" }}
                />
                <Line
                  type="monotone"
                  dataKey="weight"
                  name="Weight"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  dot={{ r: 4, fill: "var(--chart-1)", stroke: "var(--card)", strokeWidth: 2 }}
                  activeDot={{ r: 6, stroke: "var(--card)", strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>All measurements</CardTitle>
        </CardHeader>
        {list.isPending ? (
          <LoadingBlock />
        ) : data.length === 0 ? (
          <EmptyState title="Nothing recorded yet" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH className="text-right">Weight</TH>
                <TH className="text-right">BMI</TH>
                <TH className="text-right">Fat</TH>
                <TH className="text-right">Waist</TH>
                <TH className="text-right">Chest</TH>
                {canEdit && <TH />}
              </tr>
            </THead>
            <TBody>
              {[...data].reverse().map((d) => (
                <TR key={d.id}>
                  <TD>{formatDate(d.measuredOn)}</TD>
                  <TD className="text-right tabular">{d.weightKg ?? "—"}</TD>
                  <TD className="text-right tabular">{d.bmi ?? "—"}</TD>
                  <TD className="text-right tabular">{d.bodyFatPct ? `${d.bodyFatPct}%` : "—"}</TD>
                  <TD className="text-right tabular">{d.waistCm ?? "—"}</TD>
                  <TD className="text-right tabular">{d.chestCm ?? "—"}</TD>
                  {canEdit && (
                    <TD className="text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Delete"
                        onClick={async () => {
                          try {
                            await api.measurements.remove(d.id);
                            toast.success("Deleted");
                          } catch (e) {
                            toast.error(errorMessage(e));
                          }
                        }}
                      >
                        <Trash />
                      </Button>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {adding && <MeasurementDialog memberId={member.id} last={last} onOpenChange={setAdding} />}
    </div>
  );
}

// ========================================================================================== Messages

export function MessagesTab({ member }: { member: Member }) {
  const list = useQuery({
    queryKey: ["messages", member.id],
    queryFn: () => api.messages.list(member.id, 100),
  });
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>WhatsApp messages</CardTitle>
      </CardHeader>
      {list.isPending ? (
        <LoadingBlock />
      ) : !list.data?.length ? (
        <EmptyState icon={<MessageCircle />} title="No messages sent yet" />
      ) : (
        <ul className="divide-y">
          {list.data.map((msg) => (
            <li key={msg.id} className="px-5 py-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">
                  {TEMPLATE_INFO[msg.template as TemplateKey]?.label ?? "Custom message"}
                </span>
                <span className="text-muted-foreground text-xs">
                  {formatDateTime(msg.createdAt)}
                  {msg.createdByName ? ` · ${msg.createdByName}` : ""}
                </span>
              </div>
              <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-muted-foreground text-sm">
                {msg.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ========================================================================================== Activity

export function ActivityTab({ member }: { member: Member }) {
  const list = useQuery({
    queryKey: ["audit", "member", member.id],
    queryFn: () => api.audit.list({ entityId: member.id, pageSize: 100 }),
  });
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>History</CardTitle>
      </CardHeader>
      {list.isPending ? (
        <LoadingBlock />
      ) : !list.data?.items.length ? (
        <EmptyState icon={<ScrollText />} title="No history yet" />
      ) : (
        <ol className="relative ml-6 border-l py-2">
          {list.data.items.map((a) => (
            <li key={a.id} className="relative py-2.5 pr-5 pl-5">
              <span className="absolute top-4 -left-[5px] size-2.5 rounded-full bg-primary ring-4 ring-card" />
              <div className="text-sm">{a.summary}</div>
              <div className="text-muted-foreground text-xs">
                {formatDateTime(a.at)}
                {a.userName ? ` · ${a.userName}` : ""}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
