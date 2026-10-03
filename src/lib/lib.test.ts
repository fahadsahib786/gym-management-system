import { describe, expect, it } from "vitest";
import { maxOf, niceTicks } from "./axis";
import { CODE128_PATTERNS, code128Values, code128Widths } from "./barcode";
import {
  delta,
  formatDate,
  initials,
  money,
  moneyCompact,
  phoneDisplay,
  relativeDays,
  setCurrency,
} from "./format";
import {
  formatCnicInput,
  formatPhoneInput,
  isValidCnic,
  isValidPhone,
  normalizePhone,
  parseAmount,
} from "./phone";
import { memberValues, parseWhatsApp, renderTemplate } from "./templates";

describe("phone helpers (mirror the Rust normaliser)", () => {
  it("normalises Pakistani mobiles", () => {
    expect(normalizePhone("0300-1234567")).toBe("923001234567");
    expect(normalizePhone("3001234567")).toBe("923001234567");
    expect(normalizePhone("+92 300 1234567")).toBe("923001234567");
    expect(normalizePhone("0092 300 1234567")).toBe("923001234567");
    expect(normalizePhone("+971 50 123 4567")).toBe("971501234567");
    expect(normalizePhone("12345")).toBeNull();
    expect(isValidPhone("0423-1234567")).toBe(false);
  });

  it("formats phones and CNICs while typing", () => {
    expect(formatPhoneInput("03001234567")).toBe("0300-1234567");
    expect(formatPhoneInput("0300")).toBe("0300");
    expect(formatPhoneInput("030012345678999")).toBe("0300-1234567");
    expect(formatCnicInput("3130312345671")).toBe("31303-1234567-1");
    expect(formatCnicInput("31303123")).toBe("31303-123");
    expect(isValidCnic("")).toBe(true);
    expect(isValidCnic("31303-1234567-1")).toBe(true);
    expect(isValidCnic("31303-12")).toBe(false);
  });

  it("parses money input", () => {
    expect(parseAmount("Rs 3,500")).toBe(3500);
    expect(parseAmount("")).toBe(0);
  });
});

describe("formatting", () => {
  it("formats money with the gym currency", () => {
    setCurrency("Rs");
    expect(money(1234567)).toBe("Rs 1,234,567");
    expect(money(-500)).toBe("-Rs 500");
    expect(moneyCompact(45000)).toBe("Rs 45K");
    expect(moneyCompact(1_250_000)).toBe("Rs 1.3M");
  });

  it("formats dates unambiguously", () => {
    expect(formatDate("2026-10-02")).toBe("02 Oct 2026");
    expect(formatDate("2026-10-02 11:20:00")).toBe("02 Oct 2026");
    expect(formatDate(null)).toBe("—");
    expect(relativeDays(0)).toBe("today");
    expect(relativeDays(3)).toBe("in 3 days");
    expect(relativeDays(-2)).toBe("2 days ago");
  });

  it("phones, initials and deltas", () => {
    expect(phoneDisplay("923001234567")).toBe("0300-1234567");
    expect(initials("Muhammad Ali Khan")).toBe("MK");
    expect(delta(120, 100)).toEqual({ text: "+20%", direction: "up" });
    expect(delta(0, 0).direction).toBe("flat");
  });
});

describe("WhatsApp templates", () => {
  it("fills placeholders and hides lines with empty values", () => {
    const t = "Dear {name},\nPaid: {paid}\n⚠️ Balance due: {due}\nThanks {unknown}";
    expect(renderTemplate(t, { name: "Ali", paid: "Rs 3,000", due: "" })).toBe(
      "Dear Ali,\nPaid: Rs 3,000\nThanks {unknown}",
    );
    expect(renderTemplate(t, { name: "Ali", paid: "Rs 3,000", due: "Rs 500" })).toContain(
      "Balance due: Rs 500",
    );
  });

  it("builds member values", () => {
    setCurrency("Rs");
    const v = memberValues(
      {
        fullName: "Usman Tariq",
        memberCode: "DF-0007",
        planName: "Monthly",
        endDate: "2026-11-01",
        daysLeft: 3,
        balance: 1500,
      },
      { name: "Danish Fitness", phone: "923001234567" },
    );
    expect(v.first_name).toBe("Usman");
    expect(v.end_date).toBe("01 Nov 2026");
    expect(v.due).toBe("Rs 1,500");
    expect(v.gym_phone).toBe("0300-1234567");
  });

  it("reads WhatsApp formatting like WhatsApp does", () => {
    const styled = (text: string) =>
      parseWhatsApp(text).map(
        (s) => `${s.bold ? "B" : ""}${s.italic ? "I" : ""}${s.strike ? "S" : ""}:${s.text}`,
      );
    expect(styled("Welcome to *Danish Fitness*. Enjoy")).toEqual([
      ":Welcome to ",
      "B:Danish Fitness",
      ":. Enjoy",
    ]);
    expect(styled("_Note:_ ~old~ *_both_*")).toEqual(["I:Note:", ": ", "S:old", ": ", "BI:both"]);
    expect(styled("snake_case_name 2*3*4 * not bold *")).toEqual([":snake_case_name 2*3*4 * not bold *"]);
    expect(parseWhatsApp("a *b* c").map((s) => s.at)).toEqual([0, 3, 5]);
  });
});

describe("chart axes", () => {
  it("picks round ticks that just cover the data", () => {
    expect(niceTicks(455_000)).toEqual([0, 100_000, 200_000, 300_000, 400_000, 500_000]);
    expect(niceTicks(18_000)).toEqual([0, 5_000, 10_000, 15_000, 20_000]);
    expect(niceTicks(140, { integer: true })).toEqual([0, 20, 40, 60, 80, 100, 120, 140]);
    expect(niceTicks(3, { integer: true })).toEqual([0, 1, 2, 3]);
    expect(niceTicks(0, { integer: true })).toEqual([0, 1]);
    expect(niceTicks(0.7)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
  });

  it("finds the largest value across fields", () => {
    expect(
      maxOf(
        [
          { a: 3, b: 9 },
          { a: 12, b: 1 },
        ],
        "a",
        "b",
      ),
    ).toBe(12);
    expect(maxOf([] as { a: number }[], "a")).toBe(0);
  });
});

describe("Code 128 barcodes", () => {
  it("has a well-formed symbol table", () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
    CODE128_PATTERNS.forEach((p, i) => {
      const modules = Array.from(p, Number).reduce((a, b) => a + b, 0);
      expect(modules).toBe(i === 106 ? 13 : 11);
    });
  });

  it("encodes member IDs with the right checksum", () => {
    // 104 + 36·1 + 38·2 + 13·3 + 16·4 + 16·5 + 16·6 + 17·7 = 614 ≡ 99 (mod 103)
    expect(code128Values("DF-0001")).toEqual([104, 36, 38, 13, 16, 16, 16, 17, 99, 106]);
    const widths = code128Widths("DF-0001");
    expect(widths.reduce((a, b) => a + b, 0)).toBe(11 * 9 + 13);
    expect(widths).toHaveLength(6 * 9 + 7);
  });
});
