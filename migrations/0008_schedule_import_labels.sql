PRAGMA foreign_keys = ON;

UPDATE recurring_sessions_v3
SET start_time='غير محدد', updated_at=CURRENT_TIMESTAMP
WHERE start_time=''
  AND location LIKE 'مستورد من جدول سوزان الورقي%';

INSERT INTO activity_events_v4(entity_type,entity_id,action,title,detail,undoable)
SELECT 'settings',NULL,'imported','تم استيراد جدول سوزان الورقي','27 موعدًا؛ المواعيد غير المكتوبة ظاهرة كـ «غير محدد» ويمكن تعديلها لاحقًا',0
WHERE NOT EXISTS (
  SELECT 1 FROM activity_events_v4
  WHERE entity_type='settings' AND action='imported' AND title='تم استيراد جدول سوزان الورقي'
);
