# Danish Fitness — System Architecture

Version 1.0 · October 2026

---

## 1. Goals and constraints

| Requirement | Design response |
|---|---|
| Runs on **any Windows 10/11 PC**, offline by default | Tauri 2 desktop app (WebView2), single-file SQLite database, per-user installer that needs no admin rights |
| Very fast and lightweight on low-spec PCs (4 GB RAM, Celeron/i3, HDD, 1366×768) | Rust backend, ~6 MB installer, ~60–120 MB RAM, indexed SQL, one IPC call per screen, code-split UI |
| Easy for non-technical staff | Large controls, plain language, colour-coded statuses, smart defaults, keyboard shortcuts, PIN login, undo-safe flows (void instead of delete) |
| Manual registration and fee records | Registration bundle (member + membership + admission fee + payment) in one atomic transaction |
| Very detailed statistics | Dashboard + 7 reports computed in Rust from a proper ledger (charges vs payments), attendance and expenses |
| Flexible to go online later | UUIDv7 keys, `updated_at`/soft-delete on all mutable rows, all logic in a UI-independent Rust crate, transport-agnostic RPC API |
| Latest stable libraries | See `docs/RESEARCH.md` §4 |
| Survive power cuts (load-shedding) | SQLite WAL + `synchronous=FULL`, automatic rotating backups, validated restore |

## 2. High-level view

