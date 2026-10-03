import { useQuery } from "@tanstack/react-query";
import {
  CircleAlert,
  CircleCheck,
  Info,
  RefreshCw,
  ScanLine,
  UserRound,
  Volume2,
  VolumeX,
  Wallet,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { CheckInResult } from "@/api/bindings";
import { api } from "@/api/client";
import { errorMessage } from "@/api/errors";
import { SearchInput } from "@/components/common/fields";
import { MemberAvatar, StatusBadge, statusDetail } from "@/components/common/member";
import { EmptyState, PageContainer, PageHeader } from "@/components/common/page";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/primitives";
import { useDebounce } from "@/hooks/common";
import { formatTime, money, num, phoneDisplay, plural } from "@/lib/format";
import { cn, storageGet, storageSet } from "@/lib/utils";
import { openDialog } from "@/stores/dialogs";
import { useCan } from "@/stores/session";

/** Short beeps: one high = OK, two low = needs attention. */
function beep(kind: "ok" | "warn") {
  try {
    const ctx = new AudioContext();
    const tones = kind === "ok" ? [880] : [440, 440];
    tones.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = f;
      gain.gain.value = 0.08;
      osc.connect(gain).connect(ctx.destination);
      const t = ctx.currentTime + i * 0.18;
      osc.start(t);
      osc.stop(t + 0.12);
    });
    setTimeout(() => void ctx.close(), 800);
  } catch {
    /* audio unavailable */
  }
}

