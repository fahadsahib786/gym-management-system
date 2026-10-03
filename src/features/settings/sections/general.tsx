import { ImageUp, Trash } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type {
  BillingSettings,
  GymSettings,
  MembershipSettings,
  ReceiptPaper,
  SecuritySettings,
  Settings,
} from "@/api/bindings";
import { Field, MoneyInput, PhoneInput } from "@/components/common/fields";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Segmented, Select, Switch } from "@/components/ui/menus";
import { ListEditor, SettingsCard, useSaveSettings } from "./shared";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function GymSection({ settings }: { settings: Settings }) {
  const [gym, setGym] = useState<GymSettings>(settings.gym);
  const { save, saving } = useSaveSettings();
  const fileRef = useRef<HTMLInputElement>(null);

  const onLogo = (file: File | undefined) => {
    if (!file) return;
    // Phone photos are fine: the image is downscaled below before it is saved.
    if (file.size > 15_000_000) {
      toast.error("Please choose an image smaller than 15 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => toast.error("This file could not be read as an image. Try a PNG or JPG.");
      img.onload = () => {
        // Downscale to max 256px so receipts and the sidebar stay light.
        const scale = Math.min(1, 256 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
        setGym((g) => ({ ...g, logo: canvas.toDataURL("image/png") }));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <SettingsCard
      title="Gym profile"
      description="Shown in the app, on receipts and in WhatsApp messages."
      onSave={() => save({ section: "gym", value: gym })}
      saving={saving}
      dirty={!same(gym, settings.gym)}
    >
      <div className="grid gap-4 md:grid-cols-[1fr_200px]">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Gym name" required className="sm:col-span-2">
            <Input value={gym.name} onChange={(e) => setGym({ ...gym, name: e.target.value })} />
          </Field>
          <Field label="Tagline" className="sm:col-span-2">
            <Input value={gym.tagline} onChange={(e) => setGym({ ...gym, tagline: e.target.value })} />
          </Field>
          <Field label="Address">
            <Input value={gym.address} onChange={(e) => setGym({ ...gym, address: e.target.value })} />
          </Field>
          <Field label="City / district">
            <Input value={gym.city} onChange={(e) => setGym({ ...gym, city: e.target.value })} />
          </Field>
          <Field label="Phone">
            <PhoneInput value={gym.phone} onChange={(v) => setGym({ ...gym, phone: v })} />
          </Field>
          <Field label="WhatsApp">
            <PhoneInput value={gym.whatsapp} onChange={(v) => setGym({ ...gym, whatsapp: v })} />
          </Field>
          <Field label="Email" className="sm:col-span-2">
            <Input value={gym.email} onChange={(e) => setGym({ ...gym, email: e.target.value })} />
          </Field>
        </div>
        <Field label="Logo">
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-4">
            {gym.logo ? (
              <img src={gym.logo} alt="Logo" className="size-28 rounded-lg object-contain" />
            ) : (
              <div className="flex size-28 items-center justify-center rounded-lg bg-muted text-muted-foreground text-xs">
                No logo
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                <ImageUp /> Upload
              </Button>
              {gym.logo && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setGym({ ...gym, logo: null })}
                  aria-label="Remove logo"
                >
                  <Trash />
                </Button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => onLogo(e.target.files?.[0])}
            />
          </div>
        </Field>
      </div>
    </SettingsCard>
  );
}

export function MembershipSection({ settings }: { settings: Settings }) {
  const [m, setM] = useState<MembershipSettings>(settings.membership);
  const { save, saving } = useSaveSettings();
  const num = (v: string) => Number(v.replace(/\D/g, "").slice(0, 4)) || 0;
  return (
    <SettingsCard
      title="Membership rules"
      description="How member IDs, expiry warnings, late renewals and check-ins behave."
      onSave={() => save({ section: "membership", value: m })}
      saving={saving}
      dirty={!same(m, settings.membership)}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Member ID prefix"
          hint={`Example: ${m.memberCodePrefix}${"1".padStart(m.memberCodeDigits, "0")}`}
        >
          <Input
            value={m.memberCodePrefix}
            onChange={(e) => setM({ ...m, memberCodePrefix: e.target.value.toUpperCase().slice(0, 8) })}
          />
        </Field>
        <Field label="Digits in member ID">
          <Input
            inputMode="numeric"
            value={m.memberCodeDigits}
            onChange={(e) => setM({ ...m, memberCodeDigits: Math.min(8, num(e.target.value)) })}
          />
        </Field>
        <Field label="Default admission fee">
          <MoneyInput
            value={m.defaultAdmissionFee}
            onChange={(v) => setM({ ...m, defaultAdmissionFee: v })}
          />
        </Field>
        <Field label="Warn when membership ends within (days)" hint="Shown as “Expiring” in amber">
          <Input
            inputMode="numeric"
            value={m.expiringSoonDays}
            onChange={(e) => setM({ ...m, expiringSoonDays: num(e.target.value) })}
          />
        </Field>
        <Field
          label="Late renewal grace (days)"
          hint="Renewing within this many days after expiry keeps the same fee date; later renewals start from the renewal day."
        >
          <Input
            inputMode="numeric"
            value={m.lateRenewalGraceDays}
            onChange={(e) => setM({ ...m, lateRenewalGraceDays: num(e.target.value) })}
          />
        </Field>
        <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm sm:col-span-2">
          <span>
            <span className="font-medium">Record check-ins (attendance)</span>
            <span className="block text-muted-foreground text-xs">
              No machine needed: staff press F4 and type the name, phone or ID. A USB barcode scanner with
              printed member cards makes it one beep. Turn off if the gym does not keep attendance — the
              check-in screens and attendance figures are then hidden.
            </span>
          </span>
          <Switch checked={m.trackAttendance} onCheckedChange={(v) => setM({ ...m, trackAttendance: v })} />
        </label>
        <Field
          label="“Not visiting” after (days)"
          hint="Active members with no visit for this long appear in the reminder list"
        >
          <Input
            inputMode="numeric"
            value={m.inactiveDays}
            onChange={(e) => setM({ ...m, inactiveDays: num(e.target.value) })}
          />
        </Field>
        <Field label="Ignore repeat check-in within (minutes)">
          <Input
            inputMode="numeric"
            value={m.checkinCooldownMinutes}
            onChange={(e) => setM({ ...m, checkinCooldownMinutes: num(e.target.value) })}
          />
        </Field>
        <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm sm:self-end">
          <span>
            <span className="font-medium">Refuse check-in when expired</span>
            <span className="block text-muted-foreground text-xs">Off = allow, but show a red warning</span>
          </span>
          <Switch
            checked={m.blockExpiredCheckin}
            onCheckedChange={(v) => setM({ ...m, blockExpiredCheckin: v })}
          />
        </label>
        <Field label="Timings / batches" className="sm:col-span-2">
          <ListEditor
            value={m.timings}
            onChange={(timings) => setM({ ...m, timings })}
            placeholder="e.g. Ladies (2–5 pm)"
          />
        </Field>
        <Field label="“How did you hear about us?” options" className="sm:col-span-2">
          <ListEditor
            value={m.sources}
            onChange={(sources) => setM({ ...m, sources })}
            placeholder="e.g. TikTok"
          />
        </Field>
      </div>
    </SettingsCard>
  );
}

export function PaymentsSection({ settings }: { settings: Settings }) {
  const [b, setB] = useState<BillingSettings>(settings.billing);
  const { save, saving } = useSaveSettings();
  return (
    <SettingsCard
      title="Payments & receipts"
      description="Payment methods offered at the desk and how receipts look."
      onSave={() => save({ section: "billing", value: b })}
      saving={saving}
      dirty={!same(b, settings.billing)}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Payment methods" className="sm:col-span-2" hint="The first one is selected by default.">
          <ListEditor
            value={b.paymentMethods}
            onChange={(paymentMethods) => setB({ ...b, paymentMethods })}
            placeholder="e.g. SadaPay"
          />
        </Field>
        <Field label="Currency symbol">
          <Input value={b.currency} onChange={(e) => setB({ ...b, currency: e.target.value.slice(0, 5) })} />
        </Field>
        <Field
          label="Receipt number prefix"
          hint={`Next receipts look like ${b.receiptPrefix}${"1".padStart(b.receiptDigits, "0")}`}
        >
          <Input
            value={b.receiptPrefix}
            onChange={(e) => setB({ ...b, receiptPrefix: e.target.value.toUpperCase().slice(0, 8) })}
          />
        </Field>
        <Field label="Receipt printer paper" className="sm:col-span-2">
          <Segmented
            value={b.receiptPaper}
            onChange={(v) => setB({ ...b, receiptPaper: v as ReceiptPaper })}
            options={[
              { value: "80mm", label: "Thermal 80 mm" },
              { value: "58mm", label: "Thermal 58 mm" },
              { value: "a5", label: "Normal printer (A5)" },
            ]}
          />
        </Field>
        <Field label="Receipt footer" className="sm:col-span-2">
          <Textarea
            rows={2}
            value={b.receiptFooter}
            onChange={(e) => setB({ ...b, receiptFooter: e.target.value.slice(0, 300) })}
          />
        </Field>
      </div>
    </SettingsCard>
  );
}

export function SecuritySection({ settings }: { settings: Settings }) {
  const [s, setS] = useState<SecuritySettings>(settings.security);
  const { save, saving } = useSaveSettings();
  return (
    <SettingsCard
      title="Security"
      description="Protect money records and control what receptionists can see."
      onSave={() => save({ section: "security", value: s })}
      saving={saving}
      dirty={!same(s, settings.security)}
    >
      <div className="flex flex-col gap-3">
        <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
          <span>
            <span className="font-medium">Ask for PIN when the app opens</span>
            <span className="block text-muted-foreground text-xs">
              Recommended when more than one person uses this computer.
            </span>
          </span>
          <Switch checked={s.requireLogin} onCheckedChange={(v) => setS({ ...s, requireLogin: v })} />
        </label>
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
          <span>
            <span className="font-medium">Lock the screen when idle</span>
            <span className="block text-muted-foreground text-xs">
              Returns to the PIN screen after no use.
            </span>
          </span>
          <Select
            className="w-40"
            value={String(s.autoLockMinutes)}
            onValueChange={(v) => setS({ ...s, autoLockMinutes: Number(v) })}
            options={[
              { value: "0", label: "Never" },
              { value: "5", label: "5 minutes" },
              { value: "10", label: "10 minutes" },
              { value: "30", label: "30 minutes" },
              { value: "60", label: "1 hour" },
            ]}
          />
        </div>
        <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
          <span>
            <span className="font-medium">Receptionists can see revenue & reports</span>
            <span className="block text-muted-foreground text-xs">
              Off = they only see today's collection.
            </span>
          </span>
          <Switch
            checked={s.staffCanSeeRevenue}
            onCheckedChange={(v) => setS({ ...s, staffCanSeeRevenue: v })}
          />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
          <span>
            <span className="font-medium">Receptionists can record expenses</span>
          </span>
          <Switch
            checked={s.staffCanAddExpenses}
            onCheckedChange={(v) => setS({ ...s, staffCanAddExpenses: v })}
          />
        </label>
      </div>
    </SettingsCard>
  );
}
