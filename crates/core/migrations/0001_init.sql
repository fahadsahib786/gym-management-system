-- Danish Fitness schema v1
-- Conventions:
--   * Primary keys: UUIDv7 text (globally unique, time ordered -> sync-ready)
--   * Money: INTEGER rupees
--   * Dates: 'YYYY-MM-DD'; timestamps: local 'YYYY-MM-DD HH:MM:SS' (Asia/Karachi, no DST)
--   * Financial rows are never deleted: they are voided with a reason.

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
) STRICT;

CREATE TABLE counters (
  name   TEXT PRIMARY KEY,
  value  INTEGER NOT NULL
) STRICT;

CREATE TABLE users (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL COLLATE NOCASE,
  role             TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
  pin_hash         TEXT NOT NULL,
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  failed_attempts  INTEGER NOT NULL DEFAULT 0,
  locked_until     TEXT,
  last_login_at    TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX ux_users_name ON users(name COLLATE NOCASE);

CREATE TABLE plans (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL COLLATE NOCASE,
  duration_value  INTEGER NOT NULL CHECK (duration_value > 0),
  duration_unit   TEXT NOT NULL CHECK (duration_unit IN ('day', 'month')),
  price           INTEGER NOT NULL CHECK (price >= 0),
  description     TEXT,
  color           TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT
) STRICT;

CREATE TABLE members (
  id               TEXT PRIMARY KEY,
  member_code      TEXT NOT NULL COLLATE NOCASE,
  full_name        TEXT NOT NULL,
  father_name      TEXT,
  gender           TEXT NOT NULL CHECK (gender IN ('male', 'female', 'other')),
  date_of_birth    TEXT,
  phone            TEXT NOT NULL,
  whatsapp         TEXT,
  cnic             TEXT,
  email            TEXT,
  address          TEXT,
  area             TEXT,
  occupation       TEXT,
  blood_group      TEXT,
  emergency_name   TEXT,
  emergency_phone  TEXT,
  medical_notes    TEXT,
  notes            TEXT,
  timing           TEXT,
  source           TEXT,
  join_date        TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at      TEXT,
  archive_reason   TEXT,
  photo_version    INTEGER NOT NULL DEFAULT 0,
  created_by       TEXT REFERENCES users(id),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT
) STRICT;
CREATE UNIQUE INDEX ux_members_code ON members(member_code COLLATE NOCASE);
CREATE UNIQUE INDEX ux_members_cnic ON members(cnic) WHERE cnic IS NOT NULL;
CREATE INDEX ix_members_name ON members(full_name COLLATE NOCASE);
CREATE INDEX ix_members_phone ON members(phone);
CREATE INDEX ix_members_status ON members(status);

CREATE TABLE member_photos (
  member_id   TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  photo       BLOB NOT NULL,
  thumb       BLOB NOT NULL,
  mime        TEXT NOT NULL DEFAULT 'image/jpeg',
  updated_at  TEXT NOT NULL
) STRICT;

CREATE TABLE subscriptions (
  id              TEXT PRIMARY KEY,
  member_id       TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  plan_id         TEXT REFERENCES plans(id) ON DELETE RESTRICT,
  plan_name       TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('new', 'renewal', 'migrated')),
  start_date      TEXT NOT NULL,
  end_date        TEXT NOT NULL,
  base_end_date   TEXT NOT NULL,
  freeze_days     INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  created_by      TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  cancelled_at    TEXT,
  cancelled_by    TEXT REFERENCES users(id),
  cancel_reason   TEXT,
  CHECK (end_date >= start_date)
) STRICT;
CREATE INDEX ix_subs_member_end ON subscriptions(member_id, end_date);
CREATE INDEX ix_subs_end ON subscriptions(end_date);
CREATE INDEX ix_subs_start ON subscriptions(start_date);
CREATE INDEX ix_subs_plan ON subscriptions(plan_id);

CREATE TABLE freezes (
  id               TEXT PRIMARY KEY,
  member_id        TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  subscription_id  TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
  start_date       TEXT NOT NULL,
  end_date         TEXT NOT NULL,
  days             INTEGER NOT NULL CHECK (days >= 0),
  reason           TEXT,
  created_by       TEXT REFERENCES users(id),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  cancelled_at     TEXT,
  cancelled_by     TEXT REFERENCES users(id)
) STRICT;
CREATE INDEX ix_freezes_member ON freezes(member_id, start_date);

CREATE TABLE charges (
  id               TEXT PRIMARY KEY,
  member_id        TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  subscription_id  TEXT REFERENCES subscriptions(id) ON DELETE RESTRICT,
  kind             TEXT NOT NULL CHECK (kind IN ('membership', 'admission', 'training', 'locker', 'product', 'fine', 'other')),
  description      TEXT NOT NULL,
  amount           INTEGER NOT NULL CHECK (amount >= 0),
  discount         INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0 AND discount <= amount),
  net_amount       INTEGER GENERATED ALWAYS AS (amount - discount) STORED,
  charge_date      TEXT NOT NULL,
  created_by       TEXT REFERENCES users(id),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  voided_at        TEXT,
  voided_by        TEXT REFERENCES users(id),
  void_reason      TEXT
) STRICT;
CREATE INDEX ix_charges_member ON charges(member_id, charge_date);
CREATE INDEX ix_charges_date ON charges(charge_date);
CREATE INDEX ix_charges_sub ON charges(subscription_id);

