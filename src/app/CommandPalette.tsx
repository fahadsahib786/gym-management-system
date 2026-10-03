import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import {
  ChartColumn,
  HandCoins,
  LayoutDashboard,
  LoaderCircle,
  Receipt,
  ScanLine,
  Settings,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "@/api/client";
import { MemberAvatar, StatusBadge } from "@/components/common/member";
import { useDebounce } from "@/hooks/common";
import { useTracksAttendance } from "@/hooks/queries";
import { money, phoneDisplay } from "@/lib/format";
import { openDialog } from "@/stores/dialogs";

const itemClass =
  "flex cursor-pointer select-none items-center gap-3 rounded-lg px-3 py-2.5 text-sm outline-none data-[selected=true]:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground";

/** Ctrl+K: find any member instantly, or jump to a screen/action. */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const tracks = useTracksAttendance();
  const [term, setTerm] = useState("");
  const debounced = useDebounce(term.trim(), 120);
  const results = useQuery({
    queryKey: ["palette-search", debounced],
    queryFn: () => api.members.quickSearch(debounced, 8),
    enabled: open && debounced.length > 0,
    placeholderData: (prev) => prev,
  });

  useEffect(() => {
    if (!open) setTerm("");
  }, [open]);

  const go = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in" />
        <DialogPrimitive.Content className="data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 fixed top-[12%] left-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border bg-popover shadow-2xl data-[state=open]:animate-in">
          <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
          <Command shouldFilter={false} loop>
            <div className="flex items-center gap-2 border-b px-4">
              {results.isFetching ? (
                <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <Users className="size-4 text-muted-foreground" />
              )}
              <Command.Input
                autoFocus
                value={term}
                onValueChange={setTerm}
                placeholder="Type a name, phone number, member ID or CNIC…"
                className="h-14 w-full bg-transparent text-[0.95rem] outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Command.List className="max-h-[60vh] overflow-y-auto p-2">
              {debounced && results.data && results.data.length === 0 && (
                <Command.Empty className="px-3 py-6 text-center text-muted-foreground text-sm">
                  No member found for “{debounced}”.
                </Command.Empty>
              )}
              {debounced && results.data && results.data.length > 0 && (
                <Command.Group
                  heading="Members"
                  className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:text-xs"
                >
                  {results.data.map((m) => (
                    <Command.Item
                      key={m.id}
                      value={m.id}
                      onSelect={() => go(() => navigate(`/members/${m.id}`))}
                      className={itemClass}
                    >
                      <MemberAvatar id={m.id} name={m.fullName} photoVersion={m.photoVersion} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{m.fullName}</div>
                        <div className="truncate text-muted-foreground text-xs">
                          {m.memberCode} · {phoneDisplay(m.phone)}
                          {m.balance > 0 && (
                            <span className="text-danger-ink"> · Due {money(m.balance)}</span>
                          )}
                        </div>
                      </div>
                      <StatusBadge status={m.status} />
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {!debounced && (
                <Command.Group
                  heading="Quick actions"
                  className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:text-xs"
                >
                  <Command.Item className={itemClass} onSelect={() => go(() => navigate("/members/new"))}>
                    <UserPlus /> New member <span className="ml-auto text-muted-foreground text-xs">F2</span>
                  </Command.Item>
                  <Command.Item
                    className={itemClass}
                    onSelect={() => go(() => openDialog({ type: "payment" }))}
                  >
                    <Wallet /> Receive payment{" "}
                    <span className="ml-auto text-muted-foreground text-xs">F3</span>
                  </Command.Item>
                  {tracks && (
                    <Command.Item className={itemClass} onSelect={() => go(() => navigate("/check-in"))}>
                      <ScanLine /> Check-in <span className="ml-auto text-muted-foreground text-xs">F4</span>
                    </Command.Item>
                  )}
                  <Command.Item className={itemClass} onSelect={() => go(() => navigate("/"))}>
                    <LayoutDashboard /> Dashboard
                  </Command.Item>
                  <Command.Item className={itemClass} onSelect={() => go(() => navigate("/dues"))}>
                    <HandCoins /> Fee dues
                  </Command.Item>
                  <Command.Item className={itemClass} onSelect={() => go(() => navigate("/expenses"))}>
                    <Receipt /> Expenses
                  </Command.Item>
                  <Command.Item className={itemClass} onSelect={() => go(() => navigate("/reports"))}>
                    <ChartColumn /> Reports
                  </Command.Item>
                  <Command.Item className={itemClass} onSelect={() => go(() => navigate("/settings"))}>
                    <Settings /> Settings
                  </Command.Item>
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
