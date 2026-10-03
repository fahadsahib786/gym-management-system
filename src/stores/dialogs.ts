import { create } from "zustand";
import type { TemplateKey, TemplateValues } from "@/lib/templates";

/** App-wide dialogs that can be opened from any screen (shortcuts, dashboard lists, profile, ...). */
export type DialogRequest =
  | { type: "payment"; memberId?: string }
  | { type: "renew"; memberId: string }
  | { type: "charge"; memberId: string }
  | { type: "freeze"; memberId: string }
  | { type: "receipt"; paymentId: string; autoPrint?: boolean }
  | {
      type: "whatsapp";
      memberId?: string | null;
      phone: string;
      template: TemplateKey | "custom";
      values: TemplateValues;
      title?: string;
    };

interface DialogState {
  current: DialogRequest | null;
  open: (request: DialogRequest) => void;
  close: () => void;
}

export const useDialogs = create<DialogState>((set) => ({
  current: null,
  open: (current) => set({ current }),
  close: () => set({ current: null }),
}));

export const openDialog = (request: DialogRequest) => useDialogs.getState().open(request);
