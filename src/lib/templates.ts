import type { GymSettings, MessageTemplates } from "@/api/bindings";
import { formatDate, money, phoneDisplay } from "./format";

export type TemplateKey = keyof MessageTemplates;

export const TEMPLATE_INFO: Record<TemplateKey, { label: string; hint: string }> = {
  welcome: { label: "Welcome (new member)", hint: "Sent after registration" },
  receipt: { label: "Payment receipt", hint: "Sent after a payment" },
  renewal: { label: "Membership renewed", hint: "Sent after a renewal" },
  expiryReminder: { label: "Expiring soon", hint: "Before the membership ends" },
  expiredReminder: { label: "Expired", hint: "After the membership ended" },
  duesReminder: { label: "Fee due", hint: "When a balance is pending" },
  birthday: { label: "Birthday wish", hint: "On the member's birthday" },
  inactive: { label: "We miss you", hint: "Active member who stopped coming" },
};

export const PLACEHOLDERS: { key: string; label: string }[] = [
  { key: "name", label: "Member's full name" },
  { key: "first_name", label: "First name" },
  { key: "code", label: "Member ID" },
  { key: "plan", label: "Package / plan" },
  { key: "start_date", label: "Membership start" },
  { key: "end_date", label: "Membership end" },
  { key: "days_left", label: "Days left" },
  { key: "amount", label: "Amount received" },
  { key: "paid", label: "Amount paid" },
  { key: "due", label: "Balance due (line hidden when nothing is due)" },
  { key: "receipt_no", label: "Receipt number" },
  { key: "method", label: "Payment method" },
  { key: "date", label: "Date" },
  { key: "gym", label: "Gym name" },
  { key: "gym_phone", label: "Gym phone" },
];

const KNOWN = new Set(PLACEHOLDERS.map((p) => p.key));

export type TemplateValues = Partial<Record<string, string | null | undefined>>;

/**
 * Fills `{placeholders}`. A line whose known placeholder has no value is removed entirely — so
 * "Balance due: {due}" disappears when nothing is due. Unknown `{words}` are left untouched.
 */
export function renderTemplate(template: string, values: TemplateValues): string {
  const out: string[] = [];
  for (const line of template.split("\n")) {
    let drop = false;
    const rendered = line.replace(/\{([a-z_]+)\}/g, (match, key: string) => {
      if (!KNOWN.has(key)) return match;
      const v = values[key];
      if (v === undefined || v === null || v === "") {
        drop = true;
        return "";
      }
      return v;
    });
    if (!drop) out.push(rendered);
  }
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface MemberLike {
  fullName: string;
  memberCode: string;
  planName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  daysLeft?: number | null;
  balance?: number;
}

export function memberValues(m: MemberLike, gym: Pick<GymSettings, "name" | "phone">): TemplateValues {
  return {
    name: m.fullName,
    first_name: m.fullName.split(" ")[0],
    code: m.memberCode,
    plan: m.planName ?? "",
    start_date: m.startDate ? formatDate(m.startDate) : "",
    end_date: m.endDate ? formatDate(m.endDate) : "",
    days_left: m.daysLeft !== null && m.daysLeft !== undefined ? String(Math.max(0, m.daysLeft)) : "",
    due: m.balance && m.balance > 0 ? money(m.balance) : "",
    gym: gym.name,
    gym_phone: gym.phone ? (gym.phone.startsWith("92") ? phoneDisplay(gym.phone) : gym.phone) : "",
    date: formatDate(new Date()),
  };
}

export interface WhatsAppSegment {
  /** Offset of the segment in the original text (stable React key). */
  at: number;
  text: string;
  bold: boolean;
  italic: boolean;
  strike: boolean;
}

// *bold*, _italic_, ~strike~: markers hug non-space text and sit at word boundaries, as in WhatsApp.
const WHATSAPP_FORMAT = /(^|[\s([{"'])([*_~])(?!\s)([^\n]*?\S)\2(?=$|[\s.,!?:;)\]}"'])/gm;

/** Splits a message into styled segments the way WhatsApp displays it. */
export function parseWhatsApp(
  text: string,
  style = { bold: false, italic: false, strike: false },
  base = 0,
  depth = 0,
): WhatsAppSegment[] {
  const out: WhatsAppSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(WHATSAPP_FORMAT)) {
    const [whole, lead, mark, inner] = m;
    const start = m.index + lead.length;
    if (start > last) out.push({ ...style, at: base + last, text: text.slice(last, start) });
    const next = {
      bold: style.bold || mark === "*",
      italic: style.italic || mark === "_",
      strike: style.strike || mark === "~",
    };
    if (depth < 2) out.push(...parseWhatsApp(inner, next, base + start + 1, depth + 1));
    else out.push({ ...next, at: base + start + 1, text: inner });
    last = m.index + whole.length;
  }
  if (last < text.length) out.push({ ...style, at: base + last, text: text.slice(last) });
  return out;
}
