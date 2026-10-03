import { toast } from "sonner";
import type { Settings } from "@/api/bindings";
import { api } from "@/api/client";
import { errorMessage } from "@/api/errors";
import { pdfFileName, saveAsPdf } from "@/lib/pdf";
import { printNode } from "@/lib/print";
import { FeeInvoiceDocument } from "./documents";

async function invoiceFor(memberId: string, settings: Settings) {
  const invoice = await api.payments.invoice(memberId);
  return {
    invoice,
    node: <FeeInvoiceDocument invoice={invoice} gym={settings.gym} billing={settings.billing} />,
  };
}

/** Prints a member's fee invoice on A4. */
export async function printInvoice(memberId: string, settings: Settings) {
  try {
    const { node } = await invoiceFor(memberId, settings);
    await printNode(node, "a4");
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

/** Saves a member's fee invoice as a PDF (to send on WhatsApp or e-mail). */
export async function saveInvoicePdf(memberId: string, settings: Settings) {
  try {
    const { invoice, node } = await invoiceFor(memberId, settings);
    await saveAsPdf(node, "a4", pdfFileName("Invoice", invoice.number, invoice.memberName));
  } catch (e) {
    toast.error(errorMessage(e));
  }
}
