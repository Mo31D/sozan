PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS students_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  age INTEGER,
  level TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recurring_sessions_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER,
  title TEXT NOT NULL,
  session_type TEXT NOT NULL CHECK (session_type IN ('private_student_home','private_sozan_home','online','center_group','own_group')),
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes > 0),
  price_type TEXT NOT NULL DEFAULT 'per_session' CHECK (price_type IN ('per_session','monthly')),
  price_basis TEXT NOT NULL DEFAULT 'total_session' CHECK (price_basis IN ('total_session','per_student')),
  price_pence INTEGER NOT NULL DEFAULT 0 CHECK (price_pence >= 0),
  student_count INTEGER NOT NULL DEFAULT 1 CHECK (student_count > 0),
  center_cut_percent REAL NOT NULL DEFAULT 0 CHECK (center_cut_percent >= 0 AND center_cut_percent <= 100),
  travel_minutes INTEGER NOT NULL DEFAULT 0 CHECK (travel_minutes >= 0),
  location TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES students_v3(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS session_occurrences_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recurring_session_id INTEGER NOT NULL,
  session_date TEXT NOT NULL,
  scheduled_start TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled','missed')),
  gross_pence INTEGER NOT NULL DEFAULT 0 CHECK (gross_pence >= 0),
  center_cut_pence INTEGER NOT NULL DEFAULT 0 CHECK (center_cut_pence >= 0),
  earned_pence INTEGER NOT NULL DEFAULT 0 CHECK (earned_pence >= 0),
  completed_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(recurring_session_id, session_date),
  FOREIGN KEY (recurring_session_id) REFERENCES recurring_sessions_v3(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurrence_id INTEGER NOT NULL,
  amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
  paid_at TEXT NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','bank','wallet','other')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (occurrence_id) REFERENCES session_occurrences_v3(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS expenses_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_date TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('business','personal')),
  category TEXT NOT NULL,
  amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS other_income_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  income_date TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('course','extra_group','materials','bonus','other')),
  amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cash_checks_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  check_date TEXT NOT NULL,
  expected_balance_pence INTEGER NOT NULL,
  actual_balance_pence INTEGER NOT NULL,
  difference_pence INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings_v3 (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO settings_v3(key,value) VALUES ('currency_label','ج');
INSERT OR IGNORE INTO settings_v3(key,value) VALUES ('opening_balance_pence','0');
INSERT OR IGNORE INTO settings_v3(key,value) VALUES ('sozan_display_name','سوزان');
INSERT OR IGNORE INTO settings_v3(key,value) VALUES ('cash_check_frequency_days','7');

CREATE INDEX IF NOT EXISTS idx_students_v3_active ON students_v3(active);
CREATE INDEX IF NOT EXISTS idx_sessions_v3_weekday ON recurring_sessions_v3(weekday,active);
CREATE INDEX IF NOT EXISTS idx_occurrences_v3_date ON session_occurrences_v3(session_date);
CREATE INDEX IF NOT EXISTS idx_occurrences_v3_status ON session_occurrences_v3(status);
CREATE INDEX IF NOT EXISTS idx_payments_v3_occurrence ON payments_v3(occurrence_id);
CREATE INDEX IF NOT EXISTS idx_payments_v3_date ON payments_v3(paid_at);
CREATE INDEX IF NOT EXISTS idx_expenses_v3_date ON expenses_v3(expense_date);
CREATE INDEX IF NOT EXISTS idx_other_income_v3_date ON other_income_v3(income_date);
CREATE INDEX IF NOT EXISTS idx_cash_checks_v3_date ON cash_checks_v3(check_date);