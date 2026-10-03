# Danish Fitness — Product & Delivery Plan

## 1. Users

| Persona | Needs | Device |
|---|---|---|
| **Receptionist** (non-technical) | Register members fast, take fees, check people in, send WhatsApp reminders, print receipts | Desk PC, keyboard + mouse, maybe a barcode scanner and thermal printer |
| **Owner / Admin** | Know revenue, dues, profit, retention; control staff; never lose data | Same PC (later: phone via online phase) |

## 2. UX principles

1. **Two clicks to anything frequent.** Global search (`Ctrl+K`), shortcuts: `F2` new member, `F3` receive payment,
   `F4` check-in. Primary action always top-right of each page.
2. **Plain words, big targets.** 40–44 px controls, 15 px base text (optional "large text" mode), no jargon
   ("Fee due", not "Outstanding receivable").
3. **Colour = meaning, consistently.** Green active · Amber expiring · Red expired/dues · Sky frozen · Grey none/archived.
   The brand colour (indigo) is never used for a status.
4. **Smart defaults.** Today's date, last plan, full amount pre-filled; renewal start date computed by policy.
5. **Mistakes are recoverable.** Nothing financial is deleted; admins void with a reason. Confirmations only for
   destructive actions.
6. **Fits 1366×768** without horizontal scrolling; scales up to Full HD.
7. **Unambiguous dates** shown as `02 Oct 2026`, money as `Rs 3,500`, phones as `0300-1234567`.

## 3. Screens (v1)

| Screen | Highlights |
|---|---|
| First-run setup | Gym details (pre-filled Danish Fitness, Model Town B, Khanpur), owner account + PIN, admission fee, starter plans |
| Login | Tap your name, enter PIN on a big keypad |
| Dashboard | KPI cards with trends; attention lists (expiring, expired, dues, birthdays, inactive); charts for revenue vs expenses (12 months), daily collections, payment methods, member growth and churn, active members trend, plans, attendance heatmap, gender/age/timing/source |
| Members | Instant search (name/phone/CNIC/code), status chips with counts, sortable table with photo, plan, expiry, dues, last visit |
| Member profile | Header with photo, status, days left, balance; actions Renew, Receive payment, Check-in, Freeze, WhatsApp, Edit; tabs Overview, Memberships, Payments & ledger, Attendance, Progress, Messages, Activity |
| New member | One page: photo (webcam/upload), personal, membership & fees, payment; live summary; save & print / WhatsApp; "existing member" mode |
| Check-in | Scan or type; big green/red verdict; today's check-ins |
| Payments | Ledger with date presets, method/staff filters, totals by method, receipt reprint, WhatsApp receipt, void (admin) |
| Expenses | Add/edit with categories, monthly totals, chart (admin) |
| Plans | Create/edit/deactivate packages, active members per plan |
| Reports | Collections, Dues (with ageing), Memberships, Attendance, Expenses, Profit & Loss, Daily closing; CSV export and print |
| Messages | WhatsApp centre: reminder queues with "last reminded", editable templates (English + Roman Urdu) |
| Settings | Gym profile & logo, rules, payment methods, receipt, WhatsApp, users & PINs, backup & restore, appearance, about |
| Activity log | Searchable audit trail (admin) |

## 4. Delivery phases

| Phase | Scope | Exit criteria |
|---|---|---|
| **0. Foundations** | Toolchain, workspace, Vite/React/Tailwind scaffold, Tauri shell, CI-ready scripts | `npm run tauri dev` opens an empty shell |
| **1. Core domain** | Migrations, clock, pool, settings, users/auth, plans, members, subscriptions, charges, payments, attendance, expenses, measurements, audit, member_stats, stats, backup | `cargo test` green; seeded perf test within targets |
| **2. Desktop bridge** | Commands for every service, session/permissions, photo protocol, plugins, ts-rs bindings | All commands callable from devtools |
| **3. UI foundation** | Design tokens, primitives, app shell, router, query client, error handling, setup wizard, login | First-run → login → empty dashboard |
| **4. Members & money** | Members list/profile, registration (webcam), renew, payments, receipts (80 mm/58 mm/A5), dues, WhatsApp | Register → pay → print → WhatsApp in under 60 s |
| **5. Operations** | Check-in, expenses, plans, freezes, measurements, messages centre | Daily desk workflow complete |
| **6. Insights** | Dashboard and reports with export | Owner questions answered without spreadsheets |
| **7. Safety & polish** | Backups/restore, settings, audit view, shortcuts, empty states, dark mode, large text | Pull-the-plug test passes; restore verified |
| **8. Release** | E2E smoke, performance pass on low-spec PC, icons, installer, user guide | Installer verified on a clean Windows PC |

## 5. Roadmap after v1

- v1.1: CSV/Excel import of existing members, printable member cards with barcode/QR, trainer & PT packages,
  product sales (supplements/water), Urdu UI.
- v1.2: ZKTeco fingerprint/RFID device integration, silent receipt printing, SMS gateway.
- v2 (online): owner remote dashboard, cloud backup, multi-branch sync, WhatsApp Business API automation
  (see Architecture §10).

## 6. Quality targets

| Metric | Target |
|---|---|
| Installer size | < 10 MB (standard), WebView2-bundled variant ~ 150 MB |
| RAM (idle, dashboard open) | < 150 MB total |
| Cold start to usable | < 2 s on Core i3 / SSD, < 4 s on HDD |
| Member search keystroke → results | < 50 ms at 10,000 members |
| Dashboard load | < 100 ms at 3k members / 40k payments / 150k check-ins |
| Data loss on power cut | None for committed transactions |

## 7. Release checklist

- [ ] `cargo test --workspace` and `npm test` green; `npm run lint` and `npm run typecheck` clean
- [ ] Seeded performance test within targets
- [ ] E2E smoke passes on the release build
- [ ] Fresh install → setup wizard → full workflow → backup → restore → uninstall/reinstall keeps data
- [ ] Version bumped in `package.json`, `src-tauri/tauri.conf.json`, `Cargo.toml`
- [ ] Installer tested on Windows 10 and Windows 11, 1366×768 and 1920×1080
- [ ] User guide reviewed with the front-desk staff

## 8. Risks

| Risk | Mitigation |
|---|---|
| PC date wrong / tampered | Clock guard warning; audit trail |
| Disk failure / theft | Rotating backups + second folder (USB/Drive); cloud backup in v2 |
| Staff fraud with cash | Sequential receipts, void-only corrections, WhatsApp receipts to members, daily closing report, audit log |
| WebView2 missing on old PCs | Embedded bootstrapper; offline installer variant |
| Webcam permission denied | Upload-photo fallback; photo optional |
| Unsigned installer warning | Document "More info → Run anyway"; buy a code-signing certificate for wider distribution |
