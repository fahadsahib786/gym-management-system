import { ArrowLeft, Delete, Dumbbell, LockKeyhole, ShieldCheck } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { Actor, AppStatus, UserSummary } from "@/api/bindings";
import { api } from "@/api/client";
import { errorMessage } from "@/api/errors";
import { Button } from "@/components/ui/button";
import { initials, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

export function BrandPanel({
  gymName,
  logo,
  children,
}: {
  gymName: string;
  logo?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="relative hidden w-[42%] max-w-xl flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-indigo-950 p-10 text-white lg:flex">
      <div className="pointer-events-none absolute -top-24 -right-24 size-80 rounded-full bg-white/5" />
      <div className="pointer-events-none absolute -bottom-32 -left-20 size-96 rounded-full bg-white/5" />
      <div className="relative flex items-center gap-3">
        {logo ? (
          <img src={logo} alt="" className="size-12 rounded-xl bg-white object-contain p-1" />
        ) : (
          <div className="flex size-12 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
            <Dumbbell className="size-6" />
          </div>
        )}
        <div>
          <div className="font-semibold text-lg leading-tight">{gymName}</div>
          <div className="text-indigo-200 text-sm">Gym management</div>
        </div>
      </div>
      <div className="relative">{children}</div>
      <div className="relative text-indigo-200/90 text-xs">
        Designed &amp; developed by <span className="font-semibold text-white">Fahad Baloch</span>
      </div>
    </div>
  );
}

function PinPad({
  onDigit,
  onBackspace,
  onClear,
  disabled,
}: {
  onDigit: (d: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  const keyClass =
    "flex h-14 items-center justify-center rounded-xl border bg-card font-semibold text-xl shadow-xs transition-all hover:bg-muted active:scale-95 disabled:opacity-50";
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {keys.map((k) => (
        <button key={k} type="button" className={keyClass} onClick={() => onDigit(k)} disabled={disabled}>
          {k}
        </button>
      ))}
      <button
        type="button"
        className={cn(keyClass, "text-muted-foreground text-sm")}
        onClick={onClear}
        disabled={disabled}
      >
        Clear
      </button>
      <button type="button" className={keyClass} onClick={() => onDigit("0")} disabled={disabled}>
        0
      </button>
      <button
        type="button"
        className={cn(keyClass, "text-muted-foreground")}
        onClick={onBackspace}
        disabled={disabled}
        aria-label="Delete last digit"
      >
        <Delete className="size-5" />
      </button>
    </div>
  );
}

export function LoginScreen({ status, onLogin }: { status: AppStatus; onLogin: (actor: Actor) => void }) {
  const users = status.users;
  const [selected, setSelected] = useState<UserSummary | null>(users.length === 1 ? users[0] : null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // PIN turned off in settings: the owner account opens the app directly.
  useEffect(() => {
    if (!status.requireLogin) {
      api.auth
        .autoLogin()
        .then(onLogin)
        .catch(() => {});
    }
  }, [status.requireLogin, onLogin]);

  const submit = useCallback(async () => {
    if (!selected || pin.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      onLogin(await api.auth.login(selected.id, pin));
    } catch (e) {
      setError(errorMessage(e));
      setPin("");
    } finally {
      setBusy(false);
    }
  }, [selected, pin, busy, onLogin]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < 8 ? p + e.key : p));
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
      else if (e.key === "Enter") void submit();
      else if (e.key === "Escape" && users.length > 1) {
        setSelected(null);
        setPin("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, submit, users.length]);

  return (
    <div className="flex h-screen bg-background">
      <BrandPanel gymName={status.gymName} logo={status.gymLogo}>
        <h2 className="max-w-sm font-semibold text-3xl leading-tight">Welcome back.</h2>
        <p className="mt-3 max-w-sm text-indigo-100/90">
          Members, fees, check-ins and reports — everything for the front desk, working fully offline.
        </p>
        <div className="mt-6 flex items-center gap-2 text-indigo-100/90 text-sm">
          <ShieldCheck className="size-4" /> Your data stays on this computer and is backed up automatically.
        </div>
      </BrandPanel>

      <div className="flex flex-1 flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm">
          {status.clockWarning && (
            <div className="mb-5 rounded-lg border border-danger/30 bg-danger-soft p-3 text-danger-ink text-sm">
              {status.clockWarning}
            </div>
          )}
          {!status.requireLogin ? (
            <p className="text-center text-muted-foreground">Opening…</p>
          ) : !selected ? (
            <>
              <div className="mb-6 text-center">
                <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <LockKeyhole className="size-6" />
                </div>
                <h1 className="font-semibold text-xl">Who is at the desk?</h1>
                <p className="mt-1 text-muted-foreground text-sm">Tap your name, then enter your PIN.</p>
              </div>
              <div className="flex flex-col gap-2">
                {users.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => {
                      setSelected(u);
                      setError(null);
                    }}
                    className="flex items-center gap-3 rounded-xl border bg-card p-3 text-left shadow-xs transition-colors hover:border-primary/40 hover:bg-accent/40"
                  >
                    <div className="flex size-11 items-center justify-center rounded-full bg-accent font-semibold text-accent-foreground">
                      {initials(u.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{u.name}</div>
                      <div className="text-muted-foreground text-xs">
                        {u.role === "admin" ? "Owner / Admin" : "Receptionist"}
                        {u.lastLoginAt ? ` · last login ${timeAgo(u.lastLoginAt)}` : ""}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="mb-5 text-center">
                <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-accent font-semibold text-accent-foreground text-lg">
                  {initials(selected.name)}
                </div>
                <h1 className="font-semibold text-xl">{selected.name}</h1>
                <p className="mt-1 text-muted-foreground text-sm">Enter your PIN</p>
              </div>
              <div
                className="mb-4 flex h-6 items-center justify-center gap-2.5"
                role="status"
                aria-label={`${pin.length} digits entered`}
              >
                {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "size-3.5 rounded-full border-2 transition-colors",
                      i < pin.length ? "border-primary bg-primary" : "border-input",
                    )}
                  />
                ))}
              </div>
              <p
                className={cn(
                  "mb-3 min-h-5 text-center text-sm",
                  error ? "text-destructive" : "text-transparent",
                )}
                role="alert"
              >
                {error ?? "."}
              </p>
              <PinPad
                disabled={busy}
                onDigit={(d) => setPin((p) => (p.length < 8 ? p + d : p))}
                onBackspace={() => setPin((p) => p.slice(0, -1))}
                onClear={() => setPin("")}
              />
              <Button
                size="xl"
                className="mt-4 w-full"
                loading={busy}
                disabled={pin.length < 4}
                onClick={() => void submit()}
              >
                Unlock
              </Button>
              {users.length > 1 && (
                <Button
                  variant="ghost"
                  className="mt-2 w-full"
                  onClick={() => {
                    setSelected(null);
                    setPin("");
                    setError(null);
                  }}
                >
                  <ArrowLeft /> Not you? Choose another user
                </Button>
              )}
            </>
          )}
          <p className="mt-10 text-center text-muted-foreground text-xs lg:hidden">
            Designed &amp; developed by Fahad Baloch
          </p>
        </div>
      </div>
    </div>
  );
}
