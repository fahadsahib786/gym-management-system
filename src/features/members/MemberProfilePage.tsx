import { useQuery } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Camera,
  ChevronDown,
  CircleCheck,
  FileDown,
  HandCoins,
  HeartPulse,
  IdCard,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  ScanLine,
  Snowflake,
  Trash,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import type { Member, PhotoInput } from "@/api/bindings";
import { api } from "@/api/client";
import { errorMessage } from "@/api/errors";
import { MemberAvatar, StatusBadge, statusDetail } from "@/components/common/member";
import { ErrorState, LoadingBlock, PageContainer } from "@/components/common/page";
import { ConfirmDialog } from "@/components/common/widgets";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/menus";
import { Badge, Card, Progress } from "@/components/ui/primitives";
import { useMember, useSettings, useTracksAttendance } from "@/hooks/queries";
import { daysFromToday, formatDate, money, num, phoneDisplay, timeAgo } from "@/lib/format";
import { photoUrl } from "@/lib/photo";
import { memberValues, type TemplateKey } from "@/lib/templates";
import { cn } from "@/lib/utils";
import { openDialog } from "@/stores/dialogs";
import { useCan } from "@/stores/session";
import { type CardMember, printMemberCards, saveMemberCardsPdf } from "./MemberCard";
import { PhotoCapture } from "./PhotoCapture";
import {
  ActivityTab,
  AttendanceTab,
  LedgerTab,
  MembershipsTab,
  MessagesTab,
  OverviewTab,
  ProgressTab,
} from "./profile/tabs";

function MembershipProgress({ m }: { m: Member }) {
  if (!m.startDate || !m.endDate || m.status === "none") {
    return <p className="text-muted-foreground text-sm">No membership yet.</p>;
  }
  const start = new Date(`${m.startDate}T00:00:00`).getTime();
  const end = new Date(`${m.endDate}T23:59:59`).getTime();
  const pct = ((Date.now() - start) / Math.max(1, end - start)) * 100;
  const bar =
    m.status === "expired"
      ? "bg-danger"
      : m.status === "expiring"
        ? "bg-warning"
        : m.status === "frozen"
          ? "bg-info"
          : "bg-success";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{m.planName}</span>
        <span className="text-muted-foreground text-xs">{statusDetail(m.status, m.daysLeft, m.endDate)}</span>
      </div>
      <Progress value={m.status === "expired" ? 100 : pct} barClassName={bar} />
      <div className="flex justify-between text-muted-foreground text-xs">
        <span>{formatDate(m.startDate)}</span>
        <span>{formatDate(m.endDate)}</span>
      </div>
      {m.status === "frozen" && m.freezeEnd && (
        <p className="text-info-ink text-xs">
          <Snowflake className="mr-1 inline size-3" />
          Frozen until {formatDate(m.freezeEnd)} (days are added to the end date)
        </p>
      )}
    </div>
  );
}

