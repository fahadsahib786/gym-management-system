import { Languages, RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { MessageTemplates, Settings, TemplateLanguage, WhatsappOpenWith } from "@/api/bindings";
import { api } from "@/api/client";
import { errorMessage } from "@/api/errors";
import { Field } from "@/components/common/fields";
import { WhatsAppText } from "@/components/common/whatsapp-text";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/menus";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { money } from "@/lib/format";
import { PLACEHOLDERS, renderTemplate, TEMPLATE_INFO, type TemplateKey } from "@/lib/templates";
import { cn } from "@/lib/utils";
import { SettingsCard, useSaveSettings } from "./shared";

const SAMPLE = {
  name: "Muhammad Ali",
  first_name: "Muhammad",
  code: "DF-0012",
  plan: "Monthly",
  start_date: "02 Oct 2026",
  end_date: "01 Nov 2026",
  days_left: "3",
  amount: money(3000),
  paid: money(3000),
  due: money(500),
  receipt_no: "R-000123",
  method: "JazzCash",
  date: "02 Oct 2026",
};

export function WhatsappSection({ settings }: { settings: Settings }) {
  const [openWith, setOpenWith] = useState<WhatsappOpenWith>(settings.whatsapp.openWith);
  const [templates, setTemplates] = useState<MessageTemplates>(settings.whatsapp.templates);
  const [selected, setSelected] = useState<TemplateKey>("welcome");
  const { save, saving } = useSaveSettings();
  const dirty =
    openWith !== settings.whatsapp.openWith ||
    JSON.stringify(templates) !== JSON.stringify(settings.whatsapp.templates);

  const loadDefaults = async (language: TemplateLanguage) => {
    try {
      setTemplates(await api.settings.defaultTemplates(language));
      toast.success(
        language === "en"
          ? "English messages loaded — press Save to keep them"
          : "Roman Urdu messages loaded — press Save to keep them",
      );
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const preview = renderTemplate(templates[selected], {
    ...SAMPLE,
    gym: settings.gym.name,
    gym_phone: settings.gym.phone,
  });

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard
        title="WhatsApp"
        description="Messages open in WhatsApp with the text filled in; staff press Send. No paid API needed."
        onSave={() =>
          save({ section: "whatsapp", value: { openWith, templates } }, "WhatsApp settings saved")
        }
        saving={saving}
        dirty={dirty}
      >
        <div className="flex flex-col gap-4">
          <Field
            label="Open messages in"
            hint="WhatsApp Desktop is fastest. Use WhatsApp Web if the desktop app is not installed."
          >
            <Segmented
              value={openWith}
              onChange={(v) => setOpenWith(v as WhatsappOpenWith)}
              options={[
                { value: "desktop", label: "WhatsApp Desktop app" },
                { value: "web", label: "WhatsApp Web" },
                { value: "wame", label: "Ask each time (wa.me)" },
              ]}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Languages className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">Load ready-made messages:</span>
            <Button size="sm" variant="outline" onClick={() => loadDefaults("en")}>
              <RotateCcw /> English
            </Button>
            <Button size="sm" variant="outline" onClick={() => loadDefaults("roman-ur")}>
              <RotateCcw /> Roman Urdu
            </Button>
          </div>
        </div>
      </SettingsCard>

      <Card>
        <CardHeader>
          <CardTitle>Message templates</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 xl:grid-cols-[200px_minmax(0,1fr)_minmax(0,320px)]">
          <div className="flex flex-row flex-wrap gap-1 xl:flex-col">
            {(Object.keys(TEMPLATE_INFO) as TemplateKey[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setSelected(k)}
                className={cn(
                  "rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
                  selected === k ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground",
                )}
              >
                {TEMPLATE_INFO[k].label}
              </button>
            ))}
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <Field label={TEMPLATE_INFO[selected].label} hint={TEMPLATE_INFO[selected].hint}>
              <Textarea
                rows={14}
                value={templates[selected]}
                onChange={(e) => setTemplates({ ...templates, [selected]: e.target.value })}
              />
            </Field>
            <div className="text-muted-foreground text-xs">
              Click to insert:{" "}
              {PLACEHOLDERS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  title={p.label}
                  onClick={() =>
                    setTemplates({ ...templates, [selected]: `${templates[selected]}{${p.key}}` })
                  }
                  className="mr-1 mb-1 inline-block rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent"
                >
                  {`{${p.key}}`}
                </button>
              ))}
              <p className="mt-1">
                A line whose value is empty (for example “Balance due: &#123;due&#125;” when nothing is due)
                is hidden automatically.
              </p>
            </div>
          </div>
          <div>
            <div className="mb-1.5 font-medium text-[0.82rem]">Preview</div>
            <div className="rounded-xl bg-[#e7ddd3] p-3 dark:bg-[#0b141a]">
              <div className="ml-auto max-w-[95%] whitespace-pre-wrap rounded-lg rounded-tr-none bg-[#d9fdd3] px-3 py-2 text-[#111b21] text-sm shadow-sm dark:bg-[#005c4b] dark:text-[#e9edef]">
                {preview ? (
                  <WhatsAppText text={preview} />
                ) : (
                  <span className="opacity-60">Empty message</span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
