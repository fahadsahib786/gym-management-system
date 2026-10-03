# Danish Fitness — Research Notes

> Gym: **Danish Fitness**, Model Town B, Khanpur, District Rahim Yar Khan, Punjab, Pakistan.
> Date: October 2026. Purpose: inform the product scope and technical design of the desk software.

---

## 1. What gym software must do (market scan)

Modern gym management products (Glofox, GymMaster, RhinoFit, Easy Gym, MyGymDesk, etc.) converge on the
same core:

| Capability | Why it matters for a small gym | In scope |
|---|---|---|
| Member profiles (photo, contacts, emergency, history) | Front desk identifies members, staff see notes/injuries | v1 |
| Plans / packages and renewals | Fee cycles are the heart of revenue | v1 |
| Billing with partial payments and dues | Pakistani gyms routinely accept part-payments | v1 |
| Expiry & dues reminders (WhatsApp) | WhatsApp is the dominant channel in Pakistan; SMS is secondary | v1 (click-to-chat) |
| Attendance / check-in | Retention: members who stop coming are about to churn | v1 (manual + barcode-scanner friendly) |
| Reporting & analytics (revenue, churn, attendance) | Owner needs real-time visibility | v1 (dashboard + reports) |
| Expense tracking | Without expenses, there is no profit figure | v1 |
| Staff accounts, roles, audit | Cash-handling fraud prevention | v1 |
| Biometric devices (ZKTeco) | Common in Pakistani/Indian gyms | Roadmap (v1.x) |
| Online booking, member mobile app, auto-billing | Cloud products; not needed for a walk-in gym | Roadmap (online phase) |

Retention insight shared by the market leaders: **attendance drop-off predicts cancellation**. We therefore track
"active but not visiting" members and surface them on the dashboard.

## 2. Local context (Khanpur / South Punjab)

- **Fees:** small Punjab cities average roughly **Rs 2,500–3,000/month**; big cities Rs 5,000–7,000. Most local
  gyms charge a one-time **admission fee** plus a **monthly fee**; 3/6/12-month packages carry a discount.
- **Payment methods:** cash still dominates; **JazzCash** and **Easypaisa** wallets and **Raast QR** are growing
  very fast (JazzCash alone onboarded ~1.7M Raast merchants by mid-2026). Bank transfer (IBFT) and card are less common.
  → Methods are configurable; defaults: Cash, JazzCash, Easypaisa, Bank Transfer, Raast, Card.
- **Identity:** CNIC format `XXXXX-XXXXXXX-X` (13 digits). Many members will not share a CNIC for a gym, so it must be
  **optional** (unique only when given).
- **Phones:** mobile numbers `03XX-XXXXXXX`, international `+92 3XX XXXXXXX`. Families often share one number
  (father/son, brothers) → phone must **not** be unique; warn on duplicates instead.
- **Messaging:** WhatsApp is universal. Click-to-chat works without any paid API:
  `whatsapp://send?phone=923001234567&text=…` opens WhatsApp Desktop directly; `https://web.whatsapp.com/send?...`
  for WhatsApp Web; `https://wa.me/...` as universal fallback. Messages are pre-filled; staff press Send.
  Templates should be available in **English and Roman Urdu**.
- **Power cuts (load-shedding):** the PC can lose power at any moment → the database must survive abrupt power loss
  (SQLite WAL + `synchronous=FULL`), and backups must be automatic.
- **Hardware:** typical desk PCs are low-spec (Celeron/Core i3, 4 GB RAM, sometimes HDD), screen 1366×768,
  Windows 10/11, sometimes no internet. Thermal receipt printers (80 mm / 58 mm) are common at shops.
- **Ladies timing:** many gyms run separate time slots (Morning / Evening / Ladies) → "Timing / batch" field.
- **Existing records:** the gym already runs on a paper register → we must support entering existing members with
  their real joining date, current period and already-paid fees **without** distorting today's collection, and allow
  keeping their old register numbers as member codes.
- **Clock problems:** dead CMOS batteries and staff changing the date are common → detect when the system date
  is earlier than the last recorded activity and warn.

## 3. Platform evaluation

| Option | Installer | RAM | Toolchain | Verdict |
|---|---|---|---|---|
| **Tauri 2 (Rust + WebView2)** | ~5–8 MB | ~60–120 MB | Rust + MSVC (dev machine only) | **Chosen** — lightest, native speed, Rust backend reusable on a server later |
| Electron | ~90 MB | 200–300 MB | Node only | Too heavy for 4 GB desk PCs |
| .NET WPF/WinUI | ~1–60 MB | 80–150 MB | .NET SDK | Windows-only UI tech, weaker charting/web reuse for the future online version |
| Flutter desktop | ~25 MB | 100–150 MB | Flutter SDK | Viable, but less mature desktop ecosystem (printing, webcam) |

Notes:
- WebView2 ships with Windows 11 and is present on virtually all updated Windows 10 PCs; the installer can
  bootstrap it when missing. **Windows 7/8 are not supported** (WebView2 dropped them in 2023; same for Electron).
- Rust/MSVC are needed only on the machine that **builds** the app. End-user PCs just run the installer.

## 4. Library versions (latest stable, verified Oct 2026)

