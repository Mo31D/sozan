-- V6.3: lightweight schedule planning state for fast mobile rescheduling.
-- Existing schedules stay confirmed. A pending schedule keeps its last known
-- day/time as reference, but it must not create live occurrences until confirmed.

ALTER TABLE recurring_sessions_v3 ADD COLUMN schedule_status TEXT NOT NULL DEFAULT 'confirmed';

CREATE INDEX IF NOT EXISTS idx_sessions_v3_planning
ON recurring_sessions_v3(active, schedule_status, weekday);

CREATE TRIGGER IF NOT EXISTS trg_skip_pending_occurrence
BEFORE INSERT ON session_occurrences_v3
WHEN EXISTS (
  SELECT 1 FROM recurring_sessions_v3 r
  WHERE r.id = NEW.recurring_session_id
    AND r.schedule_status = 'pending'
)
BEGIN
  SELECT RAISE(IGNORE);
END;
