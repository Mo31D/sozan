PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS package_opening_progress_v7 (
  student_id INTEGER PRIMARY KEY,
  cycle_id INTEGER NOT NULL UNIQUE,
  shadow_session_id INTEGER NOT NULL UNIQUE,
  cycle_start_date TEXT NOT NULL,
  opening_completed INTEGER NOT NULL DEFAULT 0 CHECK(opening_completed BETWEEN 0 AND 100),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(student_id) REFERENCES students_v3(id) ON DELETE CASCADE,
  FOREIGN KEY(cycle_id) REFERENCES package_cycles_v6(id) ON DELETE CASCADE,
  FOREIGN KEY(shadow_session_id) REFERENCES recurring_sessions_v3(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_package_opening_cycle_v7 ON package_opening_progress_v7(cycle_id);