CREATE TABLE payments (
  id               TEXT PRIMARY KEY,
  receipt_no       TEXT NOT NULL,
  member_id        TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  subscription_id  TEXT REFERENCES subscriptions(id) ON DELETE RESTRICT,
  amount           INTEGER NOT NULL CHECK (amount > 0),
  method           TEXT NOT NULL,
  reference        TEXT,
  note             TEXT,
  paid_at          TEXT NOT NULL,
  paid_on          TEXT GENERATED ALWAYS AS (substr(paid_at, 1, 10)) STORED,
  items_json       TEXT,
  balance_before   INTEGER NOT NULL,
  balance_after    INTEGER NOT NULL,
  received_by      TEXT REFERENCES users(id),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  voided_at        TEXT,
  voided_by        TEXT REFERENCES users(id),
  void_reason      TEXT
) STRICT;
CREATE UNIQUE INDEX ux_payments_receipt ON payments(receipt_no);
CREATE INDEX ix_payments_member ON payments(member_id, paid_at);
CREATE INDEX ix_payments_paid_on ON payments(paid_on);
CREATE INDEX ix_payments_paid_at ON payments(paid_at);

-- High-volume, append-only: compact integer key (no UUID) keeps the table and its indexes small.
CREATE TABLE attendance (
  id             INTEGER PRIMARY KEY,
  member_id      TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  checked_in_at  TEXT NOT NULL,
  method         TEXT NOT NULL DEFAULT 'manual' CHECK (method IN ('manual', 'scan')),
  created_by     TEXT REFERENCES users(id)
) STRICT;
CREATE INDEX ix_attendance_member ON attendance(member_id, checked_in_at);
CREATE INDEX ix_attendance_at ON attendance(checked_in_at);

CREATE TABLE expense_categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL COLLATE NOCASE,
  color       TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX ux_expense_categories_name ON expense_categories(name COLLATE NOCASE);

CREATE TABLE expenses (
  id             TEXT PRIMARY KEY,
  category_id    TEXT NOT NULL REFERENCES expense_categories(id) ON DELETE RESTRICT,
  amount         INTEGER NOT NULL CHECK (amount > 0),
  expense_date   TEXT NOT NULL,
  method         TEXT NOT NULL,
  payee          TEXT,
  description    TEXT,
  created_by     TEXT REFERENCES users(id),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,
  deleted_by     TEXT REFERENCES users(id),
  delete_reason  TEXT
) STRICT;
CREATE INDEX ix_expenses_date ON expenses(expense_date);
CREATE INDEX ix_expenses_category ON expenses(category_id);

CREATE TABLE measurements (
  id            TEXT PRIMARY KEY,
  member_id     TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  measured_on   TEXT NOT NULL,
  weight_kg     REAL,
  height_cm     REAL,
  body_fat_pct  REAL,
  chest_cm      REAL,
  waist_cm      REAL,
  hips_cm       REAL,
  arm_cm        REAL,
  thigh_cm      REAL,
  notes         TEXT,
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
) STRICT;
CREATE INDEX ix_measurements_member ON measurements(member_id, measured_on);

CREATE TABLE message_log (
  id          TEXT PRIMARY KEY,
  member_id   TEXT REFERENCES members(id) ON DELETE CASCADE,
  template    TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'whatsapp',
  phone       TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL
) STRICT;
CREATE INDEX ix_message_log_member ON message_log(member_id, created_at);
CREATE INDEX ix_message_log_created ON message_log(created_at);

CREATE TABLE audit_log (
  id         TEXT PRIMARY KEY,
  at         TEXT NOT NULL,
  user_id    TEXT,
  user_name  TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  summary    TEXT NOT NULL,
  details    TEXT
) STRICT;
CREATE INDEX ix_audit_at ON audit_log(at);
CREATE INDEX ix_audit_entity ON audit_log(entity, entity_id);

-- Derived per-member summary. Recomputed from source tables; never edited by hand.
CREATE TABLE member_stats (
  member_id        TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  last_sub_id      TEXT,
  plan_id          TEXT,
  plan_name        TEXT,
  start_date       TEXT,
  end_date         TEXT,
  freeze_start     TEXT,
  freeze_end       TEXT,
  balance          INTEGER NOT NULL DEFAULT 0,
  total_charged    INTEGER NOT NULL DEFAULT 0,
  total_paid       INTEGER NOT NULL DEFAULT 0,
  last_payment_at  TEXT,
  last_visit_at    TEXT,
  visit_count      INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX ix_member_stats_end ON member_stats(end_date);
CREATE INDEX ix_member_stats_balance ON member_stats(balance);

-- Integrity guards ---------------------------------------------------------
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE TRIGGER trg_payments_no_delete BEFORE DELETE ON payments
BEGIN SELECT RAISE(ABORT, 'payments cannot be deleted; void them instead'); END;

CREATE TRIGGER trg_payments_amount_locked BEFORE UPDATE OF amount, member_id, receipt_no ON payments
BEGIN SELECT RAISE(ABORT, 'payment amount, member and receipt number cannot be changed; void and re-enter'); END;

CREATE TRIGGER trg_charges_no_delete BEFORE DELETE ON charges
BEGIN SELECT RAISE(ABORT, 'charges cannot be deleted; void them instead'); END;
