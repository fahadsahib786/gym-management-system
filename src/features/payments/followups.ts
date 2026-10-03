import type { Receipt, Settings } from "@/api/bindings";
import { formatDate, money, phoneDisplay } from "@/lib/format";
import type { TemplateKey } from "@/lib/templates";
import { openDialog } from "@/stores/dialogs";

function gymPhone(settings: Settings) {
  const p = settings.gym.phone;
  return p ? (/^\d{12}$/.test(p) ? phoneDisplay(p) : p) : "";
}

/** Opens WhatsApp with the receipt (or renewal/welcome) message filled from a saved payment. */
export function whatsappForReceipt(receipt: Receipt, settings: Settings, template: TemplateKey = "receipt") {
  openDialog({
    type: "whatsapp",
    memberId: receipt.memberId,
    phone: receipt.memberPhone,
    template,
    title: `WhatsApp receipt to ${receipt.memberName}`,
    values: {
      name: receipt.memberName,
      first_name: receipt.memberName.split(" ")[0],
      code: receipt.memberCode,
      receipt_no: receipt.receiptNo,
      amount: money(receipt.amount),
      paid: money(receipt.amount),
      method: receipt.reference ? `${receipt.method} (${receipt.reference})` : receipt.method,
      date: formatDate(receipt.paidAt),
      due: receipt.balanceAfter > 0 ? money(receipt.balanceAfter) : "",
      plan: receipt.planName ?? "",
      start_date: receipt.periodStart ? formatDate(receipt.periodStart) : "",
      end_date: receipt.periodEnd ? formatDate(receipt.periodEnd) : "",
      gym: settings.gym.name,
      gym_phone: gymPhone(settings),
    },
  });
}
