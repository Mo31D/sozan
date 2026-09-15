PRAGMA foreign_keys = ON;

ALTER TABLE students_v3 ADD COLUMN guardian_name TEXT;
ALTER TABLE students_v3 ADD COLUMN guardian_phone TEXT;
ALTER TABLE students_v3 ADD COLUMN deleted_at TEXT;
ALTER TABLE expenses_v3 ADD COLUMN deleted_at TEXT;
ALTER TABLE other_income_v3 ADD COLUMN deleted_at TEXT;

CREATE TABLE IF NOT EXISTS student_receipts_v4 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
  received_at TEXT NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','bank','wallet','other')),
  note TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES students_v3(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS receipt_allocations_v4 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id INTEGER NOT NULL,
  occurrence_id INTEGER NOT NULL,
  amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (receipt_id) REFERENCES student_receipts_v4(id) ON DELETE CASCADE,
  FOREIGN KEY (occurrence_id) REFERENCES session_occurrences_v3(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activity_events_v4 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('expense','other_income','receipt','student','session','occurrence','payment','settings')),
  entity_id INTEGER,
  action TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  before_json TEXT,
  after_json TEXT,
  undoable INTEGER NOT NULL DEFAULT 0 CHECK (undoable IN (0,1)),
  undone_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_receipts_v4_student ON student_receipts_v4(student_id, received_at);
CREATE INDEX IF NOT EXISTS idx_receipts_v4_active ON student_receipts_v4(deleted_at, received_at);
CREATE INDEX IF NOT EXISTS idx_allocations_v4_receipt ON receipt_allocations_v4(receipt_id);
CREATE INDEX IF NOT EXISTS idx_allocations_v4_occurrence ON receipt_allocations_v4(occurrence_id);
CREATE INDEX IF NOT EXISTS idx_activity_v4_created ON activity_events_v4(created_at, id);
CREATE INDEX IF NOT EXISTS idx_activity_v4_entity ON activity_events_v4(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_expenses_v3_deleted ON expenses_v3(deleted_at);
CREATE INDEX IF NOT EXISTS idx_income_v3_deleted ON other_income_v3(deleted_at);

INSERT INTO activity_events_v4(entity_type,entity_id,action,title,detail,undoable,created_at)
SELECT 'expense',e.id,'created','مصروف مسجل',e.category || ' · ' || printf('%.2f',e.amount_pence/100.0) || ' ج',0,e.created_at
FROM expenses_v3 e
WHERE NOT EXISTS (
  SELECT 1 FROM activity_events_v4 a WHERE a.entity_type='expense' AND a.entity_id=e.id
);

INSERT INTO activity_events_v4(entity_type,entity_id,action,title,detail,undoable,created_at)
SELECT 'other_income',i.id,'created','دخل آخر مسجل',i.category || ' · ' || printf('%.2f',i.amount_pence/100.0) || ' ج',0,i.created_at
FROM other_income_v3 i
WHERE NOT EXISTS (
  SELECT 1 FROM activity_events_v4 a WHERE a.entity_type='other_income' AND a.entity_id=i.id
);

INSERT INTO activity_events_v4(entity_type,entity_id,action,title,detail,undoable,created_at)
SELECT 'student',s.id,'created','طالب مسجل',s.name,0,s.created_at
FROM students_v3 s
WHERE NOT EXISTS (
  SELECT 1 FROM activity_events_v4 a WHERE a.entity_type='student' AND a.entity_id=s.id
);

INSERT INTO activity_events_v4(entity_type,entity_id,action,title,detail,undoable,created_at)
SELECT 'session',r.id,'created','حصة مسجلة',r.title || ' · ' || r.start_time,0,r.created_at
FROM recurring_sessions_v3 r
WHERE NOT EXISTS (
  SELECT 1 FROM activity_events_v4 a WHERE a.entity_type='session' AND a.entity_id=r.id
);

INSERT INTO activity_events_v4(entity_type,entity_id,action,title,detail,undoable,created_at)
SELECT 'occurrence',o.id,
  CASE o.status WHEN 'completed' THEN 'completed' WHEN 'cancelled' THEN 'cancelled' ELSE 'updated' END,
  CASE o.status WHEN 'completed' THEN 'حصة تمت' WHEN 'cancelled' THEN 'حصة اتلغت' ELSE 'تعديل حصة' END,
  r.title || ' · ' || COALESCE(o.rescheduled_to_date,o.session_date),0,o.updated_at
FROM session_occurrences_v3 o
JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id
WHERE o.status<>'scheduled'
  AND NOT EXISTS (
    SELECT 1 FROM activity_events_v4 a WHERE a.entity_type='occurrence' AND a.entity_id=o.id
  );

INSERT INTO activity_events_v4(entity_type,entity_id,action,title,detail,undoable,created_at)
SELECT 'payment',p.occurrence_id,'collected','تحصيل مسجل',r.title || ' · ' || printf('%.2f',p.amount_pence/100.0) || ' ج',0,p.created_at
FROM payments_v3 p
JOIN session_occurrences_v3 o ON o.id=p.occurrence_id
JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id
WHERE p.reversed_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM activity_events_v4 a WHERE a.entity_type='payment' AND a.entity_id=p.occurrence_id
  );
