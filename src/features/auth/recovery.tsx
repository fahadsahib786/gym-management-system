import { useQuery } from "@tanstack/react-query";
import { FileDown, KeyRound, LifeBuoy, Printer, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { AppStatus } from "@/api/bindings";
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
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/menus";
import { formatDateTime } from "@/lib/format";
import { pdfFileName, saveAsPdf } from "@/lib/pdf";
import { printNode } from "@/lib/print";

interface GymLabel {
  name: string;
  logo?: string | null;
}

/** A5 sheet the owner prints and keeps away from the computer. */
function RecoveryKeyDocument({ recoveryKey, gym }: { recoveryKey: string; gym: GymLabel }) {
  return (
    <div
      className="bg-white text-black"
      style={{ fontFamily: '"Segoe UI", Arial, sans-serif', lineHeight: 1.5 }}
    >
      <div className="flex items-center gap-3 border-[#3f3fd1] border-b-2 pb-3">
        {gym.logo && <img src={gym.logo} alt="" className="size-[14mm] object-contain" />}
        <div className="font-bold text-[16pt]">{gym.name}</div>
      </div>
      <div className="mt-8 font-semibold text-[#3f3fd1] text-[11pt] uppercase tracking-[0.15em]">
        Owner recovery key
      </div>
      <div className="mt-3 rounded-lg border-2 border-black px-4 py-5 text-center font-bold font-mono text-[19pt] tracking-[0.12em]">
        {recoveryKey}
      </div>
      <div className="mt-2 text-[9pt] text-black/60">Created {formatDateTime(new Date())}</div>
      <div className="mt-6 text-[10.5pt]">
        <p className="font-semibold">If you forget the owner PIN</p>
        <p>
          On the login screen click <b>Forgot PIN?</b>, choose the owner account, type this key and choose a
          new PIN. The key works once — the app then shows a new key to keep instead of this one.
        </p>
        <p className="mt-4 font-semibold">Keep this paper safe</p>
        <p>
          Store it away from the computer (for example at home). Anyone with this key can set a new owner PIN
          and see all money reports.
        </p>
      </div>
    </div>
  );
}

/** Shows a recovery key once, with print (and PDF when logged in). */
function RecoveryKeyPanel({
  recoveryKey,
  gym,
  allowPdf,
}: {
  recoveryKey: string;
  gym: GymLabel;
  allowPdf: boolean;
}) {
  const doc = <RecoveryKeyDocument recoveryKey={recoveryKey} gym={gym} />;
  return (
    <div className="flex flex-col gap-3">
      <output
        className="block select-all rounded-xl border-2 border-primary/40 bg-accent/40 px-4 py-5 text-center font-bold font-mono text-2xl tracking-[0.12em]"
        aria-label="Recovery key"
      >
        {recoveryKey}
      </output>
      <p className="text-muted-foreground text-sm">
        Write it on paper or print it now — <b>it is shown only once</b>. Keep it away from this computer.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => void printNode(doc, "a5")}>
          <Printer /> Print
        </Button>
        {allowPdf && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void saveAsPdf(doc, "a5", pdfFileName(gym.name, "Owner recovery key"))}
          >
            <FileDown /> Save as PDF
          </Button>
        )}
      </div>
    </div>
  );
}

function SavedCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-4 accent-[var(--primary)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      I have written down or printed this key
    </label>
  );
}

