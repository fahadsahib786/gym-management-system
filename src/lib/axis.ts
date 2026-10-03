/**
 * Round ticks for a zero-based value axis, d3-style: the step is 1, 2 or 5 × 10ⁿ chosen for about `count`
 * intervals, and the axis ends at the first tick at or above `max` (0 / 100K / … / 500K for a 455K peak).
 */
export function niceTicks(max: number, { count = 5, integer = false } = {}): number[] {
  const top = max > 0 ? max : 1;
  const raw = top / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const error = raw / power;
  let step = power * (error >= 7.07 ? 10 : error >= 3.16 ? 5 : error >= 1.41 ? 2 : 1);
  if (integer) step = Math.max(1, Math.round(step));
  const intervals = Math.max(1, Math.ceil(top / step - 1e-9));
  // Rounded to the step's precision so decimal steps don't print 0.30000000000000004.
  const digits = Math.max(0, -Math.floor(Math.log10(step)));
  return Array.from({ length: intervals + 1 }, (_, i) => Number((i * step).toFixed(digits)));
}

/** Largest value of the given fields across rows (missing / non-numeric values count as 0). */
export function maxOf<T extends object>(rows: readonly T[], ...keys: (keyof T)[]): number {
  let max = 0;
  for (const row of rows) {
    for (const key of keys) {
      const v = Number(row[key]);
      if (v > max) max = v;
    }
  }
  return max;
}
