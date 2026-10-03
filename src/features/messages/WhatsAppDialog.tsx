import { Copy, MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { errorMessage } from "@/api/errors";
import { Field } from "@/components/common/fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/menus";
import { useSettings } from "@/hooks/queries";
import { phoneDisplay } from "@/lib/format";
import { normalizePhone } from "@/lib/phone";
import { renderTemplate, TEMPLATE_INFO, type TemplateKey } from "@/lib/templates";
import type { DialogRequest } from "@/stores/dialogs";

type WhatsAppRequest = Extract<DialogRequest, { type: "whatsapp" }>;

export function WhatsAppDialog({
  request,
  onOpenChange,
}: {
  request: WhatsAppRequest;
  onOpenChange: (open: boolean) => void;
}) {
  const settings = useSettings();
  const [template, setTemplate] = useState<TemplateKey | "custom">(request.template);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const phone = normalizePhone(request.phone) ?? request.phone;

  useEffect(() => {
    if (!settings.data) return;
    if (template === "custom") {
      setText((t) => t);
      return;
    }
    setText(renderTemplate(settings.data.whatsapp.templates[template], request.values));
  }, [settings.data, template, request.values]);

  const send = async () => {
    setBusy(true);
    try {
      await api.messages.send({ memberId: request.memberId ?? null, template, phone, body: text });
      toast.success("WhatsApp opened", { description: "Check the message and press Send in WhatsApp." });
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Message copied");
    } catch {
      toast.error("Could not copy");
    }
  };

  const options = [
    ...(Object.keys(TEMPLATE_INFO) as TemplateKey[]).map((k) => ({
      value: k,
      label: TEMPLATE_INFO[k].label,
      hint: TEMPLATE_INFO[k].hint,
    })),
    { value: "custom", label: "Write my own" },
  ];

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{request.title ?? "Send WhatsApp message"}</DialogTitle>
          <DialogDescription>
            To {phone.length === 12 && phone.startsWith("923") ? phoneDisplay(phone) : `+${phone}`} · the
            message opens in WhatsApp, ready to send.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Message type">
            <Select
              value={template}
              onValueChange={(v) => {
                setTemplate(v as TemplateKey | "custom");
                if (v === "custom") setText("");
              }}
              options={options}
            />
          </Field>
          <Field label="Message" hint="You can edit the text before sending.">
            <Textarea
              rows={11}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="font-normal leading-relaxed"
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={copy} disabled={!text.trim()}>
            <Copy /> Copy
          </Button>
          <Button variant="whatsapp" onClick={send} loading={busy} disabled={!text.trim()}>
            <MessageCircle /> Open WhatsApp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
