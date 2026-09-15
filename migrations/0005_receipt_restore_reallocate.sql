PRAGMA foreign_keys = ON;

-- Rebuild a restored receipt against the student's CURRENT outstanding balance.
-- This prevents stale allocations if the receipt was deleted, other payments happened,
-- and the receipt was later restored.
CREATE TRIGGER IF NOT EXISTS trg_receipt_restore_reallocate_v4
AFTER UPDATE OF deleted_at ON student_receipts_v4
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  DELETE FROM receipt_allocations_v4 WHERE receipt_id = NEW.id;

  INSERT INTO receipt_allocations_v4(receipt_id, occurrence_id, amount_pence)
  SELECT NEW.id, id, MIN(due, MAX(0, NEW.amount_pence - prev_due))
  FROM (
    SELECT id, due,
      COALESCE(
        SUM(due) OVER (
          ORDER BY effective_date, id
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0
      ) AS prev_due
    FROM (
      SELECT
        o.id,
        COALESCE(o.rescheduled_to_date, o.session_date) AS effective_date,
        MAX(
          0,
          o.earned_pence
          - COALESCE((
              SELECT SUM(p.amount_pence)
              FROM payments_v3 p
              WHERE p.occurrence_id=o.id AND p.reversed_at IS NULL
            ),0)
          - COALESCE((
              SELECT SUM(a.amount_pence)
              FROM receipt_allocations_v4 a
              JOIN student_receipts_v4 rr ON rr.id=a.receipt_id
              WHERE a.occurrence_id=o.id
                AND rr.deleted_at IS NULL
                AND rr.id<>NEW.id
            ),0)
        ) AS due
      FROM session_occurrences_v3 o
      JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id
      WHERE r.student_id=NEW.student_id
        AND o.status='completed'
    )
  )
  WHERE due > 0
    AND NEW.amount_pence - prev_due > 0;
END;
