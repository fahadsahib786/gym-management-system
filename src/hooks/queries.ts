import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "@/api/client";
import { setCurrency } from "@/lib/format";

/** Shared query keys so invalidation stays consistent. */
export const qk = {
  settings: ["settings"] as const,
  plans: (includeInactive: boolean) => ["plans", includeInactive] as const,
  member: (id: string) => ["member", id] as const,
  suggestions: ["member-suggestions"] as const,
  categories: (includeInactive: boolean) => ["expense-categories", includeInactive] as const,
};

export function useSettings() {
  const q = useQuery({ queryKey: qk.settings, queryFn: api.settings.get, staleTime: 60_000 });
  useEffect(() => {
    if (q.data) setCurrency(q.data.billing.currency);
  }, [q.data]);
  return q;
}

/** Whether the gym records check-ins (Settings → Membership rules). Treated as on while settings load. */
export function useTracksAttendance(): boolean {
  return useSettings().data?.membership.trackAttendance ?? true;
}

export function usePlans(includeInactive = false) {
  return useQuery({
    queryKey: qk.plans(includeInactive),
    queryFn: () => api.plans.list(includeInactive),
    staleTime: 30_000,
  });
}

export function useMember(id: string | undefined) {
  return useQuery({
    queryKey: qk.member(id ?? ""),
    queryFn: () => api.members.get(id as string),
    enabled: !!id,
  });
}

export function useExpenseCategories(includeInactive = false) {
  return useQuery({
    queryKey: qk.categories(includeInactive),
    queryFn: () => api.expenses.categories(includeInactive),
    staleTime: 60_000,
  });
}
