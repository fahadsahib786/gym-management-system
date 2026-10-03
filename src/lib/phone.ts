/**
 * Input helpers that mirror the backend normalisation (crates/core/src/util.rs).
 */

/** Formats a phone as the user types: `03001234567` → `0300-1234567`. International (+…) is left alone. */
export function formatPhoneInput(raw: string): string {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("+") || trimmed.startsWith("00")) {
    return trimmed.replace(/[^\d+\s-]/g, "").slice(0, 20);
  }
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 4) return digits;
  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

/** `92XXXXXXXXXX` for Pakistani mobiles, digits for `+` international numbers, or null when invalid. */
export function normalizePhone(input: string): string | null {
  const t = input.trim();
  const plus = t.startsWith("+");
  let d = t.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("03")) return `92${d.slice(1)}`;
  if (d.length === 10 && d.startsWith("3")) return `92${d}`;
  if (d.length === 12 && d.startsWith("923")) return d;
  if ((plus || t.startsWith("00")) && d.length >= 8 && d.length <= 15 && !d.startsWith("92")) return d;
  return null;
}

export function isValidPhone(input: string): boolean {
  return normalizePhone(input) !== null;
}

/** Formats a CNIC as the user types: `3130312345671` → `31303-1234567-1`. */
export function formatCnicInput(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 13);
  if (d.length <= 5) return d;
  if (d.length <= 12) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
}

export function isValidCnic(input: string): boolean {
  const d = input.replace(/\D/g, "");
  return d.length === 0 || d.length === 13;
}

/** Digits-only money input value → number (empty → 0). */
export function parseAmount(raw: string): number {
  const d = raw.replace(/[^\d]/g, "");
  return d ? Math.min(Number(d), 100_000_000) : 0;
}
