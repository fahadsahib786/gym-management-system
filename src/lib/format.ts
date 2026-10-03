import { differenceInCalendarDays, format, isValid, parse, parseISO } from "date-fns";

let currency = "Rs";

/** Set once from settings so every money label uses the gym's currency symbol. */
export function setCurrency(symbol: string) {
  currency = symbol || "Rs";
}

export function getCurrency() {
  return currency;
}

const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function num(n: number | null | undefined): string {
  return intFmt.format(n ?? 0);
}

/** `Rs 3,500` (negative: `-Rs 500`). */
export function money(amount: number | null | undefined): string {
  const v = amount ?? 0;
  return `${v < 0 ? "-" : ""}${currency} ${intFmt.format(Math.abs(v))}`;
}

/** Compact money for axes and tiles: `Rs 45K`, `Rs 1.2M`. */
export function moneyCompact(amount: number): string {
  const v = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (v >= 1_000_000) return `${sign}${currency} ${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000)
    return `${sign}${currency} ${(v / 1_000).toFixed(v >= 100_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return `${sign}${currency} ${intFmt.format(v)}`;
}

export function compact(n: number): string {
  const v = Math.abs(n);
  if (v >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (v >= 10_000) return `${Math.round(n / 1_000)}K`;
  if (v >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return intFmt.format(n);
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isValid(value) ? value : null;
  const s = value.trim();
  const d = s.length <= 10 ? parse(s, "yyyy-MM-dd", new Date()) : parseISO(s.replace(" ", "T"));
  return isValid(d) ? d : null;
}

/** `02 Oct 2026` — unambiguous for everyone (no dd/mm vs mm/dd confusion). */
export function formatDate(value: string | Date | null | undefined, fallback = "—"): string {
  const d = toDate(value);
  return d ? format(d, "dd MMM yyyy") : fallback;
}

export function formatShortDate(value: string | Date | null | undefined, fallback = "—"): string {
  const d = toDate(value);
  return d ? format(d, "dd MMM") : fallback;
}

export function formatTime(value: string | Date | null | undefined, fallback = "—"): string {
  const d = toDate(value);
  return d ? format(d, "hh:mm a") : fallback;
}

export function formatDateTime(value: string | Date | null | undefined, fallback = "—"): string {
  const d = toDate(value);
  return d ? format(d, "dd MMM yyyy, hh:mm a") : fallback;
}

export function todayISO(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function isoDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function parseDate(value: string | null | undefined): Date | null {
  return toDate(value ?? null);
}

/** Calendar days from today to `value` (negative = past). */
export function daysFromToday(value: string | null | undefined): number | null {
  const d = toDate(value ?? null);
  return d ? differenceInCalendarDays(d, new Date()) : null;
}

/** `today`, `tomorrow`, `in 3 days`, `yesterday`, `5 days ago`. */
export function relativeDays(days: number | null | undefined): string {
  if (days === null || days === undefined) return "—";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** Friendly "time ago" for recent events. */
export function timeAgo(value: string | null | undefined): string {
  const d = toDate(value ?? null);
  if (!d) return "never";
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24 && differenceInCalendarDays(new Date(), d) === 0) return `${hours} h ago`;
  const days = differenceInCalendarDays(new Date(), d);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return formatDate(d);
}

/** Display a stored phone (`923001234567` → `0300-1234567`). */
export function phoneDisplay(p: string | null | undefined): string {
  if (!p) return "";
  if (p.length === 12 && p.startsWith("923")) return `0${p.slice(2, 5)}-${p.slice(5)}`;
  return `+${p}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${num(n)} ${n === 1 ? one : many}`;
}

export function percent(part: number, whole: number): string {
  if (!whole) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

/** Signed change vs a previous value: `{ text: "+12%", direction }`. */
export function delta(
  current: number,
  previous: number,
): { text: string; direction: "up" | "down" | "flat" } {
  if (previous === 0 && current === 0) return { text: "0%", direction: "flat" };
  if (previous === 0) return { text: "new", direction: "up" };
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100);
  if (pct === 0) return { text: "0%", direction: "flat" };
  return { text: `${pct > 0 ? "+" : ""}${pct}%`, direction: pct > 0 ? "up" : "down" };
}

export function bytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
