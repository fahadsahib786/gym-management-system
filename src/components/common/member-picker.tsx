import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { MemberQuick } from "@/api/bindings";
import { api } from "@/api/client";
import { useDebounce } from "@/hooks/common";
import { money, phoneDisplay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SearchInput } from "./fields";
import { MemberAvatar, StatusBadge, statusDetail } from "./member";

/** Search box + results list to choose a member (payment dialog, quick actions). */
export function MemberPicker({
  onPick,
  autoFocus = true,
}: {
  onPick: (m: MemberQuick) => void;
  autoFocus?: boolean;
}) {
  const [term, setTerm] = useState("");
  const q = useDebounce(term.trim(), 120);
  const results = useQuery({
    queryKey: ["picker", q],
    queryFn: () => api.members.quickSearch(q, 8),
    enabled: q.length > 0,
  });
  return (
    <div className="flex flex-col gap-2">
      <SearchInput
        autoFocus={autoFocus}
        value={term}
        onChange={setTerm}
        placeholder="Type name, phone or member ID…"
        onKeyDown={(e) => {
          if (e.key === "Enter" && results.data?.length) onPick(results.data[0]);
        }}
      />
      <div className="min-h-24">
        {results.isFetching && !results.data && (
          <div className="flex items-center gap-2 p-3 text-muted-foreground text-sm">
            <LoaderCircle className="size-4 animate-spin" /> Searching…
          </div>
        )}
        {q && results.data?.length === 0 && (
          <p className="p-3 text-muted-foreground text-sm">No member found.</p>
        )}
        <ul className="flex flex-col gap-1">
          {results.data?.map((m, i) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onPick(m)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors hover:bg-muted",
                  i === 0 && "border-primary/30",
                )}
              >
                <MemberAvatar id={m.id} name={m.fullName} photoVersion={m.photoVersion} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-sm">{m.fullName}</div>
                  <div className="truncate text-muted-foreground text-xs">
                    {m.memberCode} · {phoneDisplay(m.phone)}
                  </div>
                </div>
                {m.balance > 0 && (
                  <span className="font-medium text-danger-ink text-xs">Due {money(m.balance)}</span>
                )}
                <StatusBadge status={m.status} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Compact member header used inside dialogs. */
export function MemberSummary({ member, onChange }: { member: MemberQuick; onChange?: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-3">
      <MemberAvatar id={member.id} name={member.fullName} photoVersion={member.photoVersion} size="md" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{member.fullName}</div>
        <div className="flex flex-wrap items-center gap-x-2 text-muted-foreground text-xs">
          <span>{member.memberCode}</span>
          <span>{phoneDisplay(member.phone)}</span>
          <span>{statusDetail(member.status, member.daysLeft, member.endDate)}</span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <StatusBadge status={member.status} />
        {onChange && (
          <button type="button" className="text-primary text-xs hover:underline" onClick={onChange}>
            Change
          </button>
        )}
      </div>
    </div>
  );
}
