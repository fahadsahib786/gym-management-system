import { useQuery } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowLeft,
  ArrowRight,
  Building,
  Check,
  FolderOpen,
  HardDrive,
  KeyRound,
  Plus,
  Sparkles,
  Tag,
  Trash,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Actor, DurationUnit, GymSettings, SetupPlan } from "@/api/bindings";
import { api } from "@/api/client";
import { errorMessage } from "@/api/errors";
import { Field, MoneyInput, PhoneInput } from "@/components/common/fields";
import { LoadingBlock } from "@/components/common/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/menus";
import { Card } from "@/components/ui/primitives";
import { BrandPanel } from "@/features/auth/LoginScreen";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RestoreFromBackup } from "./RestoreFromBackup";

const STEPS = [
  { title: "Welcome", icon: Sparkles },
  { title: "Gym details", icon: Building },
  { title: "Owner account", icon: KeyRound },
  { title: "Fees & plans", icon: Tag },
  { title: "Finish", icon: Check },
];

export function SetupWizard({ onDone }: { onDone: (owner: Actor) => void }) {
  const defaults = useQuery({
    queryKey: ["setup-defaults"],
    queryFn: api.app.setupDefaults,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [step, setStep] = useState(0);
  const [gym, setGym] = useState<GymSettings | null>(null);
  const [ownerName, setOwnerName] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [admission, setAdmission] = useState(1000);
  const [prefix, setPrefix] = useState("DF-");
  const [plans, setPlans] = useState<SetupPlan[]>([]);
  const [backupFolder, setBackupFolder] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    if (defaults.data && !gym) {
      setGym(defaults.data.gym);
      setAdmission(defaults.data.admissionFee);
      setPrefix(defaults.data.memberCodePrefix);
      setPlans(defaults.data.plans);
      setBackupFolder(defaults.data.backupFolder);
    }
  }, [defaults.data, gym]);

  if (!gym) return <LoadingBlock className="h-screen" />;

  const validate = (s: number): boolean => {
    const e: Record<string, string> = {};
    if (s === 1 && !gym.name.trim()) e.name = "Enter the gym name";
    if (s === 2) {
      if (ownerName.trim().length < 2) e.ownerName = "Enter your name";
      if (!/^\d{4,8}$/.test(pin)) e.pin = "PIN must be 4 to 8 digits";
      else if (pin !== pin2) e.pin2 = "The two PINs do not match";
    }
    if (s === 3) {
      plans.forEach((p, i) => {
        if (!p.name.trim()) e[`plan${i}`] = "Name required";
        if (p.durationValue < 1) e[`plan${i}`] = "Duration must be at least 1";
      });
      if (plans.length === 0) e.plans = "Add at least one plan";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => {
    if (validate(step)) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const finish = async () => {
    setBusy(true);
    setFatal(null);
    try {
      const owner = await api.app.completeSetup({
        gym,
        ownerName: ownerName.trim(),
        ownerPin: pin,
        admissionFee: admission,
        plans: plans.map((p) => ({ ...p, name: p.name.trim() })),
        memberCodePrefix: prefix.trim() || "DF-",
        backupFolder: backupFolder || null,
      });
      onDone(owner);
    } catch (e) {
      setFatal(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const chooseBackupFolder = async () => {
    const dir = await open({ directory: true, multiple: false, title: "Choose where backups are kept" });
    if (typeof dir === "string") setBackupFolder(dir);
  };
  // A different drive from Windows (C:) survives a Windows reinstall; USB drives can go missing.
  const backupDrive = backupFolder.slice(0, 2).toUpperCase();
  const backupIsSafe = /^[D-Z]:$/.test(backupDrive);

  const setPlan = (i: number, patch: Partial<SetupPlan>) =>
    setPlans((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <div className="flex h-screen bg-background">
      <BrandPanel gymName={gym.name || "Danish Fitness"}>
        <ol className="flex flex-col gap-3">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              className={cn(
                "flex items-center gap-3 text-sm",
                i === step ? "text-white" : "text-indigo-200/80",
              )}
            >
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-full ring-1",
                  i < step
                    ? "bg-white text-indigo-700 ring-white"
                    : i === step
                      ? "bg-white/20 ring-white"
                      : "ring-white/30",
                )}
              >
                {i < step ? <Check className="size-4" /> : <s.icon className="size-4" />}
              </span>
              <span className={cn(i === step && "font-semibold")}>{s.title}</span>
            </li>
          ))}
        </ol>
      </BrandPanel>

      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-10">
          {step === 0 && (
            <div>
              <div className="mb-4 inline-flex rounded-full bg-accent px-3 py-1 font-medium text-accent-foreground text-xs">
                First-time setup · 2 minutes
              </div>
              <h1 className="font-semibold text-3xl tracking-tight">
                Welcome to {gym.name || "your gym software"}
              </h1>
              <p className="mt-3 max-w-lg text-muted-foreground">
                Let's set up the basics: your gym details, an owner account with a PIN, and your membership
                fees. You can change all of this later in Settings.
              </p>
              <ul className="mt-6 grid gap-2 text-sm sm:grid-cols-2">
                {[
                  "Register members with photo in under a minute",
                  "Fees, partial payments and dues tracked exactly",
                  "One-click check-in and WhatsApp reminders",
                  "Detailed dashboard, reports and automatic backups",
                ].map((t) => (
                  <li key={t} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" /> {t}
                  </li>
                ))}
              </ul>
              <RestoreFromBackup />
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="font-semibold text-2xl">Gym details</h2>
                <p className="mt-1 text-muted-foreground text-sm">
                  Printed on receipts and used in WhatsApp messages.
                </p>
              </div>
              <Field label="Gym name" required error={errors.name}>
                <Input
                  value={gym.name}
                  onChange={(e) => setGym({ ...gym, name: e.target.value })}
                  autoFocus
                />
              </Field>
              <Field label="Tagline" hint="Optional, e.g. Fitness & Bodybuilding Club">
                <Input value={gym.tagline} onChange={(e) => setGym({ ...gym, tagline: e.target.value })} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Address">
                  <Input value={gym.address} onChange={(e) => setGym({ ...gym, address: e.target.value })} />
                </Field>
                <Field label="City / district">
                  <Input value={gym.city} onChange={(e) => setGym({ ...gym, city: e.target.value })} />
                </Field>
                <Field label="Phone">
                  <PhoneInput value={gym.phone} onChange={(v) => setGym({ ...gym, phone: v })} />
                </Field>
                <Field label="WhatsApp number" hint="Leave empty if same as phone">
                  <PhoneInput value={gym.whatsapp} onChange={(v) => setGym({ ...gym, whatsapp: v })} />
                </Field>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="font-semibold text-2xl">Owner account</h2>
                <p className="mt-1 text-muted-foreground text-sm">
                  The owner (admin) can see all money reports, correct mistakes and add receptionist accounts
                  later.
                </p>
              </div>
              <Field label="Your name" required error={errors.ownerName}>
                <Input
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="e.g. Danish"
                  autoFocus
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="PIN (4–8 digits)" required error={errors.pin}>
                  <Input
                    type="password"
                    inputMode="numeric"
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                    placeholder="••••"
                  />
                </Field>
                <Field label="Repeat PIN" required error={errors.pin2}>
                  <Input
                    type="password"
                    inputMode="numeric"
                    value={pin2}
                    onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 8))}
                    placeholder="••••"
                  />
                </Field>
              </div>
              <p className="rounded-lg bg-muted px-3 py-2 text-muted-foreground text-sm">
                Remember this PIN — it opens the app and protects your fee records.
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="font-semibold text-2xl">Fees & plans</h2>
                <p className="mt-1 text-muted-foreground text-sm">
                  Typical packages are filled in — change prices to match your gym.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Admission fee (one time)"
                  hint="Charged when a new member joins. Use 0 for none."
                >
                  <MoneyInput value={admission} onChange={setAdmission} />
                </Field>
                <Field label="Member ID prefix" hint={`New members get IDs like ${prefix || "DF-"}0001`}>
                  <Input
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value.toUpperCase().slice(0, 8))}
                  />
                </Field>
              </div>
              <Card className="overflow-hidden">
                <div className="grid grid-cols-[1fr_88px_110px_130px_40px] gap-2 border-b bg-muted/60 px-3 py-2 font-medium text-muted-foreground text-xs">
                  <span>Plan name</span>
                  <span>Duration</span>
                  <span>Unit</span>
                  <span>Fee</span>
                  <span />
                </div>
                {plans.map((p, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_88px_110px_130px_40px] items-start gap-2 border-b px-3 py-2 last:border-0"
                  >
                    <div>
                      <Input
                        value={p.name}
                        onChange={(e) => setPlan(i, { name: e.target.value })}
                        aria-invalid={!!errors[`plan${i}`] || undefined}
                      />
                      {errors[`plan${i}`] && (
                        <p className="mt-1 text-destructive text-xs">{errors[`plan${i}`]}</p>
                      )}
                    </div>
                    <Input
                      inputMode="numeric"
                      value={p.durationValue || ""}
                      onChange={(e) =>
                        setPlan(i, {
                          durationValue: Number(e.target.value.replace(/\D/g, "").slice(0, 4)) || 0,
                        })
                      }
                    />
                    <Select
                      value={p.durationUnit}
                      onValueChange={(v) => setPlan(i, { durationUnit: v as DurationUnit })}
                      options={[
                        { value: "month", label: p.durationValue === 1 ? "Month" : "Months" },
                        { value: "day", label: p.durationValue === 1 ? "Day" : "Days" },
                      ]}
                    />
                    <MoneyInput value={p.price} onChange={(v) => setPlan(i, { price: v })} />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setPlans((ps) => ps.filter((_, j) => j !== i))}
                      aria-label="Remove plan"
                    >
                      <Trash className="text-muted-foreground" />
                    </Button>
                  </div>
                ))}
                <div className="p-2">
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setPlans((ps) => [
                        ...ps,
                        { name: "", durationValue: 1, durationUnit: "month", price: 0 },
                      ])
                    }
                  >
                    <Plus /> Add plan
                  </Button>
                </div>
              </Card>
              {errors.plans && <p className="text-destructive text-sm">{errors.plans}</p>}
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="font-semibold text-2xl">All set!</h2>
                <p className="mt-1 text-muted-foreground text-sm">Check the summary, then open the app.</p>
              </div>
              <Card className="divide-y">
                <div className="flex justify-between gap-4 px-4 py-3 text-sm">
                  <span className="text-muted-foreground">Gym</span>
                  <span className="text-right font-medium">
                    {gym.name}
                    <span className="block font-normal text-muted-foreground text-xs">
                      {[gym.address, gym.city].filter(Boolean).join(", ")}
                    </span>
                  </span>
                </div>
                <div className="flex justify-between gap-4 px-4 py-3 text-sm">
                  <span className="text-muted-foreground">Owner</span>
                  <span className="font-medium">{ownerName}</span>
                </div>
                <div className="flex justify-between gap-4 px-4 py-3 text-sm">
                  <span className="text-muted-foreground">Admission fee</span>
                  <span className="font-medium">{admission ? money(admission) : "None"}</span>
                </div>
                <div className="flex flex-col gap-2 px-4 py-3 text-sm">
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-muted-foreground">Backups</span>
                    <span className="min-w-0 text-right">
                      <span className="block break-all font-medium">
                        <HardDrive className="mr-1 inline size-4 text-muted-foreground" />
                        {backupFolder}
                      </span>
                      <span
                        className={cn(
                          "block text-xs",
                          backupIsSafe ? "text-success-ink" : "text-muted-foreground",
                        )}
                      >
                        {backupIsSafe
                          ? `On drive ${backupDrive} — safe even if Windows is reinstalled.`
                          : "Tip: a second drive (D:) or a USB drive keeps backups safe if Windows is reinstalled."}
                      </span>
                    </span>
                  </div>
                  <div className="flex justify-end">
                    <Button size="sm" variant="outline" onClick={() => void chooseBackupFolder()}>
                      <FolderOpen /> Change folder
                    </Button>
                  </div>
                </div>
                <div className="flex justify-between gap-4 px-4 py-3 text-sm">
                  <span className="text-muted-foreground">Plans</span>
                  <span className="text-right font-medium">
                    {plans.map((p) => (
                      <span key={p.name} className="block">
                        {p.name} — {money(p.price)}
                      </span>
                    ))}
                  </span>
                </div>
              </Card>
              {fatal && (
                <p className="rounded-lg bg-danger-soft px-3 py-2 text-danger-ink text-sm">{fatal}</p>
              )}
            </div>
          )}

          <div className="mt-8 flex items-center justify-between gap-3">
            {step > 0 ? (
              <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={busy}>
                <ArrowLeft /> Back
              </Button>
            ) : (
              <span />
            )}
            {step < STEPS.length - 1 ? (
              <Button size="lg" onClick={next}>
                {step === 0 ? "Get started" : "Continue"} <ArrowRight />
              </Button>
            ) : (
              <Button size="lg" onClick={finish} loading={busy}>
                Open {gym.name || "the app"} <ArrowRight />
              </Button>
            )}
          </div>
        </div>
        <p className="pb-4 text-center text-muted-foreground text-xs lg:hidden">
          Designed &amp; developed by Fahad Baloch
        </p>
      </div>
    </div>
  );
}
