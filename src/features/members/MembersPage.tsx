import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import {
  CircleCheck,
  Download,
  Ellipsis,
  Eye,
  FileDown,
  IdCard,
  MessageCircle,
  Printer,
  RefreshCw,
  ScanLine,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import type { MemberFilter, MemberRow, MemberSort } from "@/api/bindings";
import { api } from "@/api/client";
import { errorMessage } from "@/api/errors";
import { SearchInput } from "@/components/common/fields";
import { MemberCell, StatusBadge, statusDetail } from "@/components/common/member";
import { EmptyState, ErrorState, LoadingBlock, PageContainer, PageHeader } from "@/components/common/page";
import { Pagination } from "@/components/common/widgets";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Select,
} from "@/components/ui/menus";
import { Card } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useDebounce } from "@/hooks/common";
import { useSettings, useTracksAttendance } from "@/hooks/queries";
import { formatDate, money, num, phoneDisplay, timeAgo, todayISO } from "@/lib/format";
import { memberValues } from "@/lib/templates";
import { cn } from "@/lib/utils";
import { openDialog } from "@/stores/dialogs";
import { useCan } from "@/stores/session";
import { CARDS_PER_PAGE, printMemberCards, saveMemberCardsPdf } from "./MemberCard";

const FILTERS: { value: MemberFilter; label: string; count: keyof import("@/api/bindings").MemberCounts }[] =
  [
    { value: "all", label: "All", count: "all" },
    { value: "active", label: "Active", count: "active" },
    { value: "expiring", label: "Expiring", count: "expiring" },
    { value: "expired", label: "Expired", count: "expired" },
    { value: "dues", label: "Fee due", count: "dues" },
    { value: "inactive", label: "Not visiting", count: "inactive" },
    { value: "frozen", label: "Frozen", count: "frozen" },
    { value: "noPlan", label: "No plan", count: "noPlan" },
    { value: "archived", label: "Archived", count: "archived" },
  ];

const SORTS: { value: MemberSort | "auto"; label: string }[] = [
  { value: "auto", label: "Best order for this list" },
  { value: "name", label: "Name (A–Z)" },
  { value: "code", label: "Member ID" },
  { value: "expiry", label: "Expiry date" },
  { value: "balance", label: "Fee due (highest first)" },
  { value: "lastVisit", label: "Last visit" },
  { value: "joined", label: "Joining date (newest)" },
  { value: "recent", label: "Recently added" },
];

const chipTone: Partial<Record<MemberFilter, string>> = {
  expiring: "data-[on=true]:bg-warning-soft data-[on=true]:text-warning-ink data-[on=true]:border-warning/40",
  expired: "data-[on=true]:bg-danger-soft data-[on=true]:text-danger-ink data-[on=true]:border-danger/40",
  dues: "data-[on=true]:bg-danger-soft data-[on=true]:text-danger-ink data-[on=true]:border-danger/40",
  active: "data-[on=true]:bg-success-soft data-[on=true]:text-success-ink data-[on=true]:border-success/40",
};

