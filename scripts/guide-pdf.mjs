// Builds "docs/Danish Fitness - User Guide.pdf" from docs/USER_GUIDE.md (with its screenshots), ready to send to
// the gym. Uses the Microsoft Edge that ships with Windows to print. Usage: npm run docs:pdf
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { chromium } from "playwright-core";

const root = new URL("../", import.meta.url);
const docs = new URL("docs/", root);
const out = fileURLToPath(new URL("Danish Fitness - User Guide.pdf", docs));
const { version } = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const logo = new URL("src-tauri/icons/128x128.png", root).href;

// Heading ids like GitHub's, so the contents links keep working inside the PDF.
const slug = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
marked.use({
  renderer: {
    heading({ tokens, depth }) {
      const html = this.parser.parseInline(tokens);
      return `<h${depth} id="${slug(html)}">${html}</h${depth}>\n`;
    },
  },
});

// The cover page replaces the markdown title block (everything before "## Contents").
const md = readFileSync(new URL("USER_GUIDE.md", docs), "utf8");
const quickStart = `
<div class="quick">
  <h3>Quick start — install and set up in 10 minutes</h3>
  <ol>
    <li><b>Install:</b> double-click <code>Danish Fitness_${version}_x64-setup.exe</code>. If Windows warns, click
      <b>More info → Run anyway</b>. No internet or administrator password needed.</li>
    <li><b>Open</b> the <b>Danish Fitness</b> icon on the desktop.</li>
    <li><b>Set up:</b> Get started → gym details → owner name and PIN → fees &amp; plans → <b>Open Danish Fitness</b>
      (section 2).</li>
    <li><b>Write down the owner PIN</b> and keep it somewhere safe.</li>
    <li><b>Add staff:</b> Settings → Users &amp; security → one account and PIN per receptionist.</li>
    <li><b>Backups</b> are automatic (normally to <code>D:\\Danish Fitness\\Backups</code>). For extra safety set a USB drive
      as the second copy in Settings → Backup &amp; restore.</li>
    <li><b>Moving from another PC?</b> On the first screen click <b>Restore</b> instead of setting up again.</li>
  </ol>
  <div class="keys">
    <span><b>F2</b> New member</span><span><b>F3</b> Receive payment</span><span><b>F4</b> Check-in</span>
    <span><b>Ctrl + K</b> Search</span>
  </div>
</div>`;
const contents = marked.parse(md.slice(md.indexOf("## Contents")));
// The quick start goes right after the contents list, on page 2.
const body = contents.replace("</ol>", `</ol>${quickStart}`);
const today = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<base href="${docs.href}" />
<title>Danish Fitness — User Guide</title>
<style>
  @page {
    size: A4;
    margin: 16mm 15mm 17mm;
    @bottom-left { content: "Danish Fitness — User Guide"; font: 8pt "Segoe UI", Arial, sans-serif; color: #8a8f98; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt "Segoe UI", Arial, sans-serif; color: #8a8f98; }
  }
  @page :first { margin: 0; @bottom-left { content: none; } @bottom-right { content: none; } }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font: 10.5pt/1.55 "Segoe UI", Arial, sans-serif; color: #1f2430; }
  .cover {
    height: 297mm; padding: 28mm 22mm; display: flex; flex-direction: column; justify-content: space-between;
    background: linear-gradient(150deg, #4f46e5 0%, #3f3fd1 45%, #1e1b6b 100%); color: #fff; break-after: page;
  }
  .cover .brand { display: flex; align-items: center; gap: 14px; font-weight: 600; font-size: 13pt; }
  .cover .brand img { width: 54px; height: 54px; margin: 0; border: 0; border-radius: 12px; box-shadow: none;
                      background: rgba(255,255,255,.15); padding: 6px; }
  .cover h1 { font-size: 34pt; line-height: 1.1; margin: 0 0 6mm; letter-spacing: -.5px; }
  .cover .sub { font-size: 15pt; opacity: .92; margin: 0 0 12mm; }
  .cover ul { list-style: none; padding: 0; margin: 0; font-size: 11.5pt; opacity: .95; }
  .cover li { margin: 2.2mm 0; padding-left: 7mm; position: relative; }
  .cover li::before { content: "✓"; position: absolute; left: 0; font-weight: 700; }
  .cover .meta { font-size: 10pt; opacity: .85; line-height: 1.7; }
  .cover .meta b { opacity: 1; }
  h2 { break-before: page; font-size: 19pt; color: #3f3fd1; margin: 0 0 4mm; padding-bottom: 2.5mm; border-bottom: 2px solid #e4e6fb; }
  h2#contents { break-before: auto; }
  h3 { font-size: 13pt; margin: 6mm 0 2mm; color: #2b2f8f; }
  p { margin: 0 0 3mm; }
  a { color: #3f3fd1; text-decoration: none; }
  strong { color: #11141c; }
  code { font-family: Consolas, monospace; font-size: 9.5pt; background: #f1f2f9; padding: 0.3mm 1.2mm; border-radius: 3px; }
  ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
  li { margin: 1mm 0; }
  img { display: block; max-width: 100%; height: auto; margin: 3mm auto 5mm; border: 1px solid #dfe2ea; border-radius: 6px;
        box-shadow: 0 2px 8px rgba(20, 24, 60, .10); break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; margin: 2mm 0 5mm; font-size: 9.5pt; break-inside: avoid; }
  th { text-align: left; background: #eef0fd; color: #2b2f8f; }
  th, td { padding: 2mm 2.5mm; border: 1px solid #dfe2ea; vertical-align: top; }
  blockquote { margin: 3mm 0 5mm; padding: 3mm 4mm; background: #f3f4ff; border-left: 4px solid #6366f1; border-radius: 4px; }
  blockquote p { margin: 0; }
  hr { border: 0; border-top: 1px solid #dfe2ea; margin: 6mm 0; }
  /* A step's text stays on the same page as its screenshot. */
  p:has(+ p > img), p:has(+ img) { break-after: avoid; }
  p:has(> img) { break-before: avoid; }
  /* Contents: two columns of section links, then the quick start. */
  h2#contents + ol { columns: 2; column-gap: 10mm; font-size: 11pt; }
  .quick { margin-top: 8mm; padding: 6mm 7mm; border-radius: 8px; background: #f3f4ff; border: 1px solid #dfe2fb; }
  .quick h3 { margin: 0 0 3mm; font-size: 14pt; color: #3f3fd1; }
  .quick ol { margin: 0; padding-left: 6mm; }
  .quick li { margin: 1.6mm 0; }
  .keys { margin-top: 5mm; display: flex; gap: 3mm; flex-wrap: wrap; font-size: 9.5pt; }
  .keys span { background: #fff; border: 1px solid #dfe2ea; border-radius: 6px; padding: 1.5mm 3mm; }
  .keys b { color: #3f3fd1; }
</style></head>
<body>
  <section class="cover">
    <div class="brand"><img src="${logo}" alt="" /> Danish Fitness</div>
    <div>
      <h1>User Guide</h1>
      <p class="sub">Install, first-time setup and daily use of the gym management software</p>
      <ul>
        <li>Install in a minute — no internet, no administrator password</li>
        <li>First-time setup in 5 steps</li>
        <li>Members, fees, receipts, invoices, check-in and member cards</li>
        <li>WhatsApp reminders, reports and automatic backups</li>
      </ul>
    </div>
    <div class="meta">
      Danish Fitness, Model Town B, Khanpur (Rahim Yar Khan)<br />
      Software version ${version} · ${today}<br />
      Designed and developed by <b>Fahad Baloch</b>
    </div>
  </section>
  ${body}
</body></html>`;

const dir = mkdtempSync(join(tmpdir(), "df-guide-"));
const page_ = join(dir, "guide.html");
writeFileSync(page_, html);
const browser = await chromium.launch({ channel: "msedge" });
try {
  const page = await browser.newPage();
  await page.goto(`file:///${page_.replaceAll("\\", "/")}`, { waitUntil: "load" });
  await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true, outline: true, tagged: true });
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
console.log(`Saved ${out}`);
