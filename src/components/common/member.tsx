import {
  Archive,
  CalendarClock,
  CircleCheck,
  CircleDashed,
  CircleX,
  Hourglass,
  Snowflake,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import type { MemberStatus } from "@/api/bindings";
import { Badge, type BadgeVariant } from "@/components/ui/primitives";
import { formatDate, initials } from "@/lib/format";
import { photoUrl } from "@/lib/photo";
import { cn } from "@/lib/utils";

export const STATUS_META: Record<
  MemberStatus,
  { label: string; variant: BadgeVariant; icon: typeof CircleCheck; dot: string }
> = {
  active: { label: "Active", variant: "success", icon: CircleCheck, dot: "bg-success" },
  expiring: { label: "Expiring", variant: "warning", icon: Hourglass, dot: "bg-warning" },
  frozen: { label: "Frozen", variant: "info", icon: Snowflake, dot: "bg-info" },
  expired: { label: "Expired", variant: "danger", icon: CircleX, dot: "bg-danger" },
  upcoming: { label: "Starts soon", variant: "upcoming", icon: CalendarClock, dot: "bg-upcoming" },
  none: { label: "No plan", variant: "neutral", icon: CircleDashed, dot: "bg-muted-foreground" },
  archived: { label: "Archived", variant: "neutral", icon: Archive, dot: "bg-muted-foreground" },
};

export function StatusBadge({ status, className }: { status: MemberStatus; className?: string }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Badge variant={meta.variant} className={className}>
      <Icon />
      {meta.label}
    </Badge>
  );
}

/** Plain-language detail under a status: "12 days left", "Expired 3 days ago", ... */
export function statusDetail(
  status: MemberStatus,
  daysLeft: number | null | undefined,
  endDate?: string | null,
): string {
  const d = daysLeft ?? 0;
  switch (status) {
    case "active":
      return d > 45 ? `Till ${formatDate(endDate)}` : `${d} days left`;
    case "expiring":
      return d <= 0 ? "Last day today" : d === 1 ? "1 day left" : `${d} days left`;
    case "expired":
      return -d === 1 ? "Expired yesterday" : `Expired ${-d} days ago`;
    case "frozen":
      return "Membership paused";
    case "upcoming":
      return "Starts soon";
    case "none":
      return "No membership yet";
    case "archived":
      return "Left the gym";
  }
}

const avatarSizes = {
  xs: "size-7 text-[10px]",
  sm: "size-9 text-xs",
  md: "size-11 text-sm",
  lg: "size-16 text-lg",
  xl: "size-28 text-3xl",
};

const avatarColors = [
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
];

function colorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return avatarColors[h % avatarColors.length];
}

export function MemberAvatar({
  id,
  name,
  photoVersion,
  size = "sm",
  thumb = true,
  className,
}: {
  id: string;
  name: string;
  photoVersion: number;
  size?: keyof typeof avatarSizes;
  thumb?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const url = photoUrl(id, photoVersion, thumb);
  return (
    <div
      className={cn(
        "relative flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold",
        avatarSizes[size],
        !url || failed ? colorFor(id) : "bg-muted",
        className,
      )}
    >
      {url && !failed ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          draggable={false}
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        initials(name)
      )}
    </div>
  );
}

/** Avatar + name + member code, for table cells and lists. */
export function MemberCell({
  id,
  name,
  code,
  photoVersion,
  sub,
  size = "sm",
}: {
  id: string;
  name: string;
  code: string;
  photoVersion: number;
  sub?: ReactNode;
  size?: "xs" | "sm" | "md";
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <MemberAvatar id={id} name={name} photoVersion={photoVersion} size={size} />
      <div className="min-w-0">
        <div className="truncate font-medium">{name}</div>
        <div className="truncate text-muted-foreground text-xs">
          {code}
          {sub ? <> · {sub}</> : null}
        </div>
      </div>
    </div>
  );
}
