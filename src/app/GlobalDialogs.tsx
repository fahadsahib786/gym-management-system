import { lazy, type ReactNode, Suspense } from "react";
import { useDialogs } from "@/stores/dialogs";

// Dialogs load on first use, keeping the start-up bundle small.
const ReceivePaymentDialog = lazy(() =>
  import("@/features/payments/ReceivePaymentDialog").then((m) => ({ default: m.ReceivePaymentDialog })),
);
const RenewDialog = lazy(() =>
  import("@/features/memberships/RenewDialog").then((m) => ({ default: m.RenewDialog })),
);
const AddChargeDialog = lazy(() =>
  import("@/features/payments/AddChargeDialog").then((m) => ({ default: m.AddChargeDialog })),
);
const FreezeDialog = lazy(() =>
  import("@/features/memberships/FreezeDialog").then((m) => ({ default: m.FreezeDialog })),
);
const ReceiptDialog = lazy(() =>
  import("@/features/payments/ReceiptDialog").then((m) => ({ default: m.ReceiptDialog })),
);
const WhatsAppDialog = lazy(() =>
  import("@/features/messages/WhatsAppDialog").then((m) => ({ default: m.WhatsAppDialog })),
);

/** Renders whichever app-wide dialog is currently requested. */
export function GlobalDialogs() {
  const current = useDialogs((s) => s.current);
  const close = useDialogs((s) => s.close);
  if (!current) return null;
  const onOpenChange = (open: boolean) => {
    if (!open) close();
  };
  let dialog: ReactNode = null;
  switch (current.type) {
    case "payment":
      dialog = <ReceivePaymentDialog memberId={current.memberId} onOpenChange={onOpenChange} />;
      break;
    case "renew":
      dialog = <RenewDialog memberId={current.memberId} onOpenChange={onOpenChange} />;
      break;
    case "charge":
      dialog = <AddChargeDialog memberId={current.memberId} onOpenChange={onOpenChange} />;
      break;
    case "freeze":
      dialog = <FreezeDialog memberId={current.memberId} onOpenChange={onOpenChange} />;
      break;
    case "receipt":
      dialog = (
        <ReceiptDialog
          paymentId={current.paymentId}
          autoPrint={current.autoPrint}
          onOpenChange={onOpenChange}
        />
      );
      break;
    case "whatsapp":
      dialog = <WhatsAppDialog request={current} onOpenChange={onOpenChange} />;
      break;
  }
  return <Suspense fallback={null}>{dialog}</Suspense>;
}
