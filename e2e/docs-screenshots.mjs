// Step-by-step screenshots for README.md and docs/USER_GUIDE.md (saved in docs/screenshots/).
//
//   1. Start the app with an EMPTY data folder and DevTools enabled:
//        $env:DANISH_FITNESS_DATA_DIR="I:\danish-fitness\.demo"; $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
//        npm run app:dev
//   2. node e2e/docs-screenshots.mjs
//
// Receipt / invoice / member-card PDFs are written to .demo/pdf/ (render them to images separately if needed).
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { connect, go } from "./cdp.mjs";

const SHOTS = fileURLToPath(new URL("../docs/screenshots/", import.meta.url));
const DEMO = fileURLToPath(new URL("../.demo/", import.meta.url));
mkdirSync(SHOTS, { recursive: true });
mkdirSync(`${DEMO}pdf`, { recursive: true });

const PIN = "1234";
const log = (...a) => console.log("•", ...a);
const { browser, page } = await connect();
page.setDefaultTimeout(30_000);
await page.setViewportSize({ width: 1440, height: 900 });
await page.reload();
await page.waitForTimeout(2500);

const snap = async (name, settle = 700, { toasts = false } = {}) => {
  await page.waitForTimeout(settle);
  // Notifications would cover part of most screens; show them only where they are the point.
  const hide = toasts
    ? null
    : await page.addStyleTag({ content: "[data-sonner-toaster]{display:none!important}" });
  await page.screenshot({ path: `${SHOTS}${name}.png` });
  await hide?.evaluate((el) => el.remove());
  console.log(`screenshot: docs/screenshots/${name}.png`);
};
const scrollMain = (y) => page.locator("main").evaluate((el, top) => el.scrollTo(0, top), y);
const savePdfTo = (name) =>
  page.evaluate((p) => {
    window.__DF_SAVE_PATH__ = p;
  }, `${DEMO}pdf\\${name}`);

// A neutral illustrated "photo" for the demo member (no real person in the docs).
const avatar = `${DEMO}avatar.svg`;
writeFileSync(
  avatar,
  `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c7d2fe"/><stop offset="1" stop-color="#818cf8"/></linearGradient></defs>
  <rect width="480" height="480" fill="url(#g)"/>
  <circle cx="240" cy="190" r="92" fill="#eef2ff"/>
  <path d="M60 480c10-110 90-170 180-170s170 60 180 170z" fill="#eef2ff"/>
</svg>`,
);

