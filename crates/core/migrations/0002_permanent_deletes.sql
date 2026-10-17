-- Owners (admins) can delete payments and charges permanently; every such delete is written to the activity log
-- by the app. The database still refuses these deletes unless the app holds the permit inside the same
-- transaction (see `db::with_delete_permit`), so a stray or raw DELETE keeps failing.

CREATE TABLE delete_permit (
  id     INTEGER PRIMARY KEY CHECK (id = 1),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1))
) STRICT;
INSERT INTO delete_permit (id, active) VALUES (1, 0);

DROP TRIGGER trg_payments_no_delete;
CREATE TRIGGER trg_payments_no_delete BEFORE DELETE ON payments
WHEN (SELECT active FROM delete_permit WHERE id = 1) = 0
BEGIN SELECT RAISE(ABORT, 'payments cannot be deleted; void them instead'); END;

DROP TRIGGER trg_charges_no_delete;
CREATE TRIGGER trg_charges_no_delete BEFORE DELETE ON charges
WHEN (SELECT active FROM delete_permit WHERE id = 1) = 0
BEGIN SELECT RAISE(ABORT, 'charges cannot be deleted; void them instead'); END;