export function MembersPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const settings = useSettings();
  const tracks = useTracksAttendance();
  const canExport = useCan("exportData");
  const canRegister = useCan("registerMembers");
  const filter = (params.get("filter") as MemberFilter) || "all";
  const sort = (params.get("sort") as MemberSort | null) ?? null;
  const timing = params.get("timing") ?? "";
  const page = Number(params.get("page") ?? "1") || 1;
  const searchParam = params.get("q") ?? "";
  const search = useDebounce(searchParam, 150);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || (k === "filter" && v === "all") || (k === "page" && v === "1"))
        next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  const query = useMemo(
    () => ({ search: search || null, filter, sort, timing: timing || null, page, pageSize: 40 }),
    [search, filter, sort, timing, page],
  );
  const list = useQuery({
    queryKey: ["members", query],
    queryFn: () => api.members.list(query),
    placeholderData: keepPreviousData,
  });
  const counts = useQuery({
    queryKey: ["member-counts", search],
    queryFn: () => api.members.counts(search),
    placeholderData: keepPreviousData,
  });

  const exportCsv = async () => {
    const path = await save({
      defaultPath: `members-${todayISO()}.csv`,
      filters: [{ name: "CSV (Excel)", extensions: ["csv"] }],
    });
    if (!path) return;
    try {
      const r = await api.exports.csv({ kind: "members", path });
      toast.success(`Exported ${num(r.rows)} members`, {
        action: { label: "Show file", onClick: () => void api.app.revealFile(r.path) },
      });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const [cardsOpen, setCardsOpen] = useState(false);
  const cardCount = list.data?.total ?? 0;

  const [cardsBusy, setCardsBusy] = useState<"print" | "pdf" | null>(null);

  /** Member cards for everyone in the current list (filter + search), ten per A4 sheet — printed or as PDF. */
  const makeCards = async (how: "print" | "pdf") => {
    if (!settings.data) return;
    setCardsBusy(how);
    try {
      const all: MemberRow[] = [];
      for (let p = 1; ; p++) {
        const res = await api.members.list({ ...query, page: p, pageSize: 500 });
        all.push(...res.items);
        if (all.length >= res.total || res.items.length === 0) break;
      }
      setCardsOpen(false);
      if (how === "pdf") await saveMemberCardsPdf(all, settings.data.gym);
      else await printMemberCards(all, settings.data.gym);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setCardsBusy(null);
    }
  };

  const whatsapp = (m: MemberRow) => {
    if (!settings.data) return;
    const template =
      m.status === "expired"
        ? "expiredReminder"
        : m.balance > 0
          ? "duesReminder"
          : m.status === "expiring"
            ? "expiryReminder"
            : "inactive";
    openDialog({
      type: "whatsapp",
      memberId: m.id,
      phone: m.phone,
      template,
      title: `WhatsApp ${m.fullName}`,
      values: memberValues(
        {
          fullName: m.fullName,
          memberCode: m.memberCode,
          planName: m.planName,
          endDate: m.endDate,
          daysLeft: m.daysLeft,
          balance: m.balance,
        },
        settings.data.gym,
      ),
    });
  };

  return (
    <PageContainer>
      <Dialog open={cardsOpen} onOpenChange={setCardsOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Member cards</DialogTitle>
            <DialogDescription>
              {num(cardCount)} member{cardCount === 1 ? "" : "s"} in this list ·{" "}
              {num(Math.ceil(cardCount / CARDS_PER_PAGE))} A4 sheet{cardCount > CARDS_PER_PAGE ? "s" : ""},
              ten cards per sheet.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-2 text-muted-foreground text-sm">
            <p>
              Each card shows the photo, name, member ID, phone and — when entered — CNIC, father/husband
              name, blood group and timing, plus a barcode for check-in with a USB scanner.
            </p>
            <p>
              <span className="font-medium text-foreground">Print</span> on A4 and laminate, or{" "}
              <span className="font-medium text-foreground">save a PDF</span> to have the cards printed on PVC
              at a print shop. Tip: choose a filter (e.g. Active) first to make cards only for those members.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCardsOpen(false)} disabled={!!cardsBusy}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => void makeCards("pdf")}
              loading={cardsBusy === "pdf"}
              disabled={!!cardsBusy}
            >
              <FileDown /> Save PDF
            </Button>
            <Button
              onClick={() => void makeCards("print")}
              loading={cardsBusy === "print"}
              disabled={!!cardsBusy}
            >
              <Printer /> Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PageHeader
        icon={<Users />}
        title="Members"
        description={
          counts.data
            ? `${num(counts.data.all)} members · ${num(counts.data.active)} active`
            : "Everyone registered at the gym"
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setCardsOpen(true)} disabled={cardCount === 0}>
              <IdCard /> Print cards
            </Button>
            {canExport && (
              <Button variant="outline" onClick={exportCsv}>
                <Download /> Export
              </Button>
            )}
            {canRegister && (
              <Button onClick={() => navigate("/members/new")}>
                <UserPlus /> New member
              </Button>
            )}
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <SearchInput
            autoFocus
            wrapperClassName="w-full max-w-sm"
            value={searchParam}
            onChange={(v) => update({ q: v, page: "1" })}
            placeholder="Search name, phone, ID, CNIC, area…"
          />
          <Select
            className="w-44"
            value={timing || "__all"}
            onValueChange={(v) => update({ timing: v === "__all" ? null : v, page: "1" })}
            options={[
              { value: "__all", label: "All timings" },
              ...(settings.data?.membership.timings ?? []).map((t) => ({ value: t, label: t })),
            ]}
            aria-label="Timing"
          />
          <Select
            className="w-56"
            value={sort ?? "auto"}
            onValueChange={(v) => update({ sort: v === "auto" ? null : v, page: "1" })}
            options={SORTS}
            aria-label="Sort"
          />
          {list.isFetching && !list.isPending && (
            <RefreshCw className="size-4 animate-spin text-muted-foreground" />
          )}
        </div>
        <div className="flex flex-wrap gap-2 border-b px-4 py-3">
          {FILTERS.filter((f) => tracks || f.value !== "inactive").map((f) => (
            <button
              key={f.value}
              type="button"
              data-on={filter === f.value}
              onClick={() => update({ filter: f.value, page: "1", sort: null })}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-full border px-3 font-medium text-sm transition-colors hover:bg-muted data-[on=true]:border-primary/40 data-[on=true]:bg-accent data-[on=true]:text-accent-foreground",
                chipTone[f.value],
              )}
            >
              {f.label}
              <span className="rounded-full bg-background/70 px-1.5 text-xs tabular">
                {counts.data ? num(counts.data[f.count]) : "·"}
              </span>
            </button>
          ))}
        </div>

        {list.isPending ? (
          <LoadingBlock />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title={search ? `No member matches “${search}”` : "No members in this list"}
            description={
              search
                ? "Check the spelling, or search by phone number or member ID."
                : "Members appear here once registered."
            }
            action={
              canRegister && (
                <Button onClick={() => navigate("/members/new")}>
                  <UserPlus /> Register a member
                </Button>
              )
            }
          />
        ) : (
          <>
            <Table className={cn(list.isPlaceholderData && "opacity-60")}>
              <THead>
                <tr>
                  <TH>Member</TH>
                  <TH>Phone</TH>
                  <TH>Plan</TH>
                  <TH>Membership</TH>
                  <TH className="text-right">Fee due</TH>
                  <TH>Last visit</TH>
                  <TH className="w-12" />
                </tr>
              </THead>
              <TBody>
                {list.data.items.map((m) => (
                  <TR
                    key={m.id}
                    interactive
                    tabIndex={0}
                    onClick={() => navigate(`/members/${m.id}`)}
                    onKeyDown={(e) => e.key === "Enter" && navigate(`/members/${m.id}`)}
                  >
                    <TD className="max-w-72">
                      <MemberCell
                        id={m.id}
                        name={m.fullName}
                        code={m.memberCode}
                        photoVersion={m.photoVersion}
                        sub={m.timing ?? undefined}
                      />
                    </TD>
                    <TD className="whitespace-nowrap tabular">{phoneDisplay(m.phone)}</TD>
                    <TD className="max-w-40 truncate">
                      {m.planName ?? <span className="text-muted-foreground">—</span>}
                    </TD>
                    <TD>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={m.status} />
                        <span className="text-muted-foreground text-xs">
                          {statusDetail(m.status, m.daysLeft, m.endDate)}
                          {m.endDate &&
                          m.status !== "none" &&
                          m.status !== "archived" &&
                          !statusDetail(m.status, m.daysLeft, m.endDate).startsWith("Till")
                            ? ` · ${formatDate(m.endDate)}`
                            : ""}
                        </span>
                      </div>
                    </TD>
                    <TD
                      className={cn(
                        "text-right font-medium tabular",
                        m.balance > 0 ? "text-danger-ink" : "text-muted-foreground",
                      )}
                    >
                      {m.balance > 0 ? money(m.balance) : m.balance < 0 ? `Adv ${money(-m.balance)}` : "—"}
                    </TD>
                    <TD className="whitespace-nowrap text-muted-foreground text-sm">
                      {m.lastVisitAt ? timeAgo(m.lastVisitAt) : "Never"}
                    </TD>
                    <TD onClick={(e) => e.stopPropagation()}>
                      <RowActions member={m} onWhatsapp={() => whatsapp(m)} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination
              page={page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              onPage={(p) => update({ page: String(p) })}
            />
          </>
        )}
      </Card>
    </PageContainer>
  );
}

function RowActions({ member, onWhatsapp }: { member: MemberRow; onWhatsapp: () => void }) {
  const navigate = useNavigate();
  const canPay = useCan("recordPayments");
  const canRenew = useCan("renewMemberships");
  const tracks = useTracksAttendance();
  const checkIn = async () => {
    try {
      const r = await api.attendance.checkIn({ memberId: member.id, method: "manual" });
      if (r.outcome === "duplicate")
        toast.info(`${member.fullName} already checked in at ${r.checkedInAt?.slice(11, 16)}`);
      else if (r.outcome === "blocked") toast.error(`Check-in refused: ${r.warnings.join(" ")}`);
      else
        toast.success(`${member.fullName} checked in`, {
          description: r.warnings.join(" · ") || undefined,
          icon: <CircleCheck className="size-4" />,
        });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${member.fullName}`}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => navigate(`/members/${member.id}`)}>
          <Eye /> Open profile
        </DropdownMenuItem>
        {tracks && (
          <DropdownMenuItem onSelect={() => void checkIn()} disabled={member.status === "archived"}>
            <ScanLine /> Check in now
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {canRenew && (
          <DropdownMenuItem onSelect={() => openDialog({ type: "renew", memberId: member.id })}>
            <RefreshCw /> Renew membership
          </DropdownMenuItem>
        )}
        {canPay && (
          <DropdownMenuItem onSelect={() => openDialog({ type: "payment", memberId: member.id })}>
            <Wallet /> Receive payment
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onWhatsapp}>
          <MessageCircle /> Send WhatsApp
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
