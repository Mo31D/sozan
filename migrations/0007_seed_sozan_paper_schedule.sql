PRAGMA foreign_keys = ON;

-- Sozan paper schedule import. Only written times are populated.
-- Blank start_time means the paper did not specify a time yet.
-- price_pence remains 0 until Sozan completes the financial details.

-- Student / family accounts used by the schedule.
INSERT INTO students_v3(name)
SELECT 'ياسين وحور' WHERE NOT EXISTS (SELECT 1 FROM students_v3 WHERE active=1 AND deleted_at IS NULL AND name='ياسين وحور');
INSERT INTO students_v3(name)
SELECT 'جيسي' WHERE NOT EXISTS (SELECT 1 FROM students_v3 WHERE active=1 AND deleted_at IS NULL AND name='جيسي');
INSERT INTO students_v3(name)
SELECT 'أنس' WHERE NOT EXISTS (SELECT 1 FROM students_v3 WHERE active=1 AND deleted_at IS NULL AND name='أنس');
INSERT INTO students_v3(name)
SELECT 'ريناد' WHERE NOT EXISTS (SELECT 1 FROM students_v3 WHERE active=1 AND deleted_at IS NULL AND name='ريناد');
INSERT INTO students_v3(name)
SELECT 'لين' WHERE NOT EXISTS (SELECT 1 FROM students_v3 WHERE active=1 AND deleted_at IS NULL AND name='لين');
INSERT INTO students_v3(name)
SELECT 'أروى' WHERE NOT EXISTS (SELECT 1 FROM students_v3 WHERE active=1 AND deleted_at IS NULL AND name='أروى');
INSERT INTO students_v3(name)
SELECT 'فريدة' WHERE NOT EXISTS (SELECT 1 FROM students_v3 WHERE active=1 AND deleted_at IS NULL AND name='فريدة');
INSERT INTO students_v3(name)
SELECT 'يحيى وآدم' WHERE NOT EXISTS (SELECT 1 FROM students_v3 WHERE active=1 AND deleted_at IS NULL AND name='يحيى وآدم');
INSERT INTO students_v3(name)
SELECT 'نور' WHERE NOT EXISTS (SELECT 1 FROM students_v3 WHERE active=1 AND deleted_at IS NULL AND name='نور');
INSERT INTO students_v3(name)
SELECT 'يحيى' WHERE NOT EXISTS (SELECT 1 FROM students_v3 WHERE active=1 AND deleted_at IS NULL AND name='يحيى');
INSERT INTO students_v3(name)
SELECT 'ملك' WHERE NOT EXISTS (SELECT 1 FROM students_v3 WHERE active=1 AND deleted_at IS NULL AND name='ملك');
INSERT INTO students_v3(name)
SELECT 'سادن' WHERE NOT EXISTS (SELECT 1 FROM students_v3 WHERE active=1 AND deleted_at IS NULL AND name='سادن');

-- Saturday (6)
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,location)
SELECT s.id,'ياسين وحور','online',6,'11:30',60,0,2,'مستورد من جدول سوزان الورقي' FROM students_v3 s
WHERE s.name='ياسين وحور' AND s.active=1 AND s.deleted_at IS NULL
AND NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='ياسين وحور' AND r.weekday=6);
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,location)
SELECT s.id,'جيسي','private_student_home',6,'16:00',90,0,1,'مستورد من جدول سوزان الورقي؛ نوع الحصة يحتاج مراجعة' FROM students_v3 s
WHERE s.name='جيسي' AND s.active=1 AND s.deleted_at IS NULL
AND NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='جيسي' AND r.weekday=6);
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,location)
SELECT s.id,'أنس','private_student_home',6,'18:00',90,0,1,'مستورد من جدول سوزان الورقي؛ نوع الحصة يحتاج مراجعة' FROM students_v3 s
WHERE s.name='أنس' AND s.active=1 AND s.deleted_at IS NULL
AND NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='أنس' AND r.weekday=6);
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,location)
SELECT s.id,'ريناد','online',6,'',60,0,1,'مستورد من جدول سوزان الورقي؛ الوقت والمدة يحتاجان مراجعة' FROM students_v3 s
WHERE s.name='ريناد' AND s.active=1 AND s.deleted_at IS NULL
AND NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='ريناد' AND r.weekday=6);