function PhotoDialog({ member, onOpenChange }: { member: Member; onOpenChange: (o: boolean) => void }) {
  const [photo, setPhoto] = useState<PhotoInput | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!photo) return;
    setBusy(true);
    try {
      await api.members.setPhoto(member.id, photo);
      toast.success("Photo saved");
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    try {
      await api.members.removePhoto(member.id);
      toast.success("Photo removed");
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Photo of {member.fullName}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <PhotoCapture
            value={photo}
            onChange={setPhoto}
            currentUrl={photoUrl(member.id, member.photoVersion)}
            onRemoveCurrent={remove}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!photo} loading={busy}>
            Save photo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MemberProfilePage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const member = useMember(id);
  const settings = useSettings();
  const tracks = useTracksAttendance();
  const canEdit = useCan("editMembers");
  const canPay = useCan("recordPayments");
  const canRenew = useCan("renewMemberships");
  const canFreeze = useCan("manageFreezes");
  const canCharge = useCan("addCharges");
  const canArchive = useCan("archiveMembers");
  const canDelete = useCan("deleteMembers");
  const [tab, setTab] = useState("overview");
  const [photoOpen, setPhotoOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const freezes = useQuery({ queryKey: ["freezes", id], queryFn: () => api.freezes.list(id), enabled: !!id });

  if (member.isPending) return <LoadingBlock className="py-24" />;
  if (member.error)
    return <ErrorState className="py-24" error={member.error} onRetry={() => member.refetch()} />;
  const m = member.data;
  const archived = m.status === "archived";
  const card: CardMember = {
    id: m.id,
    fullName: m.fullName,
    memberCode: m.memberCode,
    photoVersion: m.photoVersion,
    joinDate: m.joinDate,
    phone: m.phone,
    gender: m.gender,
    fatherName: m.fatherName,
    cnic: m.cnic,
    bloodGroup: m.bloodGroup,
    timing: m.timing,
  };

  const checkIn = async () => {
    try {
      const r = await api.attendance.checkIn({ memberId: m.id, method: "manual" });
      if (r.outcome === "duplicate") toast.info(`Already checked in at ${r.checkedInAt?.slice(11, 16)}`);
      else if (r.outcome === "blocked") toast.error(`Check-in refused: ${r.warnings.join(" ")}`);
      else
        toast.success(`${m.fullName} checked in`, {
          description: r.warnings.join(" · ") || undefined,
          icon: <CircleCheck className="size-4" />,
        });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const whatsapp = (template: TemplateKey) => {
    if (!settings.data) return;
    openDialog({
      type: "whatsapp",
      memberId: m.id,
      phone: m.whatsapp ?? m.phone,
      template,
      title: `WhatsApp ${m.fullName}`,
      values: memberValues(m, settings.data.gym),
    });
  };
  const suggestedTemplate: TemplateKey =
    m.status === "expired"
      ? "expiredReminder"
      : m.balance > 0
        ? "duesReminder"
        : m.status === "expiring"
          ? "expiryReminder"
          : "inactive";

  const activeFreeze = freezes.data?.find((f) => f.state === "active" || f.state === "scheduled");
  const birthdayIn = m.dateOfBirth
    ? daysFromToday(`${new Date().getFullYear()}${m.dateOfBirth.slice(4)}`)
    : null;

  return (
    <PageContainer>
      <div className="mb-4 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft /> Back
        </Button>
        <span className="text-muted-foreground text-sm">
          <Link to="/members" className="hover:underline">
            Members
          </Link>{" "}
          / {m.memberCode}
        </span>
      </div>

      <Card className="mb-5 overflow-hidden">
        <div className="grid gap-6 p-5 xl:grid-cols-[auto_minmax(0,1fr)_minmax(0,300px)_auto]">
          <div className="relative self-start">
            <button
              type="button"
              onClick={() => canEdit && setPhotoOpen(true)}
              className="group relative block rounded-full"
              aria-label="Change photo"
            >
              <MemberAvatar
                id={m.id}
                name={m.fullName}
                photoVersion={m.photoVersion}
                size="xl"
                thumb={false}
                className="ring-4 ring-background"
              />
              {canEdit && (
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
                  <Camera className="size-6" />
                </span>
              )}
            </button>
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate font-semibold text-2xl tracking-tight">{m.fullName}</h1>
              <StatusBadge status={m.status} />
              {birthdayIn === 0 && <Badge variant="upcoming">🎂 Birthday today</Badge>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-sm">
              <span className="font-medium text-foreground">{m.memberCode}</span>
              <span className="inline-flex items-center gap-1">
                <Phone className="size-3.5" /> {phoneDisplay(m.phone)}
              </span>
              {m.timing && <span>{m.timing}</span>}
              <span>Joined {formatDate(m.joinDate)}</span>
              {m.age !== null && <span>{m.age} yrs</span>}
            </div>
            {m.medicalNotes && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-danger-ink text-sm">
                <HeartPulse className="mt-0.5 size-4 shrink-0" /> <span>{m.medicalNotes}</span>
              </div>
            )}
            <div className="mt-4 max-w-xl">
              <MembershipProgress m={m} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 self-start">
            <div
              className={cn(
                "col-span-2 rounded-xl p-3",
                m.balance > 0
                  ? "bg-danger-soft text-danger-ink"
                  : m.balance < 0
                    ? "bg-info-soft text-info-ink"
                    : "bg-success-soft text-success-ink",
              )}
            >
              <div className="text-xs opacity-80">
                {m.balance > 0 ? "Fee due" : m.balance < 0 ? "Advance (credit)" : "Fees"}
              </div>
              <div className="font-semibold text-xl">
                {m.balance === 0 ? "All paid" : money(Math.abs(m.balance))}
              </div>
            </div>
            <div className="rounded-xl bg-muted/60 p-3">
              <div className="text-muted-foreground text-xs">Total paid</div>
              <div className="font-semibold">{money(m.totalPaid)}</div>
            </div>
            <div className={cn("rounded-xl bg-muted/60 p-3", !tracks && "hidden")}>
              <div className="text-muted-foreground text-xs">Visits (30 days)</div>
              <div className="font-semibold">{num(m.visitsLast30Days)}</div>
              <div className="text-muted-foreground text-xs">
                Last: {m.lastVisitAt ? timeAgo(m.lastVisitAt) : "never"}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 self-start xl:w-48">
            {tracks && (
              <Button onClick={checkIn} disabled={archived}>
                <ScanLine /> Check in
              </Button>
            )}
            {canPay && (
              <Button variant="outline" onClick={() => openDialog({ type: "payment", memberId: m.id })}>
                <Wallet /> Receive payment
              </Button>
            )}
            {canRenew && (
              <Button variant="outline" onClick={() => openDialog({ type: "renew", memberId: m.id })}>
                <RefreshCw /> Renew
              </Button>
            )}
            <div className="flex gap-2">
              <Button variant="whatsapp" className="flex-1" onClick={() => whatsapp(suggestedTemplate)}>
                <MessageCircle /> WhatsApp
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="More actions">
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => whatsapp("expiryReminder")}>
                    <MessageCircle /> Expiry reminder
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => whatsapp("duesReminder")}>
                    <MessageCircle /> Fee reminder
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => whatsapp("birthday")}>
                    <MessageCircle /> Birthday wish
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => settings.data && void printMemberCards([card], settings.data.gym)}
                  >
                    <IdCard /> Print member card
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => settings.data && void saveMemberCardsPdf([card], settings.data.gym)}
                  >
                    <FileDown /> Member card PDF
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {canCharge && (
                    <DropdownMenuItem onSelect={() => openDialog({ type: "charge", memberId: m.id })}>
                      <Plus /> Add charge (PT, locker, fine…)
                    </DropdownMenuItem>
                  )}
                  {canFreeze && !activeFreeze && (m.status === "active" || m.status === "expiring") && (
                    <DropdownMenuItem onSelect={() => openDialog({ type: "freeze", memberId: m.id })}>
                      <Snowflake /> Freeze membership
                    </DropdownMenuItem>
                  )}
                  {canEdit && (
                    <DropdownMenuItem onSelect={() => navigate(`/members/${m.id}/edit`)}>
                      <Pencil /> Edit details
                    </DropdownMenuItem>
                  )}
                  {canArchive && (
                    <>
                      <DropdownMenuSeparator />
                      {archived ? (
                        <DropdownMenuItem
                          onSelect={async () => {
                            try {
                              await api.members.restore(m.id);
                              toast.success("Member restored");
                            } catch (e) {
                              toast.error(errorMessage(e));
                            }
                          }}
                        >
                          <ArchiveRestore /> Restore member
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onSelect={() => setArchiveOpen(true)}>
                          <Archive /> Archive (left the gym)
                        </DropdownMenuItem>
                      )}
                    </>
                  )}
                  {canDelete && (
                    <DropdownMenuItem destructive onSelect={() => setDeleteOpen(true)}>
                      <Trash /> Delete permanently
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {m.balance > 0 && canPay && (
              <button
                type="button"
                className="inline-flex items-center justify-center gap-1 text-danger-ink text-xs hover:underline"
                onClick={() => openDialog({ type: "payment", memberId: m.id })}
              >
                <HandCoins className="size-3.5" /> Collect {money(m.balance)}
              </button>
            )}
          </div>
        </div>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="memberships">Memberships</TabsTrigger>
          <TabsTrigger value="ledger">Payments & fees</TabsTrigger>
          {tracks && <TabsTrigger value="attendance">Attendance</TabsTrigger>}
          <TabsTrigger value="progress">Progress</TabsTrigger>
          <TabsTrigger value="messages">Messages</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab member={m} freezes={freezes.data ?? []} />
        </TabsContent>
        <TabsContent value="memberships">
          <MembershipsTab member={m} />
        </TabsContent>
        <TabsContent value="ledger">
          <LedgerTab member={m} />
        </TabsContent>
        <TabsContent value="attendance">
          <AttendanceTab member={m} />
        </TabsContent>
        <TabsContent value="progress">
          <ProgressTab member={m} />
        </TabsContent>
        <TabsContent value="messages">
          <MessagesTab member={m} />
        </TabsContent>
        <TabsContent value="history">
          <ActivityTab member={m} />
        </TabsContent>
      </Tabs>

      {photoOpen && <PhotoDialog member={m} onOpenChange={setPhotoOpen} />}
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={`Archive ${m.fullName}?`}
        description="Use this when a member has left the gym. Their history is kept and you can restore them any time (renewing also restores them)."
        confirmLabel="Archive member"
        requireReason={false}
        reasonLabel="Reason (optional)"
        onConfirm={async () => {
          try {
            await api.members.archive(m.id, null);
            toast.success("Member archived");
          } catch (e) {
            toast.error(errorMessage(e));
            throw e;
          }
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${m.fullName} permanently?`}
        description="Only possible for members registered by mistake, with no membership or payment history. This cannot be undone."
        confirmLabel="Delete forever"
        destructive
        onConfirm={async () => {
          try {
            await api.members.remove(m.id);
            toast.success("Member deleted");
            navigate("/members", { replace: true });
          } catch (e) {
            toast.error(errorMessage(e));
            throw e;
          }
        }}
      />
    </PageContainer>
  );
}
