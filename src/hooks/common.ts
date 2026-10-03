import { useEffect, useRef, useState } from "react";

export function useDebounce<T>(value: T, ms = 160): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

type Handler = (e: KeyboardEvent) => void;

/**
 * Global keyboard shortcuts, e.g. `{ F2: openNewMember, "ctrl+k": openSearch }`.
 * Function keys and ctrl-combos work even while typing; plain keys are ignored inside inputs.
 */
export function useHotkeys(map: Record<string, Handler>, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const combo = `${e.ctrlKey || e.metaKey ? "ctrl+" : ""}${e.altKey ? "alt+" : ""}${key}`;
      const handler = ref.current[combo];
      if (!handler) return;
      const target = e.target as HTMLElement | null;
      const typing =
        !!target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      const special = /^F\d+$/.test(key) || combo.startsWith("ctrl+");
      if (typing && !special) return;
      e.preventDefault();
      handler(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

/** Calls `onIdle` after `minutes` without mouse/keyboard activity (0 = disabled). */
export function useIdle(minutes: number, onIdle: () => void) {
  const cb = useRef(onIdle);
  cb.current = onIdle;
  useEffect(() => {
    if (!minutes) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => cb.current(), minutes * 60_000);
    };
    const events = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const;
    for (const ev of events) window.addEventListener(ev, reset, { passive: true });
    reset();
    return () => {
      clearTimeout(timer);
      for (const ev of events) window.removeEventListener(ev, reset);
    };
  }, [minutes]);
}
