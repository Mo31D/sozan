PRAGMA foreign_keys = ON;

ALTER TABLE recurring_sessions_v3 ADD COLUMN billing_start_month TEXT;
ALTER TABLE recurring_sessions_v3 ADD COLUMN billing_end_month TEXT;
ALTER TABLE recurring_sessions_v3 ADD COLUMN billing_day INTEGER NOT NULL DEFAULT 1;

UPDATE recurring_sessions_v3
SET billing_start_month = strftime('%Y-%m','now')
WHERE price_type='monthly' AND billing_start_month IS NULL;

CREATE TABLE IF NOT EXISTS monthly_dues_v5 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_key TEXT NOT NULL,
  student_id INTEGER,
  source_session_id INTEGER,
  title TEXT NOT NULL,
  session_type TEXT,
  month TEXT NOT NULL,
  due_date TEXT NOT NULL,
  amount_pence INTEGER NOT NULL DEFAULT 0 CHECK (amount_pence >= 0),
  adjustment_pence INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_key, month),
  FOREIGN KEY (student_id) REFERENCES students_v3(id) ON DELETE SET NULL,
  FOREIGN KEY (source_session_id) REFERENCES recurring_sessions_v3(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS monthly_due_allocations_v5 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id INTEGER NOT NULL,
  monthly_due_id INTEGER NOT NULL,
  amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (receipt_id) REFERENCES student_receipts_v4(id) ON DELETE CASCADE,
  FOREIGN KEY (monthly_due_id) REFERENCES monthly_dues_v5(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_monthly_dues_v5_student ON monthly_dues_v5(student_id, month);
CREATE INDEX IF NOT EXISTS idx_monthly_dues_v5_month ON monthly_dues_v5(month, due_date);
CREATE INDEX IF NOT EXISTS idx_monthly_alloc_v5_receipt ON monthly_due_allocations_v5(receipt_id);
CREATE INDEX IF NOT EXISTS idx_monthly_alloc_v5_due ON monthly_due_allocations_v5(monthly_due_id);