-- Sunday (0)
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,location)
SELECT s.id,'لين','private_student_home',0,'11:30',60,0,1,'مستورد من جدول سوزان الورقي؛ مدة الحصة ونوعها يحتاجان مراجعة' FROM students_v3 s
WHERE s.name='لين' AND s.active=1 AND s.deleted_at IS NULL
AND NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='لين' AND r.weekday=0);
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,location)
SELECT s.id,'أروى','private_student_home',0,'13:00',90,0,1,'مستورد من جدول سوزان الورقي؛ نوع الحصة يحتاج مراجعة' FROM students_v3 s
WHERE s.name='أروى' AND s.active=1 AND s.deleted_at IS NULL
AND NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='أروى' AND r.weekday=0);
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,location)
SELECT s.id,'فريدة','private_student_home',0,'16:00',60,0,1,'مستورد من جدول سوزان الورقي؛ نوع الحصة يحتاج مراجعة' FROM students_v3 s
WHERE s.name='فريدة' AND s.active=1 AND s.deleted_at IS NULL
AND NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='فريدة' AND r.weekday=0);
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,location)
SELECT s.id,'يحيى وآدم','own_group',0,'17:00',90,0,2,'مستورد من جدول سوزان الورقي؛ نوع الحصة يحتاج مراجعة' FROM students_v3 s
WHERE s.name='يحيى وآدم' AND s.active=1 AND s.deleted_at IS NULL
AND NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='يحيى وآدم' AND r.weekday=0);

-- Monday (1)
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,location)
SELECT s.id,'ياسين وحور','online',1,'11:30',60,0,2,'مستورد من جدول سوزان الورقي' FROM students_v3 s
WHERE s.name='ياسين وحور' AND s.active=1 AND s.deleted_at IS NULL
AND NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='ياسين وحور' AND r.weekday=1);
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,center_cut_percent,location)
SELECT NULL,'السنتر','center_group',1,'15:00',60,0,1,0,'مستورد من جدول سوزان الورقي؛ السعر ونسبة السنتر يحتاجان مراجعة'
WHERE NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='السنتر' AND r.weekday=1);
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,location)
SELECT s.id,'نور','private_student_home',1,'16:00',90,0,1,'مستورد من جدول سوزان الورقي؛ نوع الحصة يحتاج مراجعة' FROM students_v3 s
WHERE s.name='نور' AND s.active=1 AND s.deleted_at IS NULL
AND NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='نور' AND r.weekday=1);
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,location)
SELECT s.id,'يحيى','private_student_home',1,'18:00',90,0,1,'مستورد من جدول سوزان الورقي؛ نوع الحصة يحتاج مراجعة' FROM students_v3 s
WHERE s.name='يحيى' AND s.active=1 AND s.deleted_at IS NULL
AND NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='يحيى' AND r.weekday=1);
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,location)
SELECT s.id,'ملك','online',1,'',60,0,1,'مستورد من جدول سوزان الورقي؛ الوقت والمدة يحتاجان مراجعة' FROM students_v3 s
WHERE s.name='ملك' AND s.active=1 AND s.deleted_at IS NULL
AND NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='ملك' AND r.weekday=1);

-- Tuesday (2)
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,location)
SELECT s.id,'سادن','online',2,'09:00',120,0,1,'مستورد من جدول سوزان الورقي' FROM students_v3 s
WHERE s.name='سادن' AND s.active=1 AND s.deleted_at IS NULL
AND NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='سادن' AND r.weekday=2);
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,location)
SELECT s.id,'أروى','private_student_home',2,'15:00',90,0,1,'مستورد من جدول سوزان الورقي؛ نوع الحصة يحتاج مراجعة' FROM students_v3 s
WHERE s.name='أروى' AND s.active=1 AND s.deleted_at IS NULL
AND NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='أروى' AND r.weekday=2);
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,location)
SELECT s.id,'جيسي','private_student_home',2,'16:00',90,0,1,'مستورد من جدول سوزان الورقي؛ نوع الحصة يحتاج مراجعة' FROM students_v3 s
WHERE s.name='جيسي' AND s.active=1 AND s.deleted_at IS NULL
AND NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='جيسي' AND r.weekday=2);
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,location)
SELECT s.id,'أنس','private_student_home',2,'18:00',90,0,1,'مستورد من جدول سوزان الورقي؛ نوع الحصة يحتاج مراجعة' FROM students_v3 s
WHERE s.name='أنس' AND s.active=1 AND s.deleted_at IS NULL
AND NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='أنس' AND r.weekday=2);
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,location)
SELECT s.id,'ريناد','online',2,'',60,0,1,'مستورد من جدول سوزان الورقي؛ الوقت والمدة يحتاجان مراجعة' FROM students_v3 s
WHERE s.name='ريناد' AND s.active=1 AND s.deleted_at IS NULL
AND NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='ريناد' AND r.weekday=2);

-- Wednesday (3) - the paper/user confirmation has names but no times.
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,location)
SELECT s.id,'لين','private_student_home',3,'',60,0,1,'مستورد من جدول سوزان الورقي؛ الوقت والمدة ونوع الحصة يحتاجون مراجعة' FROM students_v3 s
WHERE s.name='لين' AND s.active=1 AND s.deleted_at IS NULL
AND NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='لين' AND r.weekday=3);
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,location)
SELECT s.id,'أروى','private_student_home',3,'',60,0,1,'مستورد من جدول سوزان الورقي؛ الوقت والمدة ونوع الحصة يحتاجون مراجعة' FROM students_v3 s
WHERE s.name='أروى' AND s.active=1 AND s.deleted_at IS NULL
AND NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='أروى' AND r.weekday=3);
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,location)
SELECT s.id,'فريدة','private_student_home',3,'',60,0,1,'مستورد من جدول سوزان الورقي؛ الوقت والمدة ونوع الحصة يحتاجون مراجعة' FROM students_v3 s
WHERE s.name='فريدة' AND s.active=1 AND s.deleted_at IS NULL
AND NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='فريدة' AND r.weekday=3);
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,location)
SELECT s.id,'يحيى وآدم','own_group',3,'',60,0,2,'مستورد من جدول سوزان الورقي؛ الوقت والمدة ونوع الحصة يحتاجون مراجعة' FROM students_v3 s
WHERE s.name='يحيى وآدم' AND s.active=1 AND s.deleted_at IS NULL
AND NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='يحيى وآدم' AND r.weekday=3);
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,location)
SELECT s.id,'ملك','online',3,'',60,0,1,'مستورد من جدول سوزان الورقي؛ الوقت والمدة يحتاجان مراجعة' FROM students_v3 s
WHERE s.name='ملك' AND s.active=1 AND s.deleted_at IS NULL
AND NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='ملك' AND r.weekday=3);

-- Thursday (4)
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,location)
SELECT s.id,'سادن','online',4,'09:00',120,0,1,'مستورد من جدول سوزان الورقي' FROM students_v3 s
WHERE s.name='سادن' AND s.active=1 AND s.deleted_at IS NULL
AND NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='سادن' AND r.weekday=4);
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,center_cut_percent,location)
SELECT NULL,'السنتر','center_group',4,'',60,0,1,0,'مستورد من جدول سوزان الورقي؛ الوقت والمدة والسعر ونسبة السنتر يحتاجون مراجعة'
WHERE NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='السنتر' AND r.weekday=4);
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,location)
SELECT s.id,'نور','private_student_home',4,'',60,0,1,'مستورد من جدول سوزان الورقي؛ الوقت والمدة ونوع الحصة يحتاجون مراجعة' FROM students_v3 s
WHERE s.name='نور' AND s.active=1 AND s.deleted_at IS NULL
AND NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='نور' AND r.weekday=4);
INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_pence,student_count,location)
SELECT s.id,'يحيى وآدم','own_group',4,'',60,0,2,'مستورد من جدول سوزان الورقي؛ الوقت والمدة ونوع الحصة يحتاجون مراجعة' FROM students_v3 s
WHERE s.name='يحيى وآدم' AND s.active=1 AND s.deleted_at IS NULL
AND NOT EXISTS (SELECT 1 FROM recurring_sessions_v3 r WHERE r.active=1 AND r.title='يحيى وآدم' AND r.weekday=4);
