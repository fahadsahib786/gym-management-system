// Helpers to drive the real Danish Fitness window (WebView2) over the Chrome DevTools Protocol.
// Start the app with: WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

export const OUT = new URL("./output/", import.meta.url);
mkdirSync(OUT, { recursive: true });

export async function connect(port = 9222, attempts = 60) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      const context = browser.contexts()[0];
      const page = context.pages().find((p) => !p.url().startsWith("devtools")) ?? context.pages()[0];
      if (page) return { browser, page };
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw lastError ?? new Error("Could not connect to the app");
}

export async function shot(page, name) {
  const path = new URL(`${name}.png`, OUT);
  await page.screenshot({ path: path.pathname.replace(/^\/([A-Za-z]:)/, "$1") });
  console.log(`screenshot: e2e/output/${name}.png`);
}

export async function go(page, hash) {
  await page.evaluate((h) => {
    window.location.hash = h;
  }, hash);
  await page.waitForTimeout(700);
}
