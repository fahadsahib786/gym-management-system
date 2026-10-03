import { addDays, addMonths, format } from "date-fns";
import type { Plan } from "@/api/bindings";
import { parseDate } from "./format";

/** Last day (inclusive) of a membership starting on `start` — mirrors `plans::period_end` in Rust. */
export function planEnd(
  start: string,
  plan: Pick<Plan, "durationValue" | "durationUnit"> | undefined,
): string {
  const d = parseDate(start);
  if (!d || !plan) return "";
  const end =
    plan.durationUnit === "month"
      ? addDays(addMonths(d, plan.durationValue), -1)
      : addDays(d, plan.durationValue - 1);
  return format(end, "yyyy-MM-dd");
}
