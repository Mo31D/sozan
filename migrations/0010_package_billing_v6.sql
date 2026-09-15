PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS student_billing_v6 (
  student_id INTEGER PRIMARY KEY,
  billing_mode TEXT NOT NULL DEFAULT 'per_session' CHECK(billing_mode IN ('per_session','package')),
  package_size INTEGER NOT NULL DEFAULT 8 CHECK(package_size BETWEEN 1 AND 100),
  package_price_pence INTEGER NOT NULL DEFAULT 0 CHECK(package_price_pence >= 0),
  cycle_anchor_date TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(student_id) REFERENCES students_v3(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS package_cycles_v6 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  cycle_no INTEGER NOT NULL,
  package_size INTEGER NOT NULL CHECK(package_size BETWEEN 1 AND 100),
  package_price_pence INTEGER NOT NULL CHECK(package_price_pence >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','due','paid')),
  started_on TEXT,
  completed_on TEXT,
  paid_on TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(student_id, cycle_no),
  FOREIGN KEY(student_id) REFERENCES students_v3(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS package_cycle_occurrences_v6 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id INTEGER NOT NULL,
  occurrence_id INTEGER NOT NULL UNIQUE,
  position INTEGER NOT NULL CHECK(position > 0),
  earned_pence INTEGER NOT NULL DEFAULT 0 CHECK(earned_pence >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(cycle_id) REFERENCES package_cycles_v6(id) ON DELETE CASCADE,
  FOREIGN KEY(occurrence_id) REFERENCES session_occurrences_v3(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS package_receipt_allocations_v6 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id INTEGER NOT NULL,
  cycle_id INTEGER NOT NULL,
  amount_pence INTEGER NOT NULL CHECK(amount_pence > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(receipt_id) REFERENCES student_receipts_v4(id) ON DELETE CASCADE,
  FOREIGN KEY(cycle_id) REFERENCES package_cycles_v6(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_package_cycles_student_v6 ON package_cycles_v6(student_id,status,cycle_no);
CREATE INDEX IF NOT EXISTS idx_package_occ_cycle_v6 ON package_cycle_occurrences_v6(cycle_id,position);
CREATE INDEX IF NOT EXISTS idx_package_alloc_receipt_v6 ON package_receipt_allocations_v6(receipt_id);
CREATE INDEX IF NOT EXISTS idx_package_alloc_cycle_v6 ON package_receipt_allocations_v6(cycle_id);

-- Preserve the intent of schedules already marked "monthly", but do NOT convert
-- the recurring-session rows here. The V6 runtime first turns already-completed
-- monthly lessons into package progress (1/8, 2/8, ...), then converts the schedule.
-- This ordering prevents losing attendance recorded during the short monthly trial.
INSERT INTO student_billing_v6(student_id,billing_mode,package_size,package_price_pence,cycle_anchor_date)
SELECT r.student_id,'package',8,MAX(r.price_pence),
       COALESCE(MIN(r.billing_start_month) || '-01', date('now'))
FROM recurring_sessions_v3 r
WHERE r.active=1 AND r.student_id IS NOT NULL AND r.price_type='monthly'
GROUP BY r.student_id
ON CONFLICT(student_id) DO UPDATE SET
  billing_mode='package',
  package_size=8,
  package_price_pence=excluded.package_price_pence,
  cycle_anchor_date=MIN(student_billing_v6.cycle_anchor_date,excluded.cycle_anchor_date),
  updated_at=CURRENT_TIMESTAMP;

INSERT INTO student_billing_v6(student_id,billing_mode,package_size,package_price_pence,cycle_anchor_date)
SELECT s.id,'per_session',8,0,date('now')
FROM students_v3 s
WHERE s.active=1 AND s.deleted_at IS NULL
ON CONFLICT(student_id) DO NOTHING;