/** Settings / dashboard / after setup: create (or replace) the owner recovery key. */
export function RecoveryKeyDialog({
  afterSetup = false,
  gym,
  onOpenChange,
}: {
  afterSetup?: boolean;
  gym: GymLabel;
  onOpenChange: (open: boolean) => void;
}) {
  const status = useQuery({ queryKey: ["recovery-status"], queryFn: api.auth.recoveryStatus });
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      setRecoveryKey(await api.auth.createRecoveryKey());
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{afterSetup ? "One more step: your recovery key" : "Owner recovery key"}</DialogTitle>
          <DialogDescription>Gets you back in if you ever forget the owner PIN.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {recoveryKey ? (
            <>
              <RecoveryKeyPanel recoveryKey={recoveryKey} gym={gym} allowPdf />
              <SavedCheckbox checked={saved} onChange={setSaved} />
            </>
          ) : (
            <>
              <div className="flex gap-3 text-sm">
                <KeyRound className="mt-0.5 size-5 shrink-0 text-primary" />
                <p>
                  If the owner PIN is forgotten, this key lets you set a new one from the login screen (
                  <b>Forgot PIN?</b>). Create it now, then write it down or print it and keep it somewhere
                  safe.
                </p>
              </div>
              {status.data?.exists && (
                <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-ink">
                  A key already exists (created {formatDateTime(status.data.createdAt)}). A new key makes the
                  old one stop working.
                </p>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {recoveryKey ? (
            <Button disabled={!saved} onClick={() => onOpenChange(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {afterSetup ? "Later" : "Cancel"}
              </Button>
              <Button onClick={() => void create()} loading={busy}>
                <KeyRound /> {status.data?.exists ? "Create a new key" : "Create recovery key"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Groups of five while typing: `ABCDE-FGHJK-…`, at most `length` letters and digits. */
function formatCodeInput(value: string, length: number): string {
  const raw = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, length);
  return raw.match(/.{1,5}/g)?.join("-") ?? "";
}

const KEY_LENGTH = 20;
const UNLOCK_LENGTH = 10;

/** Login screen: set a new owner PIN with the recovery key, or with an unlock code from the software provider. */
export function ForgotPinDialog({
  status,
  userId,
  onOpenChange,
}: {
  status: AppStatus;
  userId?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const admins = status.users.filter((u) => u.role === "admin");
  const [adminId, setAdminId] = useState(admins.find((a) => a.id === userId)?.id ?? admins[0]?.id ?? "");
  const [mode, setMode] = useState<"key" | "support" | "none">(
    status.recoveryKeyExists ? "key" : status.supportUnlock ? "support" : "none",
  );
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const supportCode = useQuery({
    queryKey: ["support-code"],
    queryFn: api.auth.supportCode,
    enabled: mode === "support",
    gcTime: 0,
    retry: false,
  });
  const gym = { name: status.gymName, logo: status.gymLogo };
  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 8);
  const codeLength = mode === "key" ? KEY_LENGTH : UNLOCK_LENGTH;

  const switchTo = (next: "key" | "support" | "none") => {
    setMode(next);
    setCode("");
    setErrors({});
  };

  const submit = async () => {
    const e: Record<string, string> = {};
    if (code.replace(/-/g, "").length < codeLength)
      e.code = `Type all ${codeLength} letters and numbers of the ${mode === "key" ? "key" : "unlock code"}`;
    if (!/^\d{4,8}$/.test(pin)) e.pin = "PIN must be 4 to 8 digits";
    else if (pin !== pin2) e.pin2 = "The two PINs do not match";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      setNewKey(
        mode === "key"
          ? await api.auth.resetPinWithKey(adminId, code, pin)
          : await api.auth.resetPinWithSupport(adminId, code, pin),
      );
    } catch (err) {
      setErrors({ form: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const linkClass = "self-start text-primary text-sm hover:underline";
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{newKey ? "New PIN saved" : "Forgot PIN?"}</DialogTitle>
          <DialogDescription>
            {newKey
              ? mode === "key"
                ? "Your old recovery key is used up. Keep this new one instead."
                : "Here is a new recovery key — the old one no longer works. Keep this one safe."
              : "Set a new PIN for the owner / admin account."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {newKey ? (
            <>
              <RecoveryKeyPanel recoveryKey={newKey} gym={gym} allowPdf={false} />
              <SavedCheckbox checked={saved} onChange={setSaved} />
            </>
          ) : mode === "none" ? (
            <div className="flex gap-3 text-sm">
              <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" />
              <div className="flex flex-col gap-2">
                <p>The owner PIN cannot be reset on this computer without the recovery key.</p>
                <p>
                  Ask your software provider (<b>Fahad Baloch</b>) to help you reset it. A receptionist's PIN
                  can be reset by the owner in <b>Settings → Users &amp; security</b>.
                </p>
                {status.recoveryKeyExists && (
                  <button type="button" className={linkClass} onClick={() => switchTo("key")}>
                    I have the recovery key
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              {mode === "support" && (
                <div className="flex flex-col gap-3">
                  <div className="flex gap-3 text-sm">
                    <LifeBuoy className="mt-0.5 size-5 shrink-0 text-primary" />
                    <p>
                      Call or WhatsApp your software provider (<b>Fahad Baloch</b>) and read out this support
                      code. You will get an <b>unlock code</b> back.
                    </p>
                  </div>
                  {supportCode.error ? (
                    <p className="rounded-lg bg-danger-soft px-3 py-2 text-danger-ink text-sm" role="alert">
                      {errorMessage(supportCode.error)}
                    </p>
                  ) : (
                    <output
                      className="block select-all rounded-xl border-2 border-primary/40 bg-accent/40 px-4 py-4 text-center font-bold font-mono text-2xl tracking-[0.12em]"
                      aria-label="Support code"
                    >
                      {supportCode.data ?? "…"}
                    </output>
                  )}
                </div>
              )}
              {admins.length > 1 && (
                <Field label="Account">
                  <Select
                    value={adminId}
                    onValueChange={setAdminId}
                    options={admins.map((a) => ({ value: a.id, label: a.name }))}
                  />
                </Field>
              )}
              <div className="flex flex-col gap-1.5">
                <Field
                  label={mode === "key" ? "Recovery key" : "Unlock code"}
                  error={errors.code}
                  hint={
                    mode === "key" ? "From the paper you printed or wrote down" : "From the software provider"
                  }
                >
                  <Input
                    value={code}
                    onChange={(e) => setCode(formatCodeInput(e.target.value, codeLength))}
                    placeholder={mode === "key" ? "XXXXX-XXXXX-XXXXX-XXXXX" : "XXXXX-XXXXX"}
                    className="font-mono tracking-wider"
                    autoComplete="off"
                    autoFocus
                  />
                </Field>
                {mode === "key" ? (
                  <button
                    type="button"
                    className={linkClass}
                    onClick={() => switchTo(status.supportUnlock ? "support" : "none")}
                  >
                    Lost the key?
                  </button>
                ) : (
                  status.recoveryKeyExists && (
                    <button type="button" className={linkClass} onClick={() => switchTo("key")}>
                      I have the recovery key
                    </button>
                  )
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="New PIN (4–8 digits)" error={errors.pin}>
                  <Input
                    type="password"
                    inputMode="numeric"
                    value={pin}
                    onChange={(e) => setPin(digits(e.target.value))}
                  />
                </Field>
                <Field label="Repeat new PIN" error={errors.pin2}>
                  <Input
                    type="password"
                    inputMode="numeric"
                    value={pin2}
                    onChange={(e) => setPin2(digits(e.target.value))}
                    onKeyDown={(e) => e.key === "Enter" && void submit()}
                  />
                </Field>
              </div>
              {errors.form && (
                <p className="rounded-lg bg-danger-soft px-3 py-2 text-danger-ink text-sm" role="alert">
                  {errors.form}
                </p>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {newKey ? (
            <Button disabled={!saved} onClick={() => onOpenChange(false)}>
              Done — log in
            </Button>
          ) : mode === "none" ? (
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => void submit()}
                loading={busy}
                disabled={mode === "support" && !supportCode.data}
              >
                Save new PIN
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
