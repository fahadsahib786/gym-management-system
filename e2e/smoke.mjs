// End-to-end smoke test against the REAL running app (Rust backend + SQLite + WebView2).
//
//   1. Start the app with a throw-away data folder and DevTools enabled:
//        $env:DANISH_FITNESS_DATA_DIR="C:\temp\df-e2e"; $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
//        npm run app:dev        (or run the release exe)
//   2. node e2e/smoke.mjs      → screenshots in e2e/output/
//
// Flow: first-run setup → demo data → login → every main screen → register a member (uploaded photo) →
// webcam photo → member card → payment → check-in → attendance switched off and on again.
//
// Webcam test: also pass fake cameras to WebView2 (no real camera is used, no prompt may appear):
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222 --use-fake-device-for-media-stream=device-count=2"
//   $env:DF_FAKE_CAMERAS="1"; node e2e/smoke.mjs
import { fileURLToPath } from "node:url";
import { connect, go, shot } from "./cdp.mjs";

const PIN = "1234";
const log = (...a) => console.log("•", ...a);
const { browser, page } = await connect();
page.setDefaultTimeout(20_000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

// Start from a clean UI state (e.g. a half-finished wizard from an earlier run).
await page.reload();
await page.waitForTimeout(2000);

async function isVisible(locator) {
  return locator.isVisible().catch(() => false);
}

async function login() {
  if (
    !(await isVisible(page.getByText("Who is at the desk?"))) &&
    !(await isVisible(page.getByText("Enter your PIN")))
  )
    return;
  if (await isVisible(page.getByText("Who is at the desk?"))) {
    await page
      .getByRole("button", { name: /Danish/ })
      .first()
      .click();
  }
  await page.keyboard.type(PIN);
  await page.keyboard.press("Enter");
  await page.locator("main").waitFor();
  await go(page, "/");
  log("logged in");
}

// ---------------------------------------------------------------- first-run setup
if (await isVisible(page.getByRole("button", { name: "Get started" }))) {
  await shot(page, "01-setup-welcome");
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByLabel("Phone").first().fill("03001234567");
  await shot(page, "02-setup-gym");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByPlaceholder("e.g. Danish").fill("Danish");
  const pins = page.locator('input[type="password"]');
  await pins.nth(0).fill(PIN);
  await pins.nth(1).fill(PIN);
  await page.getByRole("button", { name: "Continue" }).click();
  await shot(page, "03-setup-plans");
  await page.getByRole("button", { name: "Continue" }).click();
  await shot(page, "04-setup-finish");
  await page.getByRole("button", { name: /^Open / }).click();
  await page.getByText(/Good (morning|afternoon|evening)/).waitFor();
  log("setup completed");
  await shot(page, "05-dashboard-empty");

  // Demo data so every screen has realistic content.
  await go(page, "/settings?tab=backup");
  await page.getByRole("button", { name: "Load demo data" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Load demo data" }).click();
  await page.waitForEvent("load", { timeout: 180_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  log("demo data loaded");
}

await login();

// ---------------------------------------------------------------- tour of the screens
const screens = [
  ["10-dashboard", "/"],
  ["11-members", "/members"],
  ["12-members-expiring", "/members?filter=expiring"],
  ["13-payments", "/payments"],
  ["14-dues", "/dues"],
  ["15-checkin", "/check-in"],
  ["16-whatsapp", "/messages"],
  ["17-expenses", "/expenses"],
  ["18-plans", "/plans"],
  ["19-reports-closing", "/reports?tab=closing"],
  ["20-reports-collections", "/reports?tab=collections"],
  ["21-reports-memberships", "/reports?tab=memberships"],
  ["22-reports-attendance", "/reports?tab=attendance"],
  ["23-reports-pnl", "/reports?tab=pnl"],
  ["24-activity", "/activity"],
  ["25-settings-gym", "/settings?tab=gym"],
  ["26-settings-whatsapp", "/settings?tab=whatsapp"],
  ["27-settings-backup", "/settings?tab=backup"],
  ["28-settings-about", "/settings?tab=about"],
];
for (const [name, route] of screens) {
  await go(page, route);
  await page.waitForTimeout(900);
  await shot(page, name);
}

// Dashboard scrolled (charts).
await go(page, "/");
await page.waitForTimeout(800);
await page.locator("main").evaluate((el) => el.scrollTo(0, 900));
await page.waitForTimeout(400);
await shot(page, "29-dashboard-charts");
await page.locator("main").evaluate((el) => el.scrollTo(0, 1900));
await page.waitForTimeout(400);
await shot(page, "30-dashboard-more");

// ---------------------------------------------------------------- member profile
await go(page, "/members");
await page.locator("tbody tr").first().click();
await page.getByRole("tab", { name: "Overview" }).waitFor();
await shot(page, "31-profile");
for (const tab of ["Memberships", "Payments & fees", "Attendance", "History"]) {
  await page.getByRole("tab", { name: tab }).click();
  await page.waitForTimeout(500);
  await shot(page, `32-profile-${tab.split(" ")[0].toLowerCase()}`);
}

// ---------------------------------------------------------------- register a member
await go(page, "/members/new");
await page.locator("#fullName").fill("test member e2e");
await page.locator("#phone").fill("03215550123");
// Photo from a file (any picture works; the app icon stands in for a member photo).
await page
  .locator('input[type="file"][aria-label="Upload photo"]')
  .setInputFiles(fileURLToPath(new URL("../src-tauri/icons/128x128.png", import.meta.url)));
await page.waitForTimeout(500);
await shot(page, "40-register");
await page.getByRole("button", { name: "Save member" }).click();
await page.getByRole("tab", { name: "Overview" }).waitFor();
await page.locator('img[src*="photo"]').first().waitFor();
await page.waitForTimeout(500);
await shot(page, "41-registered-profile");
log("member registered with an uploaded photo");

// ---------------------------------------------------------------- webcam photo (fake cameras only)
if (process.env.DF_FAKE_CAMERAS) {
  const dialog = page.getByRole("dialog");
  const videoReady = () =>
    page.waitForFunction(() => {
      const v = document.querySelector("[role=dialog] video");
      return !!v && v.videoWidth > 0;
    });
  await page.getByRole("button", { name: "Change photo" }).click();
  await dialog.getByRole("button", { name: /Retake|Webcam/ }).click();
  await videoReady();
  const picker = dialog.getByRole("combobox", { name: "Camera" });
  await picker.waitFor({ timeout: 5000 });
  await picker.click();
  await page.getByRole("option").nth(1).click();
  await page.waitForTimeout(800);
  await videoReady();
  log("second camera selected");
  await shot(page, "46-webcam");
  await dialog.getByRole("button", { name: "Capture" }).click();
  await dialog.getByRole("button", { name: "Save photo" }).click();
  await dialog.waitFor({ state: "detached" });
  log("webcam photo saved");
}

// ---------------------------------------------------------------- member ID card (print preview)
await page.evaluate(() => {
  window.print = () => {};
});
await page.getByRole("button", { name: "More actions" }).click();
await page.getByRole("menuitem", { name: "Print member card" }).click();
await page.locator("#print-root svg[aria-label^='Barcode']").waitFor({ state: "attached" });
await page.emulateMedia({ media: "print" });
await page.waitForTimeout(500);
await shot(page, "47-member-card");
await page.emulateMedia({ media: "screen" });
await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
log("member card rendered");

// Receive a payment for the new member via F3-style dialog from the profile.
await page.getByRole("button", { name: "Receive payment" }).first().click();
await page.getByRole("dialog").waitFor();
await shot(page, "42-receive-payment");
await page.keyboard.press("Escape");

// Renew dialog.
await page.getByRole("button", { name: "Renew" }).first().click();
await page.getByRole("dialog").waitFor();
await page.waitForTimeout(500);
await shot(page, "43-renew");
await page.keyboard.press("Escape");

// ---------------------------------------------------------------- check-in by member search
await go(page, "/check-in");
await page.getByPlaceholder(/Scan card/).fill("test member e2e");
await page.waitForTimeout(600);
await page.keyboard.press("Enter");
await page.waitForTimeout(1200);
await shot(page, "44-checkin-result");
log("check-in done");

// ---------------------------------------------------------------- command palette
await page.keyboard.press("Control+k");
await page.keyboard.type("khan");
await page.waitForTimeout(700);
await shot(page, "45-search-palette");
await page.keyboard.press("Escape");

// ---------------------------------------------------------------- attendance switched off, then on again
const setAttendance = async (on) => {
  await go(page, "/settings?tab=membership");
  const toggle = page.getByRole("switch").first();
  await toggle.waitFor();
  if ((await toggle.getAttribute("aria-checked")) !== String(on)) {
    await toggle.click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForTimeout(800);
  }
};
await setAttendance(false);
await go(page, "/");
await page.waitForTimeout(900);
if (await page.getByRole("link", { name: "Check-in", exact: true }).isVisible())
  throw new Error("Check-in still shown");
await shot(page, "48-dashboard-no-attendance");
await setAttendance(true);
await go(page, "/");
await page.getByRole("link", { name: "Check-in", exact: true }).waitFor();
log("attendance switch works");

console.log(
  errors.length
    ? `\nConsole errors (${errors.length}):\n${errors.slice(0, 20).join("\n")}`
    : "\nNo console errors.",
);
await browser.close();
