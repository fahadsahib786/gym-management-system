<div align="center">

<img src="src-tauri/icons/128x128.png" width="88" alt="Danish Fitness logo" />

# Danish Fitness — Gym Management System

**Offline-first desktop software that runs a gym: members, fees and receipts, attendance, WhatsApp
reminders, detailed reports and automatic backups.**

Built for **Danish Fitness, Model Town B, Khanpur (Rahim Yar Khan)** · Windows 10 / 11 · works without internet

*Designed and developed by **Fahad Baloch***

</div>

![Danish Fitness dashboard](docs/screenshots/07-dashboard.png)

## Contents

- [Highlights](#highlights)
- [Install](#install)
- [Setup tutorial (5 minutes)](#setup-tutorial-5-minutes)
- [Daily use at a glance](#daily-use-at-a-glance)
- [PDF receipts, fee invoices and member cards](#pdf-receipts-fee-invoices-and-member-cards)
- [Your data is safe](#your-data-is-safe)
- [More screenshots](#more-screenshots)
- [For developers](#for-developers)
- [Credits and license](#credits-and-license)

The complete staff manual, with a screenshot for every step, is in **[docs/USER_GUIDE.md](docs/USER_GUIDE.md)**.

## Highlights

| | |
|---|---|
| **Members** | Register in under a minute: photo from the laptop camera, a USB webcam or a file; CNIC/phone auto-formatting; duplicate warnings; "existing member" mode for the paper register. |
| **Fees** | Plans, admission fee, discounts, partial payments, advance credit, exact dues with ageing, sequential receipts (thermal 80/58 mm or A5), **PDF receipts and fee invoices**. |
| **Renewals & freezes** | Renewal dates follow the gym's late-renewal rule; freezes push end dates forward automatically. |
| **Attendance** | Works with **no machine** (F4, type a name, phone or ID, Enter) or with a cheap USB barcode scanner and printed **member cards**. Can be switched off completely. |
| **WhatsApp** | One click opens WhatsApp with the message typed (English or Roman Urdu templates); ready lists for expiring, expired, fee due, birthdays and members who stopped coming. No paid API. |
| **Dashboard & reports** | Live KPIs with trends, revenue vs expenses, busy hours, demographics; daily closing (cash drawer), collections, memberships, attendance, expenses and profit & loss — printable, PDF, Excel. |
| **Control** | Staff accounts with PIN and roles, an activity log that cannot be edited, voids with reasons instead of deletes. |
| **Safety** | Survives power cuts; automatic backups to a second drive (D:) and USB; "before update" and "before uninstall" copies; one-click restore on a new PC. |
| **Fast and light** | ~6 MB installer, opens in about a second, dashboard in < 100 ms with 3,000 members. |

## Install

1. Download **`Danish Fitness_1.0.0_x64-setup.exe`** from the [Releases](../../releases) page
   (or [build it yourself](#for-developers)).
2. Double-click it. If Windows shows *"Windows protected your PC"*, click **More info → Run anyway**
   (shown for new software without a paid code-signing certificate).
3. It installs in a few seconds — **no administrator password needed**. A **Danish Fitness** icon appears on the
   desktop and in the Start menu.

Requirements: Windows 10 or 11 (64-bit), 4 GB RAM or more. Nothing else to install — the installer adds the Microsoft
Edge WebView2 runtime automatically if a PC does not have it.

## Setup tutorial (5 minutes)

The first time the app opens, a short wizard sets everything up. You can change all of it later in **Settings**.

<table>
<tr>
<td width="50%"><img src="docs/screenshots/01-setup-welcome.png" alt="Welcome screen" /><br/>
<b>1. Welcome.</b> Click <b>Get started</b>. Moving from another PC? Click <b>Restore</b> next to the backup it
finds, or <b>Choose backup file…</b> — everything comes back.</td>
<td width="50%"><img src="docs/screenshots/02-setup-gym.png" alt="Gym details" /><br/>
<b>2. Gym details.</b> Name, address and phone — printed on receipts, invoices, cards and WhatsApp messages.</td>
</tr>
<tr>
<td><img src="docs/screenshots/03-setup-owner.png" alt="Owner account" /><br/>
<b>3. Owner account.</b> Your name and a 4–8 digit <b>PIN</b>. Write the owner PIN down somewhere safe.</td>
<td><img src="docs/screenshots/04-setup-plans.png" alt="Fees and plans" /><br/>
<b>4. Fees & plans.</b> Admission fee and packages (Monthly, Quarterly, Half-yearly, Yearly, Daily pass) —
change the prices to yours.</td>
</tr>
<tr>
<td><img src="docs/screenshots/05-setup-finish.png" alt="Finish and backup folder" /><br/>
<b>5. Finish.</b> Check the summary. The backup folder is chosen automatically — a second drive such as
<code>D:\Danish Fitness\Backups</code> when the PC has one. Click <b>Open Danish Fitness</b>.</td>
<td><img src="docs/screenshots/06-login.png" alt="Login" /><br/>
<b>6. Log in.</b> Type your PIN (tap your name first when there are several staff). Add receptionists in
<b>Settings → Users & security</b> so the activity log shows who did what.</td>
</tr>
</table>

> **Practice first?** On a spare PC, open **Settings → Backup & restore → Load demo data** (only works in an empty
> gym) to get a realistic year of members, payments and check-ins to try everything safely.

## Daily use at a glance

| Task | How | |
|---|---|---|
| **New member** | **F2** → name, mobile, photo → plan → amount paid → **Save** (or **Save & print** / **Save & WhatsApp**) | <img src="docs/screenshots/11-register-member.png" width="260" alt="Register member" /> |
| **Take fees** | **F3** (or the member's **Receive payment**) → amount and method → **Save**, **Save & print** or **Save & WhatsApp** | <img src="docs/screenshots/13-receive-payment.png" width="260" alt="Receive payment" /> |
| **Renew** | Member → **Renew** → choose plan; dates fill themselves | <img src="docs/screenshots/14-renew.png" width="260" alt="Renew" /> |
| **Check-in** | **F4** → type name / phone / ID → **Enter** (or scan the card) — green, amber or red with photo | <img src="docs/screenshots/20-check-in.png" width="260" alt="Check-in" /> |
| **Collect dues** | **Fee dues** → **Remind** on WhatsApp, **Collect**, or the invoice-PDF button | <img src="docs/screenshots/19-fee-dues.png" width="260" alt="Fee dues" /> |
| **Reminders** | **WhatsApp** page → pick a list → **Send** | <img src="docs/screenshots/22-whatsapp.png" width="260" alt="WhatsApp" /> |
| **End of day** | **Reports → Daily closing** → **Print closing** (cash that should be in the drawer) | <img src="docs/screenshots/25-report-daily-closing.png" width="260" alt="Daily closing" /> |

Keyboard: **F2** new member · **F3** receive payment · **F4** check-in · **Ctrl + K** search anything.

## PDF receipts, fee invoices and member cards

Every document can be **printed** or **saved as a PDF** (to send on WhatsApp, e-mail or take to a print shop):

- **Receipt** — open any payment's receipt → **PDF** (A5).
- **Fee invoice** — member → *Payments & fees* → **Invoice → Save invoice as PDF**, or the PDF button on
  **Fee dues**. Lists what was charged, what is paid and what is still due.
- **Member card** — member → **▾** → **Member card PDF**, or **Members → Print cards** for everyone in the list
  (ten per A4 sheet). Photo, name, ID, phone, CNIC, father/husband name, blood group, timing and a check-in barcode.

<table>
<tr>
<td width="34%"><img src="docs/screenshots/pdf-receipt.png" alt="PDF receipt" /><br/><b>PDF receipt</b> (A5)</td>
<td width="33%"><img src="docs/screenshots/pdf-fee-invoice.png" alt="PDF fee invoice" /><br/><b>Fee invoice</b> (A4)</td>
<td width="33%"><img src="docs/screenshots/pdf-member-cards.png" alt="Member cards sheet" /><br/><b>Member cards</b> (10 per A4)</td>
</tr>
</table>

<img src="docs/screenshots/pdf-member-card.png" width="420" alt="Member card" />

## Your data is safe

| Situation | What happens |
|---|---|
| **Power cut** | Everything saved before the light went is safe (SQLite WAL + full sync). |
| **Every day** | Automatic backups on start, every few hours while data changes, and on exit — kept on a **second drive** (e.g. `D:\Danish Fitness\Backups`), plus an optional USB / Google Drive copy. |
| **New version** | Run the new installer over the old one. Data is untouched; a **"Before update"** backup is taken automatically on first start. |
| **Uninstall & reinstall** | Data stays on the PC. Even if *"Delete the application data"* is ticked, the uninstaller first saves a copy in `Documents\Danish Fitness\Backups`. |
| **New PC / Windows reinstalled** | Install, then click **Restore** on the first screen (or pick the backup from the D: drive / USB). Log in with the same PIN. |

All of this was tested with the real installer: install → update → uninstall → wipe → reinstall → restore.

## More screenshots

| | |
|---|---|
| <img src="docs/screenshots/08-dashboard-charts.png" alt="Dashboard charts" /> Revenue vs expenses, payment methods, expenses | <img src="docs/screenshots/09-dashboard-attendance.png" alt="Dashboard attendance" /> New vs left, active members, busy hours |
| <img src="docs/screenshots/10-members.png" alt="Members" /> Members with status filters | <img src="docs/screenshots/12-member-profile.png" alt="Member profile" /> Member profile |
| <img src="docs/screenshots/18-receipt.png" alt="Receipt" /> Receipt with Print, PDF and WhatsApp | <img src="docs/screenshots/21-member-cards-dialog.png" alt="Member cards" /> Member cards — print or PDF |
| <img src="docs/screenshots/27-report-memberships.png" alt="Memberships report" /> Memberships & renewal rate | <img src="docs/screenshots/28-report-profit-loss.png" alt="Profit and loss" /> Profit & loss |
| <img src="docs/screenshots/24-expenses.png" alt="Expenses" /> Expenses by category | <img src="docs/screenshots/31-settings-backup.png" alt="Backups" /> Backups & restore |
| <img src="docs/screenshots/30-settings-whatsapp.png" alt="WhatsApp templates" /> WhatsApp templates with live preview | <img src="docs/screenshots/32-activity-log.png" alt="Activity log" /> Activity log (who did what) |

## For developers

### Technology

| Layer | Choice |
|---|---|
| Desktop shell | [Tauri 2](https://tauri.app) (Rust, Microsoft Edge WebView2) — small, fast, no bundled browser |
| Core logic | Rust crate `crates/core` (UI-independent, reusable by a future server) |
| Database | SQLite (bundled, WAL, `synchronous=FULL`), STRICT tables, UUIDv7 keys, append-only ledger |
| UI | React 19, TypeScript 7, Vite 8, Tailwind CSS 4, Radix UI, TanStack Query, Recharts |
| Types | Rust → TypeScript bindings generated with ts-rs |
| PDFs | WebView2 `PrintToPdf` of the same layout that prints (selectable text, embedded fonts) |
| Installer | NSIS, per-user, WebView2 bootstrapper, static VC++ runtime |

### Build and run

Requirements: Windows 10/11, [Rust](https://rustup.rs) (stable, MSVC), Node.js 24 LTS, Visual Studio Build Tools
(C++ workload).

```bash
npm install
npm run app:dev          # run the app with hot reload
npm run app:build        # release build + installer → target/release/bundle/nsis/
```

| Command | What it does |
|---|---|
| `npm run typecheck` / `npm run lint` / `npm test` | TypeScript, Biome lint/format check, Vitest unit tests |
| `npm run test:rust` | Rust unit + workflow tests (`cargo test --workspace`) |
| `npm run bindings` | Regenerate `src/api/bindings` from the Rust types |
| `cargo test -p danish-core --release --test performance -- --ignored --nocapture` | Benchmark at gym scale (3,000 members, 24 months) |
| `node e2e/smoke.mjs` | End-to-end test against the running app (see the file header) |
| `node e2e/docs-screenshots.mjs` | Regenerate the screenshots in `docs/screenshots/` |

Environment variables: `DANISH_FITNESS_DATA_DIR` (portable/test data folder), `DF_PROFILE=1` (dashboard query
timings), `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` (lets the e2e scripts drive the app).

### Project structure

```
crates/core/          Rust business logic: members, memberships, billing, attendance, stats, backup, …
  migrations/         SQLite schema
  tests/              workflow and performance tests
src-tauri/            Tauri shell: commands, photo protocol, PDF export, drive detection, installer hooks
src/                  React app: features/<area>, components, api client + generated bindings
e2e/                  Playwright scripts that drive the real app over WebView2's DevTools protocol
docs/                 USER_GUIDE.md (staff manual), ARCHITECTURE.md, PLAN.md, RESEARCH.md, screenshots/
```

### Data locations

| What | Where |
|---|---|
| Database | `%APPDATA%\com.danishfitness.desk\danish-fitness.db` |
| Backups | Folder chosen at setup (suggested `D:\Danish Fitness\Backups`), else `Documents\Danish Fitness\Backups`, plus an optional second folder |
| Logs | `%LOCALAPPDATA%\com.danishfitness.desk\logs` |

Money is stored as whole rupees, dates as `YYYY-MM-DD`, timestamps in local time. Payments and the activity log
cannot be deleted (database triggers); mistakes are voided with a reason. More in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Release checklist

1. Bump the version in `package.json`, `Cargo.toml` (workspace) and `src-tauri/tauri.conf.json`.
2. `npm run lint && npm run typecheck && npm test && npm run test:rust`
3. `npm run app:build` → `target/release/bundle/nsis/Danish Fitness_<version>_x64-setup.exe`
4. Publish the installer on the GitHub **Releases** page.

## Credits and license

**Designed and developed by Fahad Baloch** for Danish Fitness, Model Town B, Khanpur (Rahim Yar Khan).

© 2026 Danish Fitness. All rights reserved.
