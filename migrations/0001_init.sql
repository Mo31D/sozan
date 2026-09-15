PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS recurring_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  session_type TEXT NOT NULL CHECK (session_type IN ('private_home','private_out','online','center_group','own_group')),
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes > 0),
  gross_amount_pence INTEGER NOT NULL DEFAULT 0 CHECK (gross_amount_pence >= 0),
  center_cut_percent REAL NOT NULL DEFAULT 0 CHECK (center_cut_percent >= 0 AND center_cut_percent <= 100),
  travel_minutes INTEGER NOT NULL DEFAULT 0 CHECK (travel_minutes >= 0),
  student_count INTEGER NOT NULL DEFAULT 1 CHECK (student_count > 0),
  age_band TEXT,
  level TEXT,
  location TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS session_occurrences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recurring_session_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled')),
  paid INTEGER NOT NULL DEFAULT 0 CHECK (paid IN (0,1)),
  gross_amount_pence INTEGER NOT NULL DEFAULT 0,
  center_cut_pence INTEGER NOT NULL DEFAULT 0,
  net_amount_pence INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(recurring_session_id, date),
  FOREIGN KEY (recurring_session_id) REFERENCES recurring_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  scope TEXT NOT NULL DEFAULT 'business' CHECK (scope IN ('business','personal','na')),
  category TEXT NOT NULL DEFAULT 'other',
  amount_pence INTEGER NOT NULL CHECK (amount_pence >= 0),
  source TEXT NOT NULL DEFAULT 'manual',
  note TEXT,
  occurrence_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (occurrence_id) REFERENCES session_occurrences(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_occurrences_date ON session_occurrences(date);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_occurrence ON transactions(occurrence_id);

CREATE TABLE IF NOT EXISTS voice_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transcript TEXT NOT NULL,
  parsed_json TEXT NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 0 CHECK (confirmed IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO settings(key, value) VALUES ('currency_label', 'جنيه');
INSERT OR IGNORE INTO settings(key, value) VALUES ('savings_target_percent', '10');
