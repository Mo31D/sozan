PRAGMA foreign_keys = ON;

ALTER TABLE session_occurrences_v3 ADD COLUMN rescheduled_to_date TEXT;
ALTER TABLE session_occurrences_v3 ADD COLUMN rescheduled_to_start TEXT;
ALTER TABLE session_occurrences_v3 ADD COLUMN rescheduled_at TEXT;
ALTER TABLE session_occurrences_v3 ADD COLUMN reschedule_note TEXT;

ALTER TABLE payments_v3 ADD COLUMN reversed_at TEXT;
ALTER TABLE payments_v3 ADD COLUMN reversal_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_occurrences_v3_rescheduled_date
ON session_occurrences_v3(rescheduled_to_date);

CREATE INDEX IF NOT EXISTS idx_payments_v3_active
ON payments_v3(occurrence_id, reversed_at);