| Area | Choice | Version |
|---|---|---|
| Desktop shell | tauri / tauri-build / @tauri-apps/cli | 2.12.1 / 2.7.1 / 2.12.1 |
| Tauri plugins | dialog, opener, log, single-instance, window-state | 2.8.1, 2.7.0, 2.10.0, 2.5.2, 2.5.0 |
| Rust toolchain | stable | 1.99.0 |
| Database | rusqlite (bundled SQLite) + r2d2_sqlite pool | 0.40.2 + 0.35.0 |
| Rust utils | chrono, uuid (v7), argon2, zip, csv, serde, thiserror, ts-rs | 0.4.45, 1.26.1, 0.6.0, 8.6.0, 1.4.0, 1.0.229, 2.0.21, 12.0.1 |
| UI runtime | React / React DOM | 19.3.0 |
| Language | TypeScript (native Go compiler) | 7.0.2 |
| Bundler | Vite + @vitejs/plugin-react | 8.3.2 + 6.1.1 |
| Styling | Tailwind CSS + @tailwindcss/vite | 4.3.3 |
| Primitives | radix-ui (accessible headless components) | 1.6.7 |
| Data | @tanstack/react-query | 5.104.1 |
| Routing | react-router | 8.4.0 |
| Forms | react-hook-form + zod + @hookform/resolvers | 7.89.0 + 4.6.5 + 5.9.1 |
| Charts | recharts | 3.10.1 |
| Misc UI | lucide-react, sonner, cmdk, react-day-picker, date-fns | 1.50.0, 2.0.8, 1.1.1, 10.0.2, 4.4.0 |
| Tests/tooling | vitest, @testing-library/react, jsdom, playwright-core, biome | 5.0.3, 16.3.3, 30.1.1, 1.63.0, 2.5.15 |

## 5. Review of the initial blueprint

The blueprint that came with the request was a useful starting point. Kept: Tauri v2, SQLite, React + Tailwind,
WhatsApp deep links, colour-coded statuses, CNIC/phone auto-formatting, webcam capture, 80 mm receipts,
automatic backups.

Changed, with reasons:

| # | Blueprint | Problem | Our design |
|---|---|---|---|
| 1 | `tauri-plugin-sql`, SQL in the frontend | Pooled connections make multi-statement transactions unreliable; business rules end up in UI code; not reusable online | All business logic and SQL in a **Rust core crate** (`danish-core`), exposed via typed commands; reusable by a future web server |
| 2 | `amount_due` stored on each payment row | `SUM(amount_due)` double counts (every partial payment repeats the remaining due) | Proper **ledger**: `charges` (what is owed) vs `payments` (what is received); balance = charges − payments |
| 3 | Money as `REAL` | Floating-point rounding errors in financial totals | Money as **INTEGER rupees** |
| 4 | `subscriptions.status = 'active'` stored | Goes stale at midnight; needs a cron job to flip to "expired" | Status **derived from dates** at query time |
| 5 | `CURRENT_DATE` / `CURRENT_TIMESTAMP` in SQL | SQLite uses **UTC**; Pakistan is UTC+5 → "today" is wrong from 00:00–05:00 | Rust passes local `today`; timestamps stored as local time (PKT has no DST) |
| 6 | `ON DELETE CASCADE` from members to payments | Deleting a member silently wipes financial history (accident/fraud) | `RESTRICT`; members are **archived**, payments are **voided** (never deleted); triggers block deletes |
| 7 | CNIC `NOT NULL UNIQUE` | Many members won't give CNIC; blocks registration | CNIC optional, unique when present |
| 8 | Autoincrement integer IDs | Collide when syncing multiple devices / cloud later | **UUIDv7** primary keys + human-friendly codes (`DF-0001`, `R-000001`) |
| 9 | Audit log without user | Cannot tell who did what | Staff login with PIN + roles; audit rows carry user, entity, details; **append-only** (DB trigger) |
| 10 | Backup only on close | Power cut = no backup; no restore path | Backup on start (if stale), every few hours, on close; retention; second folder (USB); validated restore |
| 11 | No admission fee, expenses, attendance, freezes, renewal rules | Owner can't see profit, retention or real dues | All included in v1 |
| 12 | TanStack Table for 10k rows in the UI | Ships the whole dataset to the UI | Server-side search/filter/paginate in SQLite (sub-ms) |

## Sources

- [Top gym management software features you need in 2026 — Vibefam](https://vibefam.com/top-gym-management-software-features-you-need-in-2026/)
- [2026 Gym Management Software Guide — RhinoFit](https://rhinofit.ca/2026-gym-management-software-guide/)
- [What to look for in gym management software — Recess](https://www.recess.tv/blog-posts/what-to-look-for-in-a-gym-management-software)
- [Gym management software features — Glofox](https://www.glofox.com/blog/gym-management-software-features/)
- [Gym management software in 2026 (AI guide) — Club Automation](https://www.clubautomation.com/blog/ai/gym-management-software-ai-guide-2026)
- [Easy Gym Software](https://easygymsoftware.com/gym-management-software) · [MyGymDesk](https://www.techjockey.com/detail/mygymdesk)
- [Gym membership price, Pakpattan — Expatistan](https://expatistan.com/price/gym/pakpattan) · [Lahore](https://www.expatistan.com/price/gym/lahore)
- [JazzCash onboards 1.7 million merchants onto Raast — Digital Pakistan](https://digitalpakistan.pk/jazzcash-onboards-1-7-million-merchants-onto-raast/)
- [Pakistan's digital payment revolution 2026 — Simpaisa](https://www.simpaisa.com/blogs/pakistans-digital-payment-revolution-2026-stats-trends-whats-next/)
- [PSHA calls for incentives to drive Raast payments — ProPakistani](https://propakistani.pk/2025/12/29/psha-calls-for-incentives-and-lower-fees-to-drive-raast-payments/amp/)
- [WhatsApp desktop URL scheme — Airtable community](https://community.airtable.com/t/whatsapp-button-for-whatsapp-desktop/32913)
- [React Router v8 announcement — Remix](https://remix.run/blog/react-router-v8) · [TypeScript 7 released — InfoQ](https://infoq.com/news/2026/08/typescript-7-released/)
- [Tauri core releases](https://tauri.app/release/core/)