// ---------------------------------------------------------------- 1. first-run setup (skipped if already done)
const visible = (locator) => locator.isVisible().catch(() => false);
if (await visible(page.getByRole("button", { name: "Get started" }))) {
  await snap("01-setup-welcome");
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByLabel("Phone").first().fill("03001234567");
  await snap("02-setup-gym");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByPlaceholder("e.g. Danish").fill("Danish");
  const pins = page.locator('input[type="password"]');
  await pins.nth(0).fill(PIN);
  await pins.nth(1).fill(PIN);
  await snap("03-setup-owner");
  await page.getByRole("button", { name: "Continue" }).click();
  await snap("04-setup-plans");
  await page.getByRole("button", { name: "Continue" }).click();
  await snap("05-setup-finish");
  await page.getByRole("button", { name: /^Open / }).click();
  await page.getByText(/Good (morning|afternoon|evening)/).waitFor();
  log("setup done");

  // Demo data so every screen has realistic content (the app reloads to the login screen afterwards).
  await go(page, "/settings?tab=backup");
  await page.getByRole("button", { name: "Load demo data" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Load demo data" }).click();
  await page.waitForEvent("load", { timeout: 180_000 }).catch(() => {});
  await page.waitForTimeout(3000);
  log("demo data loaded");
}

// ---------------------------------------------------------------- 2. login screen
const atLogin = () => visible(page.getByText(/Who is at the desk\?|Enter your PIN/));
if (!(await atLogin())) {
  await page.getByRole("button", { name: "Lock screen" }).click();
  await page.waitForTimeout(1200);
}
await snap("06-login", 900);
if (await visible(page.getByText("Who is at the desk?"))) {
  await page
    .getByRole("button", { name: /Danish/ })
    .first()
    .click();
}
await page.keyboard.type(PIN);
await page.keyboard.press("Enter");
await page.locator("main").waitFor();

// ---------------------------------------------------------------- 3. dashboard
await go(page, "/");
await snap("07-dashboard", 1500);
await scrollMain(1180);
await snap("08-dashboard-charts", 900);
await scrollMain(2150);
await snap("09-dashboard-attendance", 900);

// ---------------------------------------------------------------- 4. members & registration
await go(page, "/members");
await snap("10-members", 1200);
await go(page, "/members/new");
await page.locator("#fullName").fill("Muhammad Ali Khan");
await page.locator("#phone").fill("03215550123");
await page.locator('input[type="file"][aria-label="Upload photo"]').setInputFiles(avatar);
await page.getByText("More details").click();
await page.waitForTimeout(400);
await page.getByLabel("Father / husband name").fill("Abdul Rehman Khan");
await page.getByLabel("CNIC").fill("3130312345671");
await snap("11-register-member", 900);
await page.getByRole("button", { name: "Save member" }).click();
await page.getByRole("tab", { name: "Overview" }).waitFor();
await snap("12-member-profile", 1200);
log("member registered");

// Receive payment from the profile.
await page.locator("main").getByRole("button", { name: "Receive payment" }).first().click();
await page.getByRole("dialog").waitFor();
await snap("13-receive-payment", 900);
await page.keyboard.press("Escape");

// Renew dialog.
await page.locator("main").getByRole("button", { name: "Renew" }).first().click();
await page.getByRole("dialog").waitFor();
await snap("14-renew", 900);
await page.keyboard.press("Escape");

// Member card PDF + fee invoice PDF from the profile.
await savePdfTo("member-card.pdf");
await page.getByRole("button", { name: "More actions" }).click();
await snap("15-profile-menu", 400);
await page.getByRole("menuitem", { name: "Member card PDF" }).click();
await page.waitForTimeout(2500);
await page.getByRole("tab", { name: "Payments & fees" }).click();
await page
  .getByRole("button", { name: /Invoice/ })
  .first()
  .click();
await snap("16-invoice-menu", 400);
await savePdfTo("fee-invoice.pdf");
await page.getByRole("menuitem", { name: "Save invoice as PDF" }).click();
await page.waitForTimeout(2500);

// ---------------------------------------------------------------- 5. payments, receipts, dues
await go(page, "/payments");
await snap("17-payments", 1200);
await page.getByRole("button", { name: "Receipt", exact: true }).first().click();
await page.getByRole("dialog").getByRole("button", { name: "PDF" }).waitFor();
await snap("18-receipt", 900);
await savePdfTo("receipt.pdf");
await page.getByRole("dialog").getByRole("button", { name: "PDF" }).click();
await page.getByText("PDF saved").last().waitFor();
await snap("18b-pdf-saved", 500, { toasts: true });
await page.keyboard.press("Escape");
await go(page, "/dues");
await snap("19-fee-dues", 1200);
await savePdfTo("fee-invoice-dues.pdf");
await page.getByRole("button", { name: "Invoice PDF" }).first().click();
await page.waitForTimeout(2500);

// ---------------------------------------------------------------- 6. check-in & cards
await go(page, "/check-in");
await page.getByPlaceholder(/Scan card/).fill("muhammad ali khan");
await page.waitForTimeout(700);
await page.keyboard.press("Enter");
await snap("20-check-in", 1500);
await go(page, "/members?filter=active");
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "Print cards" }).click();
await snap("21-member-cards-dialog", 600);
await savePdfTo("member-cards.pdf");
await page.getByRole("dialog").getByRole("button", { name: "Save PDF" }).click();
await page.waitForTimeout(6000);

// ---------------------------------------------------------------- 7. WhatsApp, expenses, reports
await go(page, "/messages");
await snap("22-whatsapp", 1200);
await page
  .locator("main")
  .getByRole("button", { name: /^Send/ })
  .first()
  .click()
  .catch(() => {});
if (
  await page
    .getByRole("dialog")
    .isVisible()
    .catch(() => false)
) {
  await snap("23-whatsapp-message", 600);
  await page.keyboard.press("Escape");
}
await go(page, "/expenses");
await snap("24-expenses", 1200);
for (const [name, tab] of [
  ["25-report-daily-closing", "closing"],
  ["26-report-collections", "collections"],
  ["27-report-memberships", "memberships"],
  ["28-report-profit-loss", "pnl"],
]) {
  await go(page, `/reports?tab=${tab}`);
  await snap(name, 1300);
}

// ---------------------------------------------------------------- 8. settings & activity
await go(page, "/settings?tab=membership");
await snap("29-settings-membership", 1000);
await go(page, "/settings?tab=whatsapp");
await snap("30-settings-whatsapp", 1000);
await go(page, "/settings?tab=backup");
await snap("31-settings-backup", 1200);
await go(page, "/activity");
await snap("32-activity-log", 1200);

await page.setViewportSize({ width: 1366, height: 745 }).catch(() => {});
log("done");
await browser.close();
