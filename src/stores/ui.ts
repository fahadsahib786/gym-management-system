import { create } from "zustand";
import { storageGet, storageSet } from "@/lib/utils";

export type Theme = "light" | "dark" | "system";
export type TextSize = "normal" | "large";

interface UiState {
  theme: Theme;
  textSize: TextSize;
  sidebarCollapsed: boolean;
  setTheme: (t: Theme) => void;
  setTextSize: (s: TextSize) => void;
  toggleSidebar: () => void;
}

const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && !!media?.matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function applyTextSize(size: TextSize) {
  document.documentElement.dataset.text = size;
}

const initialTheme = (storageGet("df.theme") as Theme | null) ?? "light";
const initialText = (storageGet("df.text") as TextSize | null) ?? "normal";

export const useUi = create<UiState>((set, get) => ({
  theme: initialTheme,
  textSize: initialText,
  sidebarCollapsed: storageGet("df.sidebar") === "collapsed",
  setTheme: (theme) => {
    storageSet("df.theme", theme);
    applyTheme(theme);
    set({ theme });
  },
  setTextSize: (textSize) => {
    storageSet("df.text", textSize);
    applyTextSize(textSize);
    set({ textSize });
  },
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    storageSet("df.sidebar", next ? "collapsed" : "open");
    set({ sidebarCollapsed: next });
  },
}));

/** Applies saved appearance before React renders (no flash) and follows the OS theme when "system". */
export function initAppearance() {
  applyTheme(initialTheme);
  applyTextSize(initialText);
  media?.addEventListener("change", () => {
    if (useUi.getState().theme === "system") applyTheme("system");
  });
}
