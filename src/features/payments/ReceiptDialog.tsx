import { useQuery } from "@tanstack/react-query";
import { FileDown, MessageCircle, Printer } from "lucide-react";
import { useEffect, useRef } from "react";
import { api } from "@/api/client";
import { ErrorState, LoadingBlock } from "@/components/common/page";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSettings } from "@/hooks/queries";
import { pdfFileName, saveAsPdf } from "@/lib/pdf";
import { printNode } from "@/lib/print";
import { ReceiptPdf } from "./documents";
import { whatsappForReceipt } from "./followups";
import { ReceiptDocument } from "./ReceiptDocument";

export function ReceiptDialog({
  paymentId,
  autoPrint = false,
  onOpenChange,
}: {
  paymentId: string;
  autoPrint?: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const receipt = useQuery({
    queryKey: ["receipt", paymentId],
    queryFn: () => api.payments.receipt(paymentId),
  });
  const settings = useSettings();
  const printed = useRef(false);

  const print = () => {
    if (!receipt.data || !settings.data) return;
    const paper = settings.data.billing.receiptPaper;
    const { gym, billing } = settings.data;
    void printNode(
      paper === "a5" ? (
        <ReceiptPdf receipt={receipt.data} gym={gym} footer={billing.receiptFooter} />
      ) : (
        <ReceiptDocument receipt={receipt.data} gym={gym} footer={billing.receiptFooter} paper={paper} />
      ),
      paper,
    );
  };

  const pdf = () => {
    if (!receipt.data || !settings.data) return;
    const r = receipt.data;
    void saveAsPdf(
      <ReceiptPdf receipt={r} gym={settings.data.gym} footer={settings.data.billing.receiptFooter} />,
      "a5",
      pdfFileName("Receipt", r.receiptNo, r.memberName),
    );
  };

  useEffect(() => {
    if (autoPrint && !printed.current && receipt.data && settings.data) {
      printed.current = true;
      print();
    }
  });

  const paper = settings.data?.billing.receiptPaper ?? "80mm";
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size={paper === "a5" ? "lg" : "sm"}>
        <DialogHeader>
          <DialogTitle>Receipt {receipt.data?.receiptNo ?? ""}</DialogTitle>
        </DialogHeader>
        <DialogBody className="bg-muted/50">
          {receipt.isPending || !settings.data ? (
            <LoadingBlock />
          ) : receipt.error ? (
            <ErrorState error={receipt.error} />
          ) : (
            <div
              className="mx-auto rounded-md bg-white p-4 shadow-sm ring-1 ring-black/5"
              style={{ maxWidth: paper === "a5" ? 560 : paper === "58mm" ? 240 : 300 }}
            >
              {paper === "a5" ? (
                <ReceiptPdf
                  receipt={receipt.data}
                  gym={settings.data.gym}
                  footer={settings.data.billing.receiptFooter}
                />
              ) : (
                <ReceiptDocument
                  receipt={receipt.data}
                  gym={settings.data.gym}
                  footer={settings.data.billing.receiptFooter}
                  paper={paper}
                />
              )}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            variant="whatsapp"
            disabled={!receipt.data || !settings.data || !!receipt.data.voidedAt}
            onClick={() => receipt.data && settings.data && whatsappForReceipt(receipt.data, settings.data)}
          >
            <MessageCircle /> WhatsApp
          </Button>
          <Button variant="outline" onClick={pdf} disabled={!receipt.data}>
            <FileDown /> PDF
          </Button>
          <Button onClick={print} disabled={!receipt.data}>
            <Printer /> Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
