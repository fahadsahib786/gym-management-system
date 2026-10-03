import { endOfMonth, format, startOfMonth, startOfWeek, startOfYear, subDays, subMonths } from "date-fns";

export type PresetKey =
  | "today"
  | "yesterday"
  | "week"
  | "last7"
  | "month"
  | "lastMonth"
  | "last30"
  | "last90"
  | "year"
  | "custom";

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This week" },
  { key: "last7", label: "Last 7 days" },
  { key: "month", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "last30", label: "Last 30 days" },
  { key: "last90", label: "Last 90 days" },
  { key: "year", label: "This year" },
  { key: "custom", label: "Custom…" },
];

const iso = (d: Date) => format(d, "yyyy-MM-dd");

export function presetRange(key: PresetKey, now = new Date()): { from: string; to: string } {
  switch (key) {
    case "today":
      return { from: iso(now), to: iso(now) };
    case "yesterday": {
      const y = subDays(now, 1);
      return { from: iso(y), to: iso(y) };
    }
    case "week":
      return { from: iso(startOfWeek(now, { weekStartsOn: 1 })), to: iso(now) };
    case "last7":
      return { from: iso(subDays(now, 6)), to: iso(now) };
    case "month":
      return { from: iso(startOfMonth(now)), to: iso(now) };
    case "lastMonth": {
      const m = subMonths(now, 1);
      return { from: iso(startOfMonth(m)), to: iso(endOfMonth(m)) };
    }
    case "last30":
      return { from: iso(subDays(now, 29)), to: iso(now) };
    case "last90":
      return { from: iso(subDays(now, 89)), to: iso(now) };
    case "year":
      return { from: iso(startOfYear(now)), to: iso(now) };
    case "custom":
      return { from: iso(startOfMonth(now)), to: iso(now) };
  }
}
