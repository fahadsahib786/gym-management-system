// Usage: node e2e/shot.mjs <name> [#/route]   — screenshot the running app (optionally after navigating).
import { connect, go, shot } from "./cdp.mjs";

const [name = "screen", route] = process.argv.slice(2);
const { browser, page } = await connect();
if (route) await go(page, route.replace(/^#/, ""));
await page.waitForTimeout(500);
await shot(page, name);
await browser.close();
