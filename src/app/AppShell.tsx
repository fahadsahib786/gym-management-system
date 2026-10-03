import { useQuery } from "@tanstack/react-query";
import {
  ChartColumn,
  CircleAlert,
  CircleCheck,
  Dumbbell,
  HandCoins,
  LayoutDashboard,
  Lock,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  ScanLine,
  ScrollText,
  Search,
  Settings,
  Tag,
  TriangleAlert,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { Suspense, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import type { Permission } from "@/api/bindings";
import { api } from "@/api/client";
import { LoadingBlock } from "@/components/common/page";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/menus";
import { Kbd } from "@/components/ui/primitives";
import { useHotkeys, useIdle } from "@/hooks/common";
import { useSettings, useTracksAttendance } from "@/hooks/queries";
import { initials, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { openDialog } from "@/stores/dialogs";
import { can, useSession } from "@/stores/session";
import { useUi } from "@/stores/ui";
import { CommandPalette } from "./CommandPalette";
import { GlobalDialogs } from "./GlobalDialogs";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Users;
  permission?: Permission;
  badge?: "dues" | "expiring";
  /** Only shown when the gym records check-ins. */
  attendance?: boolean;
}

const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: "Front desk",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard },
      { to: "/check-in", label: "Check-in", icon: ScanLine, attendance: true },
      { to: "/members", label: "Members", icon: Users, badge: "expiring" },
      { to: "/payments", label: "Payments", icon: Wallet },
      { to: "/dues", label: "Fee dues", icon: HandCoins, badge: "dues" },
      { to: "/messages", label: "WhatsApp", icon: MessageCircle, permission: "sendMessages" },
    ],
  },
  {
    title: "Management",
    items: [
      { to: "/expenses", label: "Expenses", icon: Receipt, permission: "viewExpenses" },
      { to: "/reports", label: "Reports", icon: ChartColumn, permission: "viewReports" },
      { to: "/plans", label: "Plans & fees", icon: Tag },
      { to: "/activity", label: "Activity log", icon: ScrollText, permission: "viewAudit" },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

function Sidebar() {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const actor = useSession((s) => s.actor);
  const logout = useSession((s) => s.logout);
  const settings = useSettings();
  const tracks = useTracksAttendance();
  const counts = useQuery({
    queryKey: ["member-counts", ""],
    queryFn: () => api.members.counts(null),
    refetchInterval: 60_000,
  });
  const gym = settings.data?.gym;

  return (
    <aside
      className={cn(
        "flex h-screen shrink-0 flex-col border-sidebar-border border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-[68px]" : "w-60",
      )}
    >
      <div className={cn("flex h-16 items-center gap-3 px-4", collapsed && "justify-center px-0")}>
        {gym?.logo ? (
          <img src={gym.logo} alt="" className="size-9 shrink-0 rounded-lg bg-white object-contain" />
        ) : (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 shadow">
            <Dumbbell className="size-5 text-white" />
          </div>
        )}
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate font-semibold text-[0.95rem] text-white leading-tight">
              {gym?.name ?? "Danish Fitness"}
            </div>
            <div className="truncate text-sidebar-muted text-xs">{gym?.city ?? ""}</div>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 pb-2">
        {NAV.map((group) => (
          <div key={group.title} className="mt-3">
            {!collapsed && (
              <div className="px-2.5 pb-1.5 font-medium text-[0.7rem] text-sidebar-muted uppercase tracking-wider">
                {group.title}
              </div>
            )}
            <ul className="flex flex-col gap-0.5">
              {group.items
                .filter((i) => (!i.permission || can(actor, i.permission)) && (!i.attendance || tracks))
                .map((item) => {
                  const badge =
                    item.badge === "dues"
                      ? counts.data?.dues
                      : item.badge === "expiring"
                        ? counts.data?.expiring
                        : undefined;
                  const link = (
                    <NavLink
                      to={item.to}
                      end={item.to === "/"}
                      className={({ isActive }) =>
                        cn(
                          "group flex h-10 items-center gap-3 rounded-lg px-2.5 font-medium text-sm transition-colors",
                          collapsed && "justify-center px-0",
                          isActive
                            ? "bg-indigo-500/20 text-white"
                            : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-white",
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <item.icon
                            className={cn(
                              "size-[18px] shrink-0",
                              isActive ? "text-indigo-300" : "text-sidebar-muted group-hover:text-white",
                            )}
                          />
                          {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                          {!collapsed && !!badge && (
                            <span
                              className={cn(
                                "min-w-5 rounded-full px-1.5 text-center font-semibold text-[0.7rem] leading-5",
                                item.badge === "dues"
                                  ? "bg-red-500/90 text-white"
                                  : "bg-amber-400/90 text-amber-950",
                              )}
                            >
                              {badge > 99 ? "99+" : badge}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  );
                  return (
                    <li key={item.to}>
                      {collapsed ? (
                        <Tooltip content={item.label} side="right">
                          {link}
                        </Tooltip>
                      ) : (
                        link
                      )}
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-sidebar-border border-t p-2.5">
        <div className={cn("flex items-center gap-2.5 rounded-lg p-1.5", collapsed && "flex-col")}>
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-indigo-500/25 font-semibold text-indigo-200 text-xs">
            {initials(actor?.name ?? "?")}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-sm text-white">{actor?.name}</div>
              <div className="truncate text-sidebar-muted text-xs">
                {actor?.role === "admin" ? "Owner / Admin" : "Receptionist"}
              </div>
            </div>
          )}
          <Tooltip content="Lock screen (switch user)">
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-md p-2 text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-white"
              aria-label="Lock screen"
            >
              <Lock className="size-4" />
            </button>
          </Tooltip>
        </div>
        {!collapsed && (
          <p className="mt-2 px-1.5 text-[0.68rem] text-sidebar-muted/80 leading-snug">
            Designed &amp; developed by{" "}
            <span className="font-medium text-sidebar-foreground/80">Fahad Baloch</span>
          </p>
        )}
      </div>
    </aside>
  );
}

function BackupChip() {
  const navigate = useNavigate();
  const status = useQuery({
    queryKey: ["backup-status"],
    queryFn: api.backup.status,
    refetchInterval: 120_000,
  });
  const last = status.data?.lastBackupAt;
  const stale = !last || Date.now() - new Date(last.replace(" ", "T")).getTime() > 2 * 24 * 3600 * 1000;
  return (
    <Tooltip content={last ? `Last backup: ${timeAgo(last)}` : "No backup yet — open Settings → Backup"}>
      <button
        type="button"
        onClick={() => navigate("/settings?tab=backup")}
        className={cn(
          "hidden items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-xs xl:inline-flex",
          stale ? "bg-warning-soft text-warning-ink" : "bg-success-soft text-success-ink",
        )}
      >
        {stale ? <CircleAlert className="size-3.5" /> : <CircleCheck className="size-3.5" />}
        {last ? `Backed up ${timeAgo(last)}` : "No backup yet"}
      </button>
    </Tooltip>
  );
}

function Topbar({ onSearch }: { onSearch: () => void }) {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggle = useUi((s) => s.toggleSidebar);
  const navigate = useNavigate();
  const actor = useSession((s) => s.actor);
  const tracks = useTracksAttendance();
  const today = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-card/80 px-4 backdrop-blur">
      <Tooltip content={collapsed ? "Show menu" : "Hide menu"}>
        <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle menu">
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </Button>
      </Tooltip>
      <button
        type="button"
        onClick={onSearch}
        className="flex h-10 w-full max-w-md items-center gap-2.5 rounded-lg border border-input bg-background px-3 text-muted-foreground text-sm transition-colors hover:bg-muted"
      >
        <Search className="size-4" />
        <span className="flex-1 truncate text-left">Search member by name, phone, ID or CNIC…</span>
        <Kbd>Ctrl K</Kbd>
      </button>
      <div className="ml-auto flex items-center gap-2">
        <span className="hidden text-muted-foreground text-sm 2xl:inline">{today}</span>
        <BackupChip />
        {tracks && (
          <Tooltip content="Check-in (F4)">
            <Button variant="outline" onClick={() => navigate("/check-in")}>
              <ScanLine /> <span className="hidden lg:inline">Check-in</span>
            </Button>
          </Tooltip>
        )}
        {can(actor, "recordPayments") && (
          <Tooltip content="Receive payment (F3)">
            <Button variant="outline" onClick={() => openDialog({ type: "payment" })}>
              <Wallet /> <span className="hidden lg:inline">Receive payment</span>
            </Button>
          </Tooltip>
        )}
        {can(actor, "registerMembers") && (
          <Tooltip content="New member (F2)">
            <Button onClick={() => navigate("/members/new")}>
              <UserPlus /> <span className="hidden md:inline">New member</span>
            </Button>
          </Tooltip>
        )}
      </div>
    </header>
  );
}

export function AppShell() {
  const navigate = useNavigate();
  const status = useSession((s) => s.status);
  const logout = useSession((s) => s.logout);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const tracks = useTracksAttendance();

  useHotkeys({
    F2: () => navigate("/members/new"),
    F3: () => openDialog({ type: "payment" }),
    F4: () => tracks && navigate("/check-in"),
    "ctrl+k": () => setPaletteOpen(true),
    "ctrl+f": () => setPaletteOpen(true),
  });
  useIdle(status?.autoLockMinutes ?? 0, () => void logout());

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onSearch={() => setPaletteOpen(true)} />
        {status?.clockWarning && (
          <div className="flex items-start gap-2 border-b bg-danger-soft px-5 py-2.5 text-danger-ink text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{status.clockWarning}</span>
          </div>
        )}
        <main className="relative flex-1 overflow-y-auto">
          <Suspense fallback={<LoadingBlock className="py-24" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <GlobalDialogs />
    </div>
  );
}
