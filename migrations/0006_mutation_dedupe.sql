CREATE TABLE IF NOT EXISTS mutation_dedupe_v1 (
  dedupe_key TEXT PRIMARY KEY,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done')),
  response_status INTEGER,
  response_body TEXT,
  content_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_mutation_dedupe_created_at
ON mutation_dedupe_v1(created_at);
