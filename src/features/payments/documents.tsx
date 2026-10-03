import type { ReactNode } from "react";
import type { BillingSettings, FeeInvoice, GymSettings, Receipt } from "@/api/bindings";
import { formatDate, formatTime, money, phoneDisplay } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Full-page documents (A5 receipt, A4 fee invoice) for PDF and normal printers. Thermal receipts keep their
 * compact layout in ReceiptDocument. Colours print as greys on black & white printers.
 */

const ACCENT = "#3f3fd1";

function gymPhone(gym: GymSettings) {
  return gym.phone ? (/^\d{12}$/.test(gym.phone) ? phoneDisplay(gym.phone) : gym.phone) : "";
}

function DocHeader({
  gym,
  title,
  meta,
}: {
  gym: GymSettings;
  title: string;
  meta: { label: string; value: ReactNode }[];
}) {
  const contact = [gymPhone(gym) && `Ph: ${gymPhone(gym)}`, gym.email].filter(Boolean).join("  ·  ");
  return (
    <div className="flex items-start justify-between gap-6 border-b-2 pb-4" style={{ borderColor: ACCENT }}>
      <div className="flex min-w-0 items-start gap-3">
        {gym.logo && <img src={gym.logo} alt="" className="size-[16mm] shrink-0 rounded-md object-contain" />}
        <div className="min-w-0">
          <div className="font-bold text-[17pt] leading-tight">{gym.name}</div>
          {gym.tagline && <div className="text-[9pt] text-black/70">{gym.tagline}</div>}
          {(gym.address || gym.city) && (
            <div className="text-[9pt] text-black/70">
              {[gym.address, gym.city].filter(Boolean).join(", ")}
            </div>
          )}
          {contact && <div className="text-[9pt] text-black/70">{contact}</div>}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-bold text-[16pt] tracking-wide" style={{ color: ACCENT }}>
          {title}
        </div>
        <table className="mt-1 ml-auto text-[9pt]">
          <tbody>
            {meta.map((m) => (
              <tr key={m.label}>
                <td className="pr-3 text-black/60">{m.label}</td>
                <td className="text-right font-semibold">{m.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Party({ title, rows }: { title: string; rows: (ReactNode | null | false)[] }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 font-semibold text-[8pt] text-black/50 uppercase tracking-wider">{title}</div>
      {rows.filter(Boolean).map((r, i) => (
        <div key={i} className={cn("text-[10pt]", i === 0 && "font-semibold text-[11pt]")}>
          {r}
        </div>
      ))}
    </div>
  );
}

function Stamp({ text, tone }: { text: string; tone: "paid" | "due" | "void" }) {
  const color = tone === "paid" ? "#15803d" : tone === "due" ? "#b91c1c" : "#525252";
  return (
    <div
      className="inline-block rotate-[-8deg] rounded-md border-[3px] px-4 py-1 font-black text-[20pt] tracking-[0.2em]"
      style={{ color, borderColor: color, opacity: 0.85 }}
    >
      {text}
    </div>
  );
}

const th =
  "border-black/15 border-b py-2 text-left font-semibold text-[8.5pt] text-black/60 uppercase tracking-wide";
const td = "border-black/10 border-b py-2 align-top text-[10pt]";

function Footer({ footer, note }: { footer?: string; note: string }) {
  return (
    <div className="mt-8 border-black/15 border-t pt-3 text-center text-[8.5pt] text-black/60">
      {footer && <div className="mb-1 text-[9.5pt] text-black/80">{footer}</div>}
      <div>{note}</div>
    </div>
  );
}

const docStyle = {
  fontFamily: '"Inter Variable", "Segoe UI", Arial, sans-serif',
  lineHeight: 1.4,
  printColorAdjust: "exact" as const,
  WebkitPrintColorAdjust: "exact" as const,
};

/** A5 payment receipt (PDF and A5 printers). */
export function ReceiptPdf({
  receipt: r,
  gym,
  footer,
}: {
  receipt: Receipt;
  gym: GymSettings;
  footer: string;
}) {
  const items = r.items.length
    ? r.items
    : [{ description: "Payment towards membership fees", amount: r.amount, discount: 0 }];
  return (
    <div className="relative bg-white text-black" style={docStyle}>
      <DocHeader
        gym={gym}
        title="PAYMENT RECEIPT"
        meta={[
          { label: "Receipt no.", value: r.receiptNo },
          { label: "Date", value: formatDate(r.paidAt) },
          { label: "Time", value: formatTime(r.paidAt) },
        ]}
      />
      <div className="mt-4 grid grid-cols-2 gap-6">
        <Party
          title="Received from"
          rows={[r.memberName, `Member ID: ${r.memberCode}`, phoneDisplay(r.memberPhone)]}
        />
        {r.periodStart && r.periodEnd && (
          <Party
            title="Membership"
            rows={[r.planName ?? "Membership", `${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)}`]}
          />
        )}
      </div>
      <table className="mt-5 w-full border-collapse">
        <thead>
          <tr>
            <th className={th}>Description</th>
            <th className={cn(th, "text-right")}>Amount</th>
            <th className={cn(th, "text-right")}>Discount</th>
            <th className={cn(th, "text-right")}>Net</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td className={td}>{it.description}</td>
              <td className={cn(td, "text-right tabular-nums")}>{money(it.amount)}</td>
              <td className={cn(td, "text-right tabular-nums")}>
                {it.discount ? `-${money(it.discount)}` : "—"}
              </td>
              <td className={cn(td, "text-right font-medium tabular-nums")}>
                {money(it.amount - it.discount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 flex items-end justify-between gap-6">
        <div className="pb-1 pl-2">
          {r.voidedAt ? <Stamp text="VOID" tone="void" /> : <Stamp text="PAID" tone="paid" />}
        </div>
        <table className="text-[10pt]">
          <tbody>
            <tr>
              <td className="py-0.5 pr-6 text-black/60">Total due before payment</td>
              <td className="text-right tabular-nums">{money(r.balanceBefore)}</td>
            </tr>
            <tr className="font-bold text-[12pt]">
              <td className="py-1 pr-6">
                Paid ({r.method}
                {r.reference ? ` · ${r.reference}` : ""})
              </td>
              <td className="text-right tabular-nums">{money(r.amount)}</td>
            </tr>
            <tr className="border-black/20 border-t font-semibold">
              <td className="py-1 pr-6">
                {r.balanceAfter > 0 ? "Balance due" : r.balanceAfter < 0 ? "Advance (credit)" : "Balance"}
              </td>
              <td className={cn("text-right tabular-nums", r.balanceAfter > 0 && "text-[#b91c1c]")}>
                {r.balanceAfter === 0 ? "Fully paid" : money(Math.abs(r.balanceAfter))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {(r.note || r.receivedBy || r.voidedAt) && (
        <div className="mt-4 text-[9pt] text-black/70">
          {r.note && <div>Note: {r.note}</div>}
          {r.receivedBy && <div>Received by: {r.receivedBy}</div>}
          {r.voidedAt && <div className="font-semibold text-black">Voided: {r.voidReason}</div>}
        </div>
      )}
      <Footer footer={footer} note="Thank you! This is a computer-generated receipt." />
    </div>
  );
}

/** A4 fee invoice: what was charged, what is paid and what is still due. */
export function FeeInvoiceDocument({
  invoice: inv,
  gym,
  billing,
}: {
  invoice: FeeInvoice;
  gym: GymSettings;
  billing: BillingSettings;
}) {
  const settled = inv.due <= 0;
  return (
    <div className="relative bg-white text-black" style={docStyle}>
      <DocHeader
        gym={gym}
        title="FEE INVOICE"
        meta={[
          { label: "Invoice no.", value: inv.number },
          { label: "Date", value: formatDate(inv.issuedOn) },
          ...(inv.dueSince ? [{ label: "Due since", value: formatDate(inv.dueSince) }] : []),
        ]}
      />
      <div className="mt-5 grid grid-cols-2 gap-8">
        <Party
          title="Bill to"
          rows={[
            inv.memberName,
            inv.fatherName && `Father/Husband: ${inv.fatherName}`,
            `Member ID: ${inv.memberCode}`,
            `Phone: ${phoneDisplay(inv.phone)}`,
            inv.cnic && `CNIC: ${inv.cnic}`,
            inv.address,
          ]}
        />
        {inv.planName && (
          <Party
            title="Membership"
            rows={[
              inv.planName,
              inv.periodStart &&
                inv.periodEnd &&
                `${formatDate(inv.periodStart)} – ${formatDate(inv.periodEnd)}`,
            ]}
          />
        )}
      </div>

      <table className="mt-6 w-full border-collapse">
        <thead>
          <tr>
            <th className={cn(th, "w-[26mm]")}>Date</th>
            <th className={th}>Description</th>
            <th className={cn(th, "text-right")}>Charged</th>
            <th className={cn(th, "text-right")}>Paid</th>
            <th className={cn(th, "text-right")}>Due</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.length === 0 ? (
            <tr>
              <td className={cn(td, "text-black/60")} colSpan={5}>
                No fees charged yet.
              </td>
            </tr>
          ) : (
            inv.lines.map((l) => (
              <tr key={l.id}>
                <td className={cn(td, "whitespace-nowrap")}>{formatDate(l.chargeDate)}</td>
                <td className={td}>
                  {l.description}
                  {l.discount > 0 && (
                    <div className="text-[8.5pt] text-black/60">
                      {money(l.amount)} less discount {money(l.discount)}
                    </div>
                  )}
                </td>
                <td className={cn(td, "text-right tabular-nums")}>{money(l.netAmount)}</td>
                <td className={cn(td, "text-right tabular-nums")}>
                  {l.paidAmount ? money(l.paidAmount) : "—"}
                </td>
                <td className={cn(td, "text-right font-semibold tabular-nums")}>
                  {l.netAmount - l.paidAmount > 0 ? money(l.netAmount - l.paidAmount) : "—"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="mt-5 flex items-end justify-between gap-8">
        <div className="pb-2 pl-2">
          {inv.lines.length > 0 &&
            (settled ? <Stamp text="PAID" tone="paid" /> : <Stamp text="DUE" tone="due" />)}
        </div>
        <table className="min-w-[70mm] text-[10.5pt]">
          <tbody>
            <tr>
              <td className="py-0.5 pr-8 text-black/60">Total charged</td>
              <td className="text-right tabular-nums">{money(inv.total)}</td>
            </tr>
            <tr>
              <td className="py-0.5 pr-8 text-black/60">Paid</td>
              <td className="text-right tabular-nums">{money(inv.paid)}</td>
            </tr>
            <tr className="border-black/25 border-t-2 font-bold text-[14pt]">
              <td className="pt-1.5 pr-8">Balance due</td>
              <td className={cn("pt-1.5 text-right tabular-nums", !settled && "text-[#b91c1c]")}>
                {money(inv.due)}
              </td>
            </tr>
            {inv.balance < 0 && (
              <tr>
                <td className="py-0.5 pr-8 text-black/60">Advance on account</td>
                <td className="text-right tabular-nums">{money(-inv.balance)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!settled && (
        <div className="mt-6 rounded-lg border border-black/15 p-3 text-[9.5pt]">
          <div className="font-semibold">How to pay</div>
          <div className="text-black/75">
            Please pay at the reception
            {billing.paymentMethods.length > 0 ? ` — ${billing.paymentMethods.join(", ")} accepted` : ""}. Ask
            for a receipt with every payment.
          </div>
        </div>
      )}
      <Footer
        footer={billing.receiptFooter}
        note="This is a computer-generated invoice and needs no signature."
      />
    </div>
  );
}
