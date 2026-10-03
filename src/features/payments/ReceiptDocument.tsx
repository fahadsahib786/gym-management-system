import type { GymSettings, Receipt, ReceiptPaper } from "@/api/bindings";
import { formatDate, formatTime, money, phoneDisplay } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Receipt layout used for both the on-screen preview and printing. Thermal sizes use a compact single
 * column; A5 uses a roomier layout. Black-on-white only (thermal printers print one colour).
 */
export function ReceiptDocument({
  receipt: r,
  gym,
  footer,
  paper = "80mm",
}: {
  receipt: Receipt;
  gym: GymSettings;
  footer: string;
  paper?: ReceiptPaper;
}) {
  const thermal = paper !== "a5";
  const small = paper === "58mm";
  const row = "flex items-baseline justify-between gap-2";
  const rule = <div className={cn("my-1.5 border-black border-t", thermal && "border-dashed")} />;
  const gymPhone = gym.phone ? (/^\d{12}$/.test(gym.phone) ? phoneDisplay(gym.phone) : gym.phone) : "";

  return (
    <div
      className={cn(
        "relative bg-white text-black",
        thermal ? (small ? "text-[10.5px]" : "text-[12px]") : "mx-auto max-w-[130mm] text-[13px]",
      )}
      style={{ fontFamily: '"Inter Variable", "Segoe UI", Arial, sans-serif', lineHeight: 1.35 }}
    >
      {r.voidedAt && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rotate-[-20deg] border-4 border-black px-3 font-black text-4xl tracking-widest opacity-30">
            VOID
          </span>
        </div>
      )}
      <div className="text-center">
        {gym.logo && (
          <img
            src={gym.logo}
            alt=""
            className={cn("mx-auto mb-1 object-contain", thermal ? "h-12" : "h-16")}
          />
        )}
        <div className={cn("font-bold uppercase tracking-wide", thermal ? "text-[15px]" : "text-[18px]")}>
          {gym.name}
        </div>
        {gym.tagline && <div>{gym.tagline}</div>}
        {(gym.address || gym.city) && <div>{[gym.address, gym.city].filter(Boolean).join(", ")}</div>}
        {gymPhone && <div>Ph: {gymPhone}</div>}
      </div>
      {rule}
      <div className="text-center font-bold tracking-wide">PAYMENT RECEIPT</div>
      <div className={row}>
        <span>Receipt #</span>
        <span className="font-semibold">{r.receiptNo}</span>
      </div>
      <div className={row}>
        <span>Date</span>
        <span>
          {formatDate(r.paidAt)} {formatTime(r.paidAt)}
        </span>
      </div>
      <div className={row}>
        <span>Member</span>
        <span className="text-right font-semibold">
          {r.memberName} ({r.memberCode})
        </span>
      </div>
      <div className={row}>
        <span>Phone</span>
        <span>{phoneDisplay(r.memberPhone)}</span>
      </div>
      {r.periodStart && r.periodEnd && (
        <div className={row}>
          <span>Membership</span>
          <span className="text-right">
            {formatDate(r.periodStart)} – {formatDate(r.periodEnd)}
          </span>
        </div>
      )}
      {rule}
      {r.items.length > 0 && (
        <>
          {r.items.map((item, i) => (
            <div key={i}>
              <div className={row}>
                <span>{item.description}</span>
                <span className="tabular">{money(item.amount)}</span>
              </div>
              {item.discount > 0 && (
                <div className={cn(row, "pl-2")}>
                  <span>Discount</span>
                  <span className="tabular">-{money(item.discount)}</span>
                </div>
              )}
            </div>
          ))}
          {rule}
        </>
      )}
      <div className={row}>
        <span>Total due</span>
        <span className="tabular">{money(r.balanceBefore)}</span>
      </div>
      <div className={cn(row, "font-bold", thermal ? "text-[14px]" : "text-[16px]")}>
        <span>PAID</span>
        <span className="tabular">{money(r.amount)}</span>
      </div>
      <div className={row}>
        <span>Method</span>
        <span className="text-right">
          {r.method}
          {r.reference ? ` (${r.reference})` : ""}
        </span>
      </div>
      <div className={cn(row, "font-semibold")}>
        <span>{r.balanceAfter > 0 ? "Balance due" : r.balanceAfter < 0 ? "Advance" : "Balance"}</span>
        <span className="tabular">
          {r.balanceAfter === 0 ? "Fully paid" : money(Math.abs(r.balanceAfter))}
        </span>
      </div>
      {r.note && <div className="mt-1">Note: {r.note}</div>}
      {rule}
      {r.receivedBy && <div>Received by: {r.receivedBy}</div>}
      {r.voidedAt && <div className="font-semibold">VOID: {r.voidReason}</div>}
      {footer && <div className="mt-1.5 text-center">{footer}</div>}
      <div className="mt-2 text-center opacity-70" style={{ fontSize: thermal ? "9px" : "10px" }}>
        Thank you!
      </div>
    </div>
  );
}