```
┌──────────────────────────────── Windows PC ────────────────────────────────┐
│                                                                             │
│  ┌──────────────────────── WebView2 (UI process) ────────────────────────┐  │
│  │ React 19 + TypeScript 7 + Tailwind 4                                   │  │
│  │  pages/features ─▶ TanStack Query hooks ─▶ api client ─▶ Transport     │  │
│  │                                                    (Tauri invoke)      │  │
│  └───────────────────────────────────────────────┬────────────────────────┘  │
│                         JSON over Tauri IPC       │   photo:// protocol       │
│  ┌───────────────────────────────────────────────▼────────────────────────┐  │
│  │ Tauri 2 shell (src-tauri)                                              │  │
│  │  commands/*  — session + permission check, call core, map errors       │  │
│  │  plugins     — dialog, opener, log, single-instance, window-state      │  │
│  ├────────────────────────────────────────────────────────────────────────┤  │
│  │ danish-core (crates/core) — pure Rust, no Tauri dependency             │  │
│  │  services: members · memberships · billing · attendance · expenses     │  │
│  │            plans · stats/reports · auth · settings · audit · backup     │  │
│  │  db: r2d2 pool · migrations (PRAGMA user_version) · pragmas · clock     │  │
│  └───────────────────────────────────────────────┬────────────────────────┘  │
│                                                  ▼                           │
│   %APPDATA%\com.danishfitness.desk\danish-fitness.db   (SQLite, WAL)         │
│   Documents\Danish Fitness\Backups\*.db              (rotating backups)      │
│   optional second backup folder (USB / Google Drive folder)                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 3. Repository layout

```
danish-fitness/
├── Cargo.toml                 # Rust workspace: crates/core + src-tauri
├── crates/core/               # danish-core: domain logic + SQL (unit-tested, server-reusable)
│   ├── migrations/            # 0001_init.sql, ...
│   └── src/{db,model,auth,settings,plans,members,memberships,billing,
│            attendance,expenses,measurements,messages,stats,audit,backup,export,seed}.rs
├── src-tauri/                 # Desktop shell: commands, state, plugins, photo protocol, packaging
├── src/                       # React app
│   ├── api/                   # transport, typed client, generated bindings (ts-rs)
│   ├── app/                   # router, shell layout, providers
│   ├── components/ui/         # accessible primitives (Radix-based)
│   ├── components/common/     # app building blocks (StatusBadge, Money, DateField, …)
│   ├── features/<area>/       # dashboard, members, payments, attendance, expenses, …
│   └── lib/                   # formatting, phone/CNIC, dates, templates, print, csv
├── e2e/                       # Playwright smoke tests over WebView2 CDP
└── docs/                      # research, architecture, plan, user guide
```

## 4. Layers and responsibilities

1. **UI (React).** Renders state, validates input for fast feedback (Zod), never computes money or dates
   authoritatively. Talks only to the `api` client.
2. **API client + Transport.** One typed function per backend command (`api.members.list(...)`).
   `Transport` is an interface; today it is `invoke()`, later it can be `fetch('/api/rpc/<command>')`
   with zero change to pages.
3. **Command layer (src-tauri).** Thin: resolves the logged-in `Actor`, checks the permission, runs the core
   function on a blocking thread with a pooled connection, converts errors to `{ kind, message, field? }`.
4. **Core (crates/core).** Business rules, validation, transactions, audit entries and SQL. Has no Tauri
   dependency, so `cargo test -p danish-core` runs fast, and a future Axum server can reuse it.
5. **SQLite.** Single file, WAL, foreign keys on, `synchronous=FULL`, `busy_timeout`, prepared-statement cache.

Types crossing the IPC boundary are Rust structs (`serde`, camelCase) with TypeScript definitions generated by
**ts-rs**, so the frontend and backend cannot drift.

**Documents (print and PDF).** Receipts, fee invoices, member cards and reports are React components rendered
into a hidden `#print-root` with an `@page` rule per paper (`lib/print.tsx`; only `#print-root` is visible in print
CSS). *Print* calls `window.print()`; *Save as PDF* asks for a file name and calls the `save_pdf` command, which
prints the same view to a file with WebView2's `PrintToPdf` (`src-tauri/src/pdf.rs`: page size and margins per
paper, backgrounds on, no header/footer, the webview background switched to white while it runs). So the PDF is
always identical to the printout, with selectable text and embedded fonts. Fee invoices are computed on demand
(`billing::fee_invoice`: unpaid charges plus everything billed since the current membership started, using the
ledger's FIFO allocation) and are not stored. Member-card barcodes are Code 128 (set B), checked against an
independent implementation.

## 5. Data model

All primary keys are **UUIDv7** strings (time-ordered, globally unique: safe for future sync).
Money is **INTEGER rupees**. Dates are `YYYY-MM-DD`; timestamps are local `YYYY-MM-DD HH:MM:SS`
(Asia/Karachi has no DST, so local ↔ UTC is a constant +05:00).

| Table | Purpose | Key columns |
|---|---|---|
| `settings` | Typed settings, one JSON document per section | key, value, updated_at |
| `counters` | Sequences for human codes | name (`member_code`, `receipt_no`), value |
| `users` | Staff accounts | name, pin_hash (argon2id), role (`admin`/`staff`), is_active, lockout fields |
| `plans` | Packages | name, duration_value + duration_unit (`day`/`month`), price, is_active, sort_order |
| `members` | People | member_code (unique), full_name, father_name, gender, dob, phone, whatsapp, cnic (unique, optional), address, area, occupation, blood_group, emergency contact, medical_notes, timing, source, join_date, status (`active`/`archived`) |
| `member_photos` | JPEG photo + 96 px thumbnail (kept out of `members` so list scans never touch blobs) | member_id, photo, thumb |
| `subscriptions` | Membership periods | member_id, plan_id, plan_name (snapshot), kind (`new`/`renewal`/`migrated`), start_date, end_date, base_end_date, freeze_days, cancelled_* |
| `freezes` | Pauses that extend a subscription | subscription_id, start_date, end_date, days, cancelled_* |
| `charges` | **What a member owes** | kind (`membership`, `admission`, `training`, `locker`, `product`, `fine`, `other`), amount, discount, net_amount (generated), charge_date, voided_* |
| `payments` | **What a member paid** | receipt_no (unique), amount, method, reference, paid_at, paid_on (generated), received_by, items_json + balance_before/after (receipt snapshot), voided_* |
| `attendance` | Check-ins (integer key: the largest table) | id, member_id, checked_in_at, method (`manual`/`scan`); indexes on (member_id, checked_in_at) and checked_in_at |
| `expense_categories`, `expenses` | Running costs | category, amount, expense_date, method, payee, deleted_* |
| `measurements` | Body progress | weight, height, body fat, chest, waist, hips, arm, thigh |
| `message_log` | WhatsApp messages opened | member_id, template, phone, body |
| `audit_log` | Who did what (append-only, enforced by triggers) | at, user, action, entity, entity_id, summary, details |
| `member_stats` | Derived per-member summary (recomputed, never hand-edited) | end_date, plan_name, balance, total_paid, last_payment_at, last_visit_at, visit_count, freeze window |

Integrity rules enforced **in the database**:
- `payments` and `audit_log` cannot be deleted (triggers); financial corrections are **voids with a reason**.
- Members referenced by money rows cannot be deleted (`ON DELETE RESTRICT`); they are **archived**.
- `CHECK` constraints on enums, positive amounts, `discount ≤ amount`, `end_date ≥ start_date`.

`member_stats` is refreshed for the affected member **inside the same transaction** as every mutation
(`refresh_member_stats`), and fully rebuilt on startup after migrations/restore. It is recomputed from source
tables, never incremented, so it cannot drift.

## 6. Business rules

**Membership period.** `end = start + duration − 1 day` (inclusive). Months use calendar arithmetic
(2 Oct → 1 Nov; 31 Jan → 27 Feb).

**Status** (derived at query time from `member_stats` and today's date):

| Status | Rule | Colour |
|---|---|---|
| Active | a valid subscription covers today, more than *N* days left | green |
| Expiring | covers today, `days_left ≤ expiringSoonDays` (default 7) | amber |
| Frozen | today inside a freeze | sky blue |
| Expired | latest end date < today | red |
| Upcoming | next subscription starts in the future | violet |
| No plan | registered, never subscribed | grey |
| Archived | left the gym | grey (muted) |

**Renewal start date.** If the current membership has not ended → continues the day after it ends (no lost days).
If it ended ≤ `lateRenewalGraceDays` (default 10) ago → continues from the old end date (fee date stays the same,
the usual local practice). Otherwise → starts today. Staff can always override.

**Fees and balance.** Registration creates charges (membership at plan price − discount, admission fee unless waived)
and an optional payment. `balance = Σ charges.net_amount − Σ payments.amount` (non-voided). Positive = dues,
negative = advance. Partial payments are first-class. Each payment stores a receipt snapshot (items, balance
before/after) so reprinted receipts never change.

**Existing members (migration from paper register).** "Joined before using this software" mode: original join date,
current period, amount already paid and its date, optional old register number as member code, no admission fee.
Payments are dated in the past so today's collection is not distorted.

**Freeze.** Freezing *N* days extends `end_date` by *N*. Ending early gives back the unused days.

**Check-in.** One click / scan. Warns (but allows, owner's choice) when expired, frozen, no plan or dues > 0.
A repeat check-in within the cool-down window (default 60 min) is ignored with a message.

**Numbers.** Member codes `DF-0001` (prefix/digits configurable, manual override allowed, unique).
Receipts `R-000001`, strictly sequential and never reused; voided receipts stay visible, so gaps are detectable.

**Clock guard.** On start, if the system date is earlier than the newest record, the app warns that the PC date is wrong
(dead CMOS battery or tampering) before anything is saved.

## 7. Security model

- Staff log in by tapping their name and entering a **PIN** (argon2id hash; 5 wrong tries → 30 s lockout).
- Roles: **Admin/Owner** (everything) and **Receptionist** (registration, renewals, payments, check-in, members).
  Receptionists cannot void, edit dates, see expenses/profit (unless the owner enables it), manage users, change
  settings or restore backups.
- Permissions are enforced **in Rust** (the UI only hides what you cannot do).
- Every financial or administrative action writes an immutable audit row with the user's name.
- Tauri capabilities grant the webview only what it needs; strict CSP; external URLs opened from Rust after
  validation (WhatsApp links only).
- Camera: `Builder::on_permission_request` grants **only** the camera, and only to the app's own bundled pages
  (CSP blocks remote content), so member photos work without WebView2's prompt — whose remembered "Block" would
  otherwise disable the webcam for good. Everything else keeps WebView2's default handling.

## 8. Performance design

- **Connections:** r2d2 pool (4) with per-connection pragmas: WAL, `synchronous=FULL`, `foreign_keys=ON`,
  `busy_timeout=5000`, `temp_store=MEMORY`, `cache_size=-16000`, `mmap_size=256MB`; `PRAGMA optimize` on close.
- **Writes** use `BEGIN IMMEDIATE` to avoid lock-upgrade deadlocks.
- **One round-trip per screen** (e.g. `dashboard_get` returns all KPIs, charts and lists in one struct).
- **Server-side search/filter/sort/paginate** in SQL; member list search is a <5 ms scan at 10k members.
- **Photos** served by a custom `photo://` protocol straight from SQLite with immutable cache headers;
  lists use 96 px thumbnails (~3 KB).
- **UI:** route-level code splitting, Recharts only in chart chunks, debounced search (150 ms), TanStack Query cache,
  window shown only after first paint (no white flash), bundled variable font (no network).

Targets (measured in `docs/PLAN.md` §6): cold start < 2 s, screen switch < 150 ms, search < 50 ms,
dashboard < 100 ms with 3,000 members / 40,000 payments / 150,000 check-ins.

## 9. Reliability and data safety

- SQLite WAL + `synchronous=FULL`: committed data survives power loss; the DB never corrupts on a cut.
- **Automatic backups** (`VACUUM INTO`, consistent hot copy): on start if the last one is > 20 h old, every
  6 h while running if data changed, and on exit. Keeps the last 30; manual backups are never auto-deleted.
  Optional mirror to a second folder (USB drive / Google Drive folder).
- **Restore:** validates the file (`integrity_check`, schema version, required tables), takes a safety backup of
  the current data, swaps the database, re-runs migrations, rebuilds summaries, and reloads the UI.
- **Backup location:** the setup wizard suggests `<second fixed drive>:\Danish Fitness\Backups` (first non-system
  fixed drive with ≥ 1 GB free, via `GetDriveTypeW`), so backups survive a Windows reinstall. If a configured folder
  becomes unreachable, backups fall back to `Documents\Danish Fitness\Backups` and Settings shows a warning; when
  backups share the data's drive, Settings offers the second drive.
- **Updates:** before the database is opened, `backup::backup_before_upgrade` copies it (kind `update`) when the
  schema needs migrating or the app version differs from `system.lastAppVersion`. Tauri's NSIS updater runs the old
  uninstaller with `/UPDATE`, which never touches app data.
- **Uninstall:** `src-tauri/windows/hooks.nsh` (`NSIS_HOOK_PREUNINSTALL`, skipped in update mode) copies the
  database and its WAL to `Documents\Danish Fitness\Backups` and to the folder named in `backup-folder.txt` (written
  after every backup) before anything is removed — even if "Delete the application data" is ticked.
- **New PC / reinstall:** while no gym is set up, `setup_find_backups` lists backups in the suggested and default
  folders and `setup_restore` restores one without a login; `stage_restore` applies a `-wal` file found next to it.
- `quick_check` at startup; logs in `%LOCALAPPDATA%\com.danishfitness.desk\logs`.
- Single-instance guard: a second launch focuses the running window.

## 10. Path to online (future phases, no rewrite needed)

| Step | What changes | Why it is cheap |
|---|---|---|
| A. Owner remote dashboard | Add `crates/server` (Axum) exposing `POST /api/rpc/:command` with token auth, reusing `danish-core` | Core has no Tauri dependency; commands are already RPC-shaped |
| B. Cloud backup | Upload the rotating backup file to object storage | Backups are already single consistent files |
| C. Multi-device / branch sync | Push/pull rows changed since a cursor (`updated_at`), soft deletes propagate, conflicts resolved last-writer-wins per row | UUIDv7 keys, `updated_at`, `deleted_at` already present |
| D. Automated WhatsApp | Swap click-to-chat for WhatsApp Business Cloud API behind the same `messages` module | Templates and message log already exist |
| E. Web/mobile UI | Same React app built with `HttpTransport` | Transport is an interface |

Human-readable codes (`DF-0001`, `R-000001`) are per-device today; for multi-device sync they will receive a device
prefix or be assigned by the server. IDs never change, so this is a display concern only.

## 11. Testing strategy

| Level | Tooling | What |
|---|---|---|
| Core unit/integration | `cargo test -p danish-core` (in-memory SQLite, fixed clock) | date maths, statuses, renewals, freezes, balances, receipts, voids, permissions, stats, backup/restore round-trip |
| Frontend unit | Vitest + Testing Library | phone/CNIC normalisation, money/date formatting, template rendering, form schemas |
| Performance | seeded DB (3k members, 40k payments, 150k check-ins) | query timings asserted in tests |
| End-to-end smoke | Playwright over WebView2 CDP against the real app | setup → register → pay → check-in → dashboard → backup |

## 12. Build and distribution

- `npm run tauri build` → NSIS installer `Danish Fitness_<version>_x64-setup.exe`, **per-user install (no admin)**,
  Start-menu + desktop shortcut, WebView2 bootstrapper embedded (installs it only if missing).
- Optional "offline" installer variant with the WebView2 runtime bundled for PCs with no internet.
- Requirements: Windows 10 (1809+) or 11, x64; 2 GB RAM minimum; 200 MB disk. Windows 7/8 not supported.
- Code signing is recommended before wider distribution (removes the SmartScreen "unknown publisher" prompt).