function Verdict({ result }: { result: CheckInResult }) {
  const navigate = useNavigate();
  const canPay = useCan("recordPayments");
  const canRenew = useCan("renewMemberships");
  const m = result.member;
  const bad =
    result.outcome === "blocked" || m.status === "expired" || m.status === "none" || m.status === "archived";
  const warn = !bad && (result.warnings.length > 0 || result.outcome === "duplicate");
  const tone = result.outcome === "duplicate" ? "info" : bad ? "danger" : warn ? "warning" : "success";
  const styles = {
    success: "border-success/40 bg-success-soft text-success-ink",
    warning: "border-warning/40 bg-warning-soft text-warning-ink",
    danger: "border-danger/40 bg-danger-soft text-danger-ink",
    info: "border-info/40 bg-info-soft text-info-ink",
  }[tone];
  const Icon = tone === "success" ? CircleCheck : tone === "info" ? Info : CircleAlert;
  const headline =
    result.outcome === "duplicate"
      ? `Already checked in at ${formatTime(result.checkedInAt)}`
      : result.outcome === "blocked"
        ? "Check-in refused"
        : `Welcome, ${m.fullName.split(" ")[0]}!`;

  return (
    <Card className={cn("overflow-hidden border-2", styles)}>
      <div className="flex flex-wrap items-center gap-6 p-6">
        <MemberAvatar
          id={m.id}
          name={m.fullName}
          photoVersion={m.photoVersion}
          size="xl"
          thumb={false}
          className="ring-4 ring-white/70"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-semibold text-2xl">
            <Icon className="size-7 shrink-0" /> {headline}
          </div>
          <div className="mt-1 text-foreground text-lg">
            {m.fullName} <span className="text-muted-foreground">· {m.memberCode}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-foreground text-sm">
            <StatusBadge status={m.status} />
            <span>{statusDetail(m.status, m.daysLeft, m.endDate)}</span>
            <span className="text-muted-foreground">
              · {plural(result.visitsThisMonth, "visit")} this month
            </span>
          </div>
          {result.warnings.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1 font-medium text-sm">
              {result.warnings.map((w) => (
                <li key={w}>• {w}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {m.balance > 0 && canPay && (
            <Button onClick={() => openDialog({ type: "payment", memberId: m.id })}>
              <Wallet /> Collect {money(m.balance)}
            </Button>
          )}
          {(m.status === "expired" || m.status === "expiring" || m.status === "none") && canRenew && (
            <Button
              variant="outline"
              className="bg-card"
              onClick={() => openDialog({ type: "renew", memberId: m.id })}
            >
              <RefreshCw /> Renew
            </Button>
          )}
          <Button variant="ghost" onClick={() => navigate(`/members/${m.id}`)}>
            <UserRound /> Profile
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function CheckInPage() {
  const [term, setTerm] = useState("");
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sound, setSound] = useState(storageGet("df.beep") !== "off");
  const inputRef = useRef<HTMLInputElement>(null);
  const q = useDebounce(term.trim(), 100);
  const results = useQuery({
    queryKey: ["checkin-search", q],
    queryFn: () => api.members.quickSearch(q, 6),
    enabled: q.length > 0,
  });
  const today = useQuery({
    queryKey: ["attendance-today"],
    queryFn: api.attendance.today,
    refetchInterval: 30_000,
  });

  const focus = () => {
    setTimeout(() => inputRef.current?.focus(), 30);
  };
  useEffect(focus, []);

  const checkIn = async (memberId: string, method: "manual" | "scan") => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.attendance.checkIn({ memberId, method });
      setResult(r);
      setTerm("");
      if (sound) {
        const ok = r.outcome === "ok" && r.warnings.length === 0;
        beep(ok ? "ok" : "warn");
      }
    } catch (e) {
      setError(errorMessage(e));
      if (sound) beep("warn");
    } finally {
      setBusy(false);
      focus();
    }
  };

  /** Enter: exact member ID (barcode scanners) first, otherwise the single/top search result. */
  const submit = async () => {
    const t = term.trim();
    if (!t || busy) return;
    try {
      const exact = await api.members.findByCode(t);
      if (exact) return void checkIn(exact.id, "scan");
    } catch {
      /* fall through to search */
    }
    const list = results.data ?? (await api.members.quickSearch(t, 6));
    if (list.length === 1 || (list.length > 0 && list[0].memberCode.toLowerCase() === t.toLowerCase())) {
      void checkIn(list[0].id, "manual");
    } else if (list.length === 0) {
      setError(`No member found for “${t}”.`);
      if (sound) beep("warn");
    }
  };

  return (
    <PageContainer>
      <PageHeader
        icon={<ScanLine />}
        title="Check-in"
        description="Scan the member card, or type a name, phone or member ID and press Enter."
        actions={
          <Button
            variant="ghost"
            onClick={() => {
              setSound((s) => {
                storageSet("df.beep", s ? "off" : "on");
                return !s;
              });
              focus();
            }}
            title={sound ? "Sound on" : "Sound off"}
          >
            {sound ? <Volume2 /> : <VolumeX />} {sound ? "Sound on" : "Sound off"}
          </Button>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card className="p-4">
            <SearchInput
              ref={inputRef}
              value={term}
              onChange={(v) => {
                setTerm(v);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
                if (e.key === "Escape") setTerm("");
              }}
              placeholder="Scan card or type name / phone / ID…"
              className="h-14 text-lg"
            />
            {error && <p className="mt-2 font-medium text-destructive text-sm">{error}</p>}
            {q && results.data && results.data.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1.5">
                {results.data.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void checkIn(m.id, "manual")}
                      className="flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
                    >
                      <MemberAvatar id={m.id} name={m.fullName} photoVersion={m.photoVersion} size="md" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{m.fullName}</div>
                        <div className="truncate text-muted-foreground text-sm">
                          {m.memberCode} · {phoneDisplay(m.phone)}
                        </div>
                      </div>
                      <StatusBadge status={m.status} />
                      <span className="hidden rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground text-sm sm:inline">
                        Check in
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {q && results.data?.length === 0 && (
              <p className="mt-3 text-muted-foreground text-sm">No member found.</p>
            )}
          </Card>

          {result ? (
            <Verdict result={result} />
          ) : (
            <Card>
              <EmptyState
                icon={<ScanLine />}
                title="Ready for check-in"
                description="The member's photo and membership status appear here after check-in."
              />
            </Card>
          )}
        </div>

        <Card className="flex max-h-[calc(100vh-10rem)] flex-col overflow-hidden">
          <CardHeader className="items-center">
            <CardTitle>Today</CardTitle>
            <span className="rounded-full bg-accent px-2.5 py-0.5 font-semibold text-accent-foreground text-sm">
              {num(today.data?.length ?? 0)} check-ins
            </span>
          </CardHeader>
          {!today.data?.length ? (
            <EmptyState title="No check-ins yet today" className="py-10" />
          ) : (
            <ul className="flex-1 divide-y overflow-y-auto">
              {today.data.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-5 py-2.5">
                  <MemberAvatar
                    id={a.member.id}
                    name={a.member.fullName}
                    photoVersion={a.member.photoVersion}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-sm">{a.member.fullName}</div>
                    <div className="text-muted-foreground text-xs">
                      {formatTime(a.checkedInAt)} · {a.member.memberCode}
                    </div>
                  </div>
                  <StatusBadge status={a.member.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </PageContainer>
  );
}
