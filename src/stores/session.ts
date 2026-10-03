import { create } from "zustand";
import type { Actor, AppStatus, Permission } from "@/api/bindings";
import { api } from "@/api/client";

interface SessionState {
  status: AppStatus | null;
  actor: Actor | null;
  setStatus: (status: AppStatus) => void;
  setActor: (actor: Actor | null) => void;
  /** Ends the session (PIN screen). */
  logout: () => Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  status: null,
  actor: null,
  setStatus: (status) => set({ status }),
  setActor: (actor) => set({ actor }),
  logout: async () => {
    try {
      await api.auth.logout();
    } finally {
      set({ actor: null });
    }
  },
}));

export function can(actor: Actor | null | undefined, permission: Permission): boolean {
  return !!actor?.permissions.includes(permission);
}

/** True when the logged-in user has the permission (UI only — the backend enforces it too). */
export function useCan(permission: Permission): boolean {
  return useSession((s) => can(s.actor, permission));
}

export function useActor(): Actor {
  const actor = useSession((s) => s.actor);
  if (!actor) throw new Error("useActor used outside a session");
  return actor;
}
