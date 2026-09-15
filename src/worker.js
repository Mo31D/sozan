const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

const BUSINESS_EXPENSE_CATEGORIES = new Set([
  'work_transport','books_printing','teaching_supplies','work_internet',
  'center_fees','study_materials','other_business'
]);
const PERSONAL_EXPENSE_CATEGORIES = new Set([
  'home','food','personal_transport','bills','children','commitments',
  'personal_shopping','health','other_personal'
]);
const OTHER_INCOME_CATEGORIES = new Set(['course','extra_group','materials','bonus','other']);
const SESSION_TYPES = new Set(['private_student_home','private_sozan_home','online','center_group','own_group']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
      if (path === '/api/health') return json({ ok:true, app:env.APP_NAME || 'Sozan Tutor OS', version:'4.1' });
      if (path === '/api/login' && request.method === 'POST') return handleLogin(request, env);
      if (path === '/api/logout' && request.method === 'POST') {
        return new Response(null, { status:204, headers:{'set-cookie':'sozan_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'} });
      }

      const auth = await requireAuth(request, env);
      if (auth) return auth;

      if (path === '/api/v4/reset-data' && request.method === 'POST') return resetAllData(request, env);
      if ((path === '/api/v3/dashboard' || path === '/api/v3/today' || path === '/api/v4/dashboard') && request.method === 'GET') return dashboard(url, env);

      if (path === '/api/v3/students' && request.method === 'GET') return listStudents(env);
      if (path === '/api/v3/students' && request.method === 'POST') return createStudent(request, env);
      if (/^\/api\/v3\/students\/\d+$/.test(path) && request.method === 'PATCH') return updateStudent(request, url, env);
      const studentAccount = path.match(/^\/api\/v4\/students\/(\d+)\/account$/);
      if (studentAccount && request.method === 'GET') return getStudentAccount(env, Number(studentAccount[1]));
      if (path === '/api/v4/students/summary' && request.method === 'GET') return listStudentSummaries(env);

      if (path === '/api/v3/sessions' && request.method === 'GET') return listSessions(env);
      if (path === '/api/v3/sessions' && request.method === 'POST') return createSession(request, env);
      if (/^\/api\/v3\/sessions\/\d+$/.test(path) && request.method === 'PATCH') return updateSession(request, url, env);
      if (/^\/api\/v3\/sessions\/\d+$/.test(path) && request.method === 'DELETE') return disableSession(url, env);

      const occurrenceGet = path.match(/^\/api\/v4\/occurrences\/(\d+)$/);
      if (occurrenceGet && request.method === 'GET') return getOccurrence(env, Number(occurrenceGet[1]));
      const occurrenceAction = path.match(/^\/api\/v3\/occurrences\/(\d+)\/(complete-paid|complete-unpaid|cancel|restore|reopen|collect)$/);
      if (occurrenceAction && request.method === 'POST') return handleOccurrenceAction(request, env, Number(occurrenceAction[1]), occurrenceAction[2]);
      const reschedule = path.match(/^\/api\/v3\/occurrences\/(\d+)\/reschedule$/);
      if (reschedule && request.method === 'POST') return rescheduleOccurrence(request, env, Number(reschedule[1]));
      const correct = path.match(/^\/api\/v3\/occurrences\/(\d+)\/correct-payment$/);
      if (correct && request.method === 'POST') return correctOccurrencePayment(request, env, Number(correct[1]));
      if (path === '/api/v3/outstanding' && request.method === 'GET') return listOutstanding(env);

      if (path === '/api/v4/receipts' && request.method === 'POST') return createReceipt(request, env);
      if (path === '/api/v4/receipts' && request.method === 'GET') return listReceipts(url, env);
      const receiptId = path.match(/^\/api\/v4\/receipts\/(\d+)$/);
      if (receiptId && request.method === 'GET') return getReceipt(env, Number(receiptId[1]));
      if (receiptId && request.method === 'PATCH') return updateReceipt(request, env, Number(receiptId[1]));
      if (receiptId && request.method === 'DELETE') return deleteReceipt(env, Number(receiptId[1]));

      if (path === '/api/v3/expenses' && request.method === 'GET') return listExpenses(url, env);
      if (path === '/api/v3/expenses' && request.method === 'POST') return createExpense(request, env);
      const expenseId = path.match(/^\/api\/v3\/expenses\/(\d+)$/);
      if (expenseId && request.method === 'GET') return getExpense(env, Number(expenseId[1]));
      if (expenseId && request.method === 'PATCH') return updateExpense(request, env, Number(expenseId[1]));
      if (expenseId && request.method === 'DELETE') return deleteExpense(env, Number(expenseId[1]));

      if (path === '/api/v3/other-income' && request.method === 'GET') return listOtherIncome(url, env);
      if (path === '/api/v3/other-income' && request.method === 'POST') return createOtherIncome(request, env);
      const incomeId = path.match(/^\/api\/v3\/other-income\/(\d+)$/);
      if (incomeId && request.method === 'GET') return getOtherIncome(env, Number(incomeId[1]));
      if (incomeId && request.method === 'PATCH') return updateOtherIncome(request, env, Number(incomeId[1]));
      if (incomeId && request.method === 'DELETE') return deleteOtherIncome(env, Number(incomeId[1]));

      if (path === '/api/v4/activity' && request.method === 'GET') return listActivity(url, env);
      if (path === '/api/v4/review' && request.method === 'GET') return reviewCenter(env);
      const restore = path.match(/^\/api\/v4\/restore\/(expense|other_income|receipt)\/(\d+)$/);
      if (restore && request.method === 'POST') return restoreEntity(env, restore[1], Number(restore[2]));

      if (path === '/api/v3/cash-check' && request.method === 'GET') return getCashCheck(env);
      if (path === '/api/v3/cash-check' && request.method === 'POST') return createCashCheck(request, env);
      if (path === '/api/v3/settings' && request.method === 'GET') return getSettings(env);
      if (path === '/api/v3/settings' && request.method === 'PATCH') return updateSettings(request, env);
      if (path === '/api/v3/insights' && request.method === 'GET') return getInsights(url, env);

      return json({ error:'Not found' }, 404);
    } catch (error) {
      console.error(error);
      return json({ error:'حدث خطأ غير متوقع', detail:String(error?.message || error) }, 500);
    }
  }
};

async function handleLogin(request, env) {
  if (!env.APP_PASSCODE || !env.SESSION_SECRET) return json({error:'الأمان غير مُعد.'},503);
  const body = await safeJson(request);
  if (!body?.passcode || !(await safeEqual(String(body.passcode), String(env.APP_PASSCODE)))) return json({error:'الرمز غير صحيح'},401);
  const exp = Math.floor(Date.now()/1000) + SESSION_MAX_AGE;
  const payload = btoa(JSON.stringify({exp}));
  const sig = await hmac(payload, env.SESSION_SECRET);
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return new Response(JSON.stringify({ok:true}), { status:200, headers:{...JSON_HEADERS,'set-cookie':`sozan_session=${toBase64Url(payload)}.${sig}; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=${SESSION_MAX_AGE}`} });
}
async function requireAuth(request, env) {
  if (!env.APP_PASSCODE || !env.SESSION_SECRET) return json({error:'التطبيق غير مؤمّن بعد.'},503);
  const match=(request.headers.get('cookie')||'').match(/(?:^|;\s*)sozan_session=([^;]+)/);
  if(!match)return json({error:'AUTH_REQUIRED'},401);
  const [payloadB64,sig]=match[1].split('.'); if(!payloadB64||!sig)return json({error:'AUTH_REQUIRED'},401);
  const payload=fromBase64Url(payloadB64),expected=await hmac(payload,env.SESSION_SECRET);
  if(!(await safeEqual(sig,expected)))return json({error:'AUTH_REQUIRED'},401);
  try{const data=JSON.parse(atob(payload));if(!data.exp||data.exp<Math.floor(Date.now()/1000))return json({error:'AUTH_REQUIRED'},401);}catch{return json({error:'AUTH_REQUIRED'},401)}
  return null;
}

async function resetAllData(request, env) {
  const body = await safeJson(request) || {};
  if (String(body.confirm || '').trim() !== 'امسح كل البيانات') return json({ error:'عبارة التأكيد غير مطابقة' }, 400);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM receipt_allocations_v4`),
    env.DB.prepare(`DELETE FROM student_receipts_v4`),
    env.DB.prepare(`DELETE FROM payments_v3`),
    env.DB.prepare(`DELETE FROM session_occurrences_v3`),
    env.DB.prepare(`DELETE FROM recurring_sessions_v3`),
    env.DB.prepare(`DELETE FROM students_v3`),
    env.DB.prepare(`DELETE FROM expenses_v3`),
    env.DB.prepare(`DELETE FROM other_income_v3`),
    env.DB.prepare(`DELETE FROM cash_checks_v3`),
    env.DB.prepare(`DELETE FROM activity_events_v4`),
    env.DB.prepare(`UPDATE settings_v3 SET value='0', updated_at=CURRENT_TIMESTAMP WHERE key='opening_balance_pence'`),
    env.DB.prepare(`DELETE FROM transactions`),
    env.DB.prepare(`DELETE FROM session_occurrences`),
    env.DB.prepare(`DELETE FROM recurring_sessions`)
  ]);
  return json({ ok:true, reset:true });
}

const paidExpr = alias => `(COALESCE((SELECT SUM(p.amount_pence) FROM payments_v3 p WHERE p.occurrence_id=${alias}.id AND p.reversed_at IS NULL),0) + COALESCE((SELECT SUM(a.amount_pence) FROM receipt_allocations_v4 a JOIN student_receipts_v4 rr ON rr.id=a.receipt_id WHERE a.occurrence_id=${alias}.id AND rr.deleted_at IS NULL),0))`;

async function dashboard(url, env) {
  const date=sanitizeDate(url.searchParams.get('date'))||todayISO();
  return json(await buildDashboardData(env.DB,date));
}
async function buildDashboardData(db,date){
  await ensureOccurrencesForDate(db,date);
  const month=date.slice(0,7);
  const sessions=await db.prepare(`
    SELECT o.id,o.session_date AS original_session_date,COALESCE(o.rescheduled_to_date,o.session_date) AS session_date,
      o.status,o.gross_pence,o.center_cut_pence,o.earned_pence,o.rescheduled_to_date,o.rescheduled_to_start,
      COALESCE(o.rescheduled_to_start,o.scheduled_start,r.start_time) start_time,
      r.id recurring_session_id,r.student_id,r.title,r.session_type,r.duration_minutes,r.travel_minutes,r.student_count,r.location,
      s.name student_name,s.guardian_name,
      ${paidExpr('o')} paid_pence
    FROM session_occurrences_v3 o
    JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id
    LEFT JOIN students_v3 s ON s.id=r.student_id
    WHERE COALESCE(o.rescheduled_to_date,o.session_date)=?1
    ORDER BY COALESCE(o.rescheduled_to_start,o.scheduled_start,r.start_time),o.id
  `).bind(date).all();
  const earned=await db.prepare(`SELECT COALESCE(SUM(earned_pence),0) value FROM session_occurrences_v3 WHERE substr(COALESCE(rescheduled_to_date,session_date),1,7)=?1 AND status='completed'`).bind(month).first();
  const direct=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) value FROM payments_v3 WHERE reversed_at IS NULL AND substr(paid_at,1,7)=?1`).bind(month).first();
  const receipts=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) value FROM student_receipts_v4 WHERE deleted_at IS NULL AND substr(received_at,1,7)=?1`).bind(month).first();
  const other=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) value FROM other_income_v3 WHERE deleted_at IS NULL AND substr(income_date,1,7)=?1`).bind(month).first();
  const expenses=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) total,COALESCE(SUM(CASE WHEN scope='business' THEN amount_pence ELSE 0 END),0) business,COALESCE(SUM(CASE WHEN scope='personal' THEN amount_pence ELSE 0 END),0) personal FROM expenses_v3 WHERE deleted_at IS NULL AND substr(expense_date,1,7)=?1`).bind(month).first();
  const outstanding=await db.prepare(`SELECT COALESCE(SUM(CASE WHEN o.status='completed' THEN MAX(0,o.earned_pence-${paidExpr('o')}) ELSE 0 END),0) value FROM session_occurrences_v3 o`).first();
  const time=await db.prepare(`SELECT COALESCE(SUM(r.duration_minutes),0) teaching_minutes,COALESCE(SUM(r.travel_minutes),0) travel_minutes FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE substr(COALESCE(o.rescheduled_to_date,o.session_date),1,7)=?1 AND o.status='completed'`).bind(month).first();
  const categories=await db.prepare(`SELECT scope,category,SUM(amount_pence) amount_pence FROM expenses_v3 WHERE deleted_at IS NULL AND substr(expense_date,1,7)=?1 GROUP BY scope,category ORDER BY amount_pence DESC`).bind(month).all();
  const received=Number(direct?.value||0)+Number(receipts?.value||0)+Number(other?.value||0);
  const expenseTotal=Number(expenses?.total||0),realMinutes=Number(time?.teaching_minutes||0)+Number(time?.travel_minutes||0);
  const profit=Number(earned?.value||0)-Number(expenses?.business||0);
  return {date,month,sessions:(sessions.results||[]).map(s=>({...s,outstanding_pence:Math.max(0,Number(s.earned_pence||0)-Number(s.paid_pence||0))})),expense_categories:categories.results||[],summary:{earned_pence:Number(earned?.value||0),received_direct_pence:Number(direct?.value||0),received_student_pence:Number(receipts?.value||0),other_income_pence:Number(other?.value||0),received_total_pence:received,expenses_pence:expenseTotal,business_expenses_pence:Number(expenses?.business||0),personal_expenses_pence:Number(expenses?.personal||0),month_left_pence:received-expenseTotal,outstanding_pence:Number(outstanding?.value||0),true_hourly_pence:realMinutes>0?Math.round((profit*60)/realMinutes):0,expected_balance_pence:await calculateExpectedBalance(db)}};
}
async function ensureOccurrencesForDate(db,date){
  const weekday=new Date(`${date}T12:00:00Z`).getUTCDay();
  const rows=await db.prepare(`SELECT * FROM recurring_sessions_v3 WHERE active=1 AND weekday=?1`).bind(weekday).all();
  for(const r of rows.results||[]){const gross=sessionGross(r),cut=Math.round(gross*Number(r.center_cut_percent||0)/100);await db.prepare(`INSERT OR IGNORE INTO session_occurrences_v3(recurring_session_id,session_date,scheduled_start,status,gross_pence,center_cut_pence,earned_pence) VALUES(?1,?2,?3,'scheduled',?4,?5,0)`).bind(r.id,date,r.start_time,gross,cut).run();}
}
function sessionGross(r){const price=Number(r.price_pence||0),count=Math.max(1,Number(r.student_count||1));return r.price_basis==='per_student'?price*count:price;}

async function listStudents(env){const rows=await env.DB.prepare(`SELECT * FROM students_v3 WHERE active=1 AND deleted_at IS NULL ORDER BY name COLLATE NOCASE`).all();return json({students:rows.results||[]});}
async function createStudent(request,env){
  const b=await safeJson(request),name=String(b?.name||'').trim();if(!name)return json({error:'اكتبي اسم الطالب'},400);
  const r=await env.DB.prepare(`INSERT INTO students_v3(name,age,level,notes,guardian_name,guardian_phone) VALUES(?1,?2,?3,?4,?5,?6)`).bind(name.slice(0,100),nullableInt(b?.age),nullableText(b?.level),nullableText(b?.notes),nullableText(b?.guardian_name),nullableText(b?.guardian_phone)).run();
  await logActivity(env.DB,'student',r.meta?.last_row_id,'created',`اتضاف ${name}`,'ملف طالب جديد',null,b,false);return json({ok:true,id:r.meta?.last_row_id},201);
}
async function updateStudent(request,url,env){
  const id=Number(url.pathname.split('/').pop()),before=await env.DB.prepare(`SELECT * FROM students_v3 WHERE id=?1 AND deleted_at IS NULL`).bind(id).first();if(!before)return json({error:'الطالب غير موجود'},404);
  const b=await safeJson(request),name=String(b?.name??before.name).trim();
  const after={name:name.slice(0,100),age:b?.age===undefined?before.age:nullableInt(b.age),level:b?.level===undefined?before.level:nullableText(b.level),notes:b?.notes===undefined?before.notes:nullableText(b.notes),guardian_name:b?.guardian_name===undefined?before.guardian_name:nullableText(b.guardian_name),guardian_phone:b?.guardian_phone===undefined?before.guardian_phone:nullableText(b.guardian_phone)};
  await env.DB.prepare(`UPDATE students_v3 SET name=?1,age=?2,level=?3,notes=?4,guardian_name=?5,guardian_phone=?6,updated_at=CURRENT_TIMESTAMP WHERE id=?7`).bind(after.name,after.age,after.level,after.notes,after.guardian_name,after.guardian_phone,id).run();
  await logActivity(env.DB,'student',id,'updated',`اتعدلت بيانات ${after.name}`,'بيانات الطالب وولي الأمر',before,after,false);return json({ok:true});
}

async function listStudentSummaries(env){
  const students=await env.DB.prepare(`SELECT id,name,guardian_name,guardian_phone,age,level FROM students_v3 WHERE active=1 AND deleted_at IS NULL ORDER BY name COLLATE NOCASE`).all();
  const items=[];
  for(const s of students.results||[]) items.push(await studentSummary(env.DB,s));
  items.sort((a,b)=>b.outstanding_pence-a.outstanding_pence || a.name.localeCompare(b.name,'ar'));
  return json({students:items,total_outstanding_pence:items.reduce((x,s)=>x+s.outstanding_pence,0)});
}
async function studentSummary(db,s){
  const due=await db.prepare(`SELECT COALESCE(SUM(MAX(0,o.earned_pence-${paidExpr('o')})),0) value,COUNT(CASE WHEN MAX(0,o.earned_pence-${paidExpr('o')})>0 THEN 1 END) due_count FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE r.student_id=?1 AND o.status='completed'`).bind(s.id).first();
  const lastPayment=await db.prepare(`
    SELECT amount_pence,paid_at FROM (
      SELECT rr.amount_pence,rr.received_at paid_at,rr.id sort_id FROM student_receipts_v4 rr WHERE rr.student_id=?1 AND rr.deleted_at IS NULL
      UNION ALL
      SELECT p.amount_pence,p.paid_at,p.id sort_id FROM payments_v3 p JOIN session_occurrences_v3 o ON o.id=p.occurrence_id JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE r.student_id=?1 AND p.reversed_at IS NULL
    ) ORDER BY paid_at DESC,sort_id DESC LIMIT 1
  `).bind(s.id).first();
  const receiptTotal=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) value FROM student_receipts_v4 WHERE student_id=?1 AND deleted_at IS NULL`).bind(s.id).first();
  const alloc=await db.prepare(`SELECT COALESCE(SUM(a.amount_pence),0) value FROM receipt_allocations_v4 a JOIN student_receipts_v4 rr ON rr.id=a.receipt_id WHERE rr.student_id=?1 AND rr.deleted_at IS NULL`).bind(s.id).first();
  const schedules=await db.prepare(`SELECT weekday,start_time,session_type,price_pence,price_basis,student_count,center_cut_percent FROM recurring_sessions_v3 WHERE student_id=?1 AND active=1 ORDER BY weekday,start_time`).bind(s.id).all();
  return {...s,outstanding_pence:Number(due?.value||0),outstanding_count:Number(due?.due_count||0),credit_pence:Math.max(0,Number(receiptTotal?.value||0)-Number(alloc?.value||0)),last_payment_pence:Number(lastPayment?.amount_pence||0),last_payment_date:lastPayment?.paid_at||null,schedules:schedules.results||[]};
}
async function getStudentAccount(env,id){
  const s=await env.DB.prepare(`SELECT * FROM students_v3 WHERE id=?1 AND active=1 AND deleted_at IS NULL`).bind(id).first();if(!s)return json({error:'الطالب غير موجود'},404);
  const summary=await studentSummary(env.DB,s);
  const occurrences=await env.DB.prepare(`SELECT o.id,COALESCE(o.rescheduled_to_date,o.session_date) date,COALESCE(o.rescheduled_to_start,o.scheduled_start,r.start_time) start_time,o.status,o.earned_pence,r.title,r.session_type,${paidExpr('o')} paid_pence FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE r.student_id=?1 ORDER BY date DESC,o.id DESC LIMIT 40`).bind(id).all();
  const receipts=await env.DB.prepare(`SELECT id,amount_pence,received_at,payment_method,note,deleted_at FROM student_receipts_v4 WHERE student_id=?1 ORDER BY received_at DESC,id DESC LIMIT 30`).bind(id).all();
  const timeline=[...(occurrences.results||[]).map(x=>({kind:'session',date:x.date,...x,outstanding_pence:Math.max(0,Number(x.earned_pence||0)-Number(x.paid_pence||0))})),...(receipts.results||[]).map(x=>({kind:'receipt',date:x.received_at,...x}))].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,50);
  return json({student:summary,timeline});
}

async function listSessions(env){const rows=await env.DB.prepare(`SELECT r.*,s.name student_name,s.guardian_name FROM recurring_sessions_v3 r LEFT JOIN students_v3 s ON s.id=r.student_id WHERE r.active=1 ORDER BY r.weekday,r.start_time,r.id`).all();return json({sessions:rows.results||[]});}
async function createSession(request,env){
  const b=await safeJson(request),title=String(b?.title||b?.student_name||'').trim();if(!title)return json({error:'اكتبي اسم الطالب أو المجموعة'},400);if(!SESSION_TYPES.has(b?.session_type))return json({error:'نوع الحصة غير صالح'},400);
  let studentId=nullablePositiveInt(b?.student_id);
  if(!studentId&&b?.student_name&&!['center_group','own_group'].includes(b.session_type)){
    const existing=await env.DB.prepare(`SELECT id FROM students_v3 WHERE active=1 AND deleted_at IS NULL AND lower(trim(name))=lower(trim(?1)) ORDER BY id LIMIT 1`).bind(String(b.student_name).trim()).first();
    if(existing) studentId=existing.id; else {const c=await env.DB.prepare(`INSERT INTO students_v3(name,age,level,guardian_name,guardian_phone) VALUES(?1,?2,?3,?4,?5)`).bind(String(b.student_name).trim().slice(0,100),nullableInt(b.age),nullableText(b.level),nullableText(b.guardian_name),nullableText(b.guardian_phone)).run();studentId=Number(c.meta?.last_row_id||0)||null;}
  }
  const v=normalizeSessionBody(b);const r=await env.DB.prepare(`INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_type,price_basis,price_pence,student_count,center_cut_percent,travel_minutes,location) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`).bind(studentId,title.slice(0,120),b.session_type,v.weekday,v.start_time,v.duration_minutes,v.price_type,v.price_basis,v.price_pence,v.student_count,v.center_cut_percent,v.travel_minutes,v.location).run();
  await logActivity(env.DB,'session',r.meta?.last_row_id,'created',`اتضافت حصة ${title}`,`${weekdayLabel(v.weekday)} · ${v.start_time}`,null,b,false);return json({ok:true,id:r.meta?.last_row_id,student_id:studentId},201);
}
async function updateSession(request,url,env){
  const id=Number(url.pathname.split('/').pop()),before=await env.DB.prepare(`SELECT * FROM recurring_sessions_v3 WHERE id=?1 AND active=1`).bind(id).first();if(!before)return json({error:'الحصة غير موجودة'},404);
  const b=await safeJson(request),merged={...before,...b},title=String(merged.title||'').trim();if(!title)return json({error:'اسم الحصة مطلوب'},400);if(!SESSION_TYPES.has(merged.session_type))return json({error:'نوع الحصة غير صالح'},400);
  const v=normalizeSessionBody({...merged,price:b?.price??penceToMoney(before.price_pence)}),today=todayISO();
  await env.DB.prepare(`UPDATE recurring_sessions_v3 SET title=?1,session_type=?2,weekday=?3,start_time=?4,duration_minutes=?5,price_type=?6,price_basis=?7,price_pence=?8,student_count=?9,center_cut_percent=?10,travel_minutes=?11,location=?12,updated_at=CURRENT_TIMESTAMP WHERE id=?13`).bind(title.slice(0,120),merged.session_type,v.weekday,v.start_time,v.duration_minutes,v.price_type,v.price_basis,v.price_pence,v.student_count,v.center_cut_percent,v.travel_minutes,v.location,id).run();
  await env.DB.prepare(`DELETE FROM session_occurrences_v3 WHERE recurring_session_id=?1 AND session_date>=?2 AND status='scheduled' AND rescheduled_to_date IS NULL`).bind(id,today).run();
  await logActivity(env.DB,'session',id,'updated',`اتعدل جدول ${title}`,'التعديل يطبق على المواعيد القادمة فقط',before,{...merged,...v},false);return json({ok:true});
}
async function disableSession(url,env){const id=Number(url.pathname.split('/').pop()),before=await env.DB.prepare(`SELECT * FROM recurring_sessions_v3 WHERE id=?1`).bind(id).first();if(!before)return json({error:'الحصة غير موجودة'},404);await env.DB.prepare(`UPDATE recurring_sessions_v3 SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?1`).bind(id).run();await logActivity(env.DB,'session',id,'stopped',`اتوقفت ${before.title}`,'المواعيد القديمة محفوظة',before,{...before,active:0},false);return json({ok:true});}
function normalizeSessionBody(b){return{weekday:clampInt(b?.weekday,0,6),start_time:normalizeTime(b?.start_time),duration_minutes:clampInt(b?.duration_minutes??60,15,360),price_type:['per_session','monthly'].includes(b?.price_type)?b.price_type:'per_session',price_basis:['total_session','per_student'].includes(b?.price_basis)?b.price_basis:'total_session',price_pence:moneyToPence(b?.price??b?.price_amount??0),student_count:clampInt(b?.student_count??1,1,100),center_cut_percent:clampNumber(b?.center_cut_percent??0,0,100),travel_minutes:clampInt(b?.travel_minutes??0,0,360),location:nullableText(b?.location)};}

async function getOccurrence(env,id){
  const r=await env.DB.prepare(`SELECT o.id,o.session_date AS original_session_date,COALESCE(o.rescheduled_to_date,o.session_date) session_date,o.status,o.gross_pence,o.center_cut_pence,o.earned_pence,COALESCE(o.rescheduled_to_start,o.scheduled_start,rs.start_time) start_time,rs.title,rs.student_id,rs.session_type,${paidExpr('o')} paid_pence FROM session_occurrences_v3 o JOIN recurring_sessions_v3 rs ON rs.id=o.recurring_session_id WHERE o.id=?1`).bind(id).first();
  if(!r)return json({error:'الحصة غير موجودة'},404);
  return json({occurrence:{...r,outstanding_pence:Math.max(0,Number(r.earned_pence||0)-Number(r.paid_pence||0))}});
}

async function occurrenceRow(db,id){return db.prepare(`SELECT o.*,r.title,r.student_id,r.session_type,r.start_time FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE o.id=?1`).bind(id).first();}
async function handleOccurrenceAction(request,env,id,action){
  const b=await safeJson(request)||{},row=await occurrenceRow(env.DB,id);if(!row)return json({error:'الحصة غير موجودة'},404);
  const alreadyPaid=await occurrencePaid(env.DB,id);
  if(action==='cancel'){
    if(alreadyPaid>0)return json({error:'الحصة عليها تحصيل. صححي الدفع أولًا.'},409);
    await env.DB.prepare(`UPDATE session_occurrences_v3 SET status='cancelled',earned_pence=0,completed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?1`).bind(id).run();
    await logActivity(env.DB,'occurrence',id,'cancelled',`اتلغت حصة ${row.title}`,effectiveDate(row),row,{...row,status:'cancelled'},true);return json({ok:true});
  }
  if(action==='restore'||action==='reopen'){
    if(alreadyPaid>0)return json({error:'في تحصيل مرتبط بالحصة. صححيه أولًا.'},409);
    await env.DB.prepare(`UPDATE session_occurrences_v3 SET status='scheduled',earned_pence=0,completed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?1`).bind(id).run();
    await logActivity(env.DB,'occurrence',id,'restored',`رجعت حصة ${row.title} لمجدولة`,effectiveDate(row),row,{...row,status:'scheduled'},false);return json({ok:true});
  }
  if(action==='complete-paid'||action==='complete-unpaid'){
    const earned=Math.max(0,Number(row.gross_pence||0)-Number(row.center_cut_pence||0));
    await env.DB.prepare(`UPDATE session_occurrences_v3 SET status='completed',earned_pence=?1,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?2`).bind(earned,id).run();
    if(row.student_id) await applyAvailableCreditToOccurrence(env.DB,id,row.student_id);
    const afterCredit=await occurrencePaid(env.DB,id);
    if(action==='complete-paid'){
      const remainder=Math.max(0,earned-afterCredit);
      if(remainder>0)await env.DB.prepare(`INSERT INTO payments_v3(occurrence_id,amount_pence,paid_at,payment_method,note) VALUES(?1,?2,?3,?4,?5)`).bind(id,remainder,sanitizeDate(b?.paid_at)||effectiveDate(row),normalizePaymentMethod(b?.payment_method),'دفع مباشر من الحصة').run();
    }
    const finalPaid=await occurrencePaid(env.DB,id);
    await logActivity(env.DB,'occurrence',id,'completed',`تمت حصة ${row.title}`,finalPaid>=earned?'اتدفعت بالكامل':`باقي ${moneyText(Math.max(0,earned-finalPaid))}`,row,{...row,status:'completed',earned_pence:earned},false);return json({ok:true,earned_pence:earned,paid_pence:finalPaid,outstanding_pence:Math.max(0,earned-finalPaid)});
  }
  if(action==='collect'){
    if(row.status!=='completed')return json({error:'الحصة لم تكتمل بعد'},409);const due=Math.max(0,Number(row.earned_pence||0)-alreadyPaid);if(due<=0)return json({error:'الحصة مدفوعة بالكامل بالفعل'},409);
    const amount=b?.amount?moneyToPence(b.amount):due;if(amount<=0||amount>due)return json({error:'قيمة التحصيل غير صحيحة'},400);
    await env.DB.prepare(`INSERT INTO payments_v3(occurrence_id,amount_pence,paid_at,payment_method,note) VALUES(?1,?2,?3,?4,?5)`).bind(id,amount,sanitizeDate(b?.paid_at)||todayISO(),normalizePaymentMethod(b?.payment_method),nullableText(b?.note)||'تحصيل مباشر').run();
    await logActivity(env.DB,'payment',id,'collected',`تحصيل ${row.title}`,moneyText(amount),null,{amount_pence:amount},false);return json({ok:true});
  }
  return json({error:'إجراء غير صالح'},400);
}
async function rescheduleOccurrence(request,env,id){
  const b=await safeJson(request)||{},row=await occurrenceRow(env.DB,id);if(!row)return json({error:'الحصة غير موجودة'},404);if(row.status!=='scheduled')return json({error:'يمكن نقل الحصة وهي مجدولة فقط'},409);
  const date=sanitizeDate(b?.date),time=normalizeTimeStrict(b?.time);if(!date||!time)return json({error:'اختاري اليوم والوقت الجديد'},400);
  if(date===row.session_date&&time===(row.scheduled_start||row.start_time)){await env.DB.prepare(`UPDATE session_occurrences_v3 SET rescheduled_to_date=NULL,rescheduled_to_start=NULL,rescheduled_at=NULL,reschedule_note=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?1`).bind(id).run();await logActivity(env.DB,'occurrence',id,'reschedule_reverted',`رجعت حصة ${row.title} لموعدها الأصلي`,`${date} · ${time}`,row,null,false);return json({ok:true,restored_original:true,date,time});}
  const conflict=await env.DB.prepare(`SELECT o.id FROM session_occurrences_v3 o WHERE o.recurring_session_id=?1 AND COALESCE(o.rescheduled_to_date,o.session_date)=?2 AND o.id<>?3 LIMIT 1`).bind(row.recurring_session_id,date,id).first();if(conflict)return json({error:'في حصة لنفس الجدول موجودة بالفعل في اليوم الجديد'},409);
  await env.DB.prepare(`UPDATE session_occurrences_v3 SET rescheduled_to_date=?1,rescheduled_to_start=?2,rescheduled_at=CURRENT_TIMESTAMP,reschedule_note=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?4`).bind(date,time,nullableText(b?.note),id).run();
  await logActivity(env.DB,'occurrence',id,'rescheduled',`اتنقلت حصة ${row.title}`,`${effectiveDate(row)} ← ${date} · ${time}`,row,{...row,rescheduled_to_date:date,rescheduled_to_start:time},false);return json({ok:true,date,time});
}
async function correctOccurrencePayment(request,env,id){
  const b=await safeJson(request)||{},row=await occurrenceRow(env.DB,id);if(!row)return json({error:'الحصة غير موجودة'},404);if(row.status!=='completed')return json({error:'تصحيح الدفع متاح للحصة المكتملة فقط'},409);
  const target=moneyToPenceAllowZero(b?.received_total);if(target===null)return json({error:'اكتبي المبلغ الصحيح'},400);const earned=Number(row.earned_pence||0);if(target>earned)return json({error:'المبلغ لا يمكن أن يتجاوز قيمة الحصة'},400);
  const allocated=await allocationPaid(env.DB,id);if(target<allocated)return json({error:`جزء من الدفع (${moneyText(allocated)}) جاي من رصيد مقدم. عدّلي استلام الطالب بدلًا من ذلك.`},409);
  const directTarget=target-allocated;const currentDirect=await directPaid(env.DB,id);if(currentDirect===directTarget)return json({ok:true,unchanged:true});
  const active=await env.DB.prepare(`SELECT * FROM payments_v3 WHERE occurrence_id=?1 AND reversed_at IS NULL ORDER BY paid_at,id`).bind(id).all();const reason=nullableText(b?.reason)||'تصحيح التحصيل';
  await env.DB.prepare(`UPDATE payments_v3 SET reversed_at=CURRENT_TIMESTAMP,reversal_reason=?1 WHERE occurrence_id=?2 AND reversed_at IS NULL`).bind(reason,id).run();
  if(directTarget>0){const fallback=(active.results||[])[0]?.paid_at||todayISO();await env.DB.prepare(`INSERT INTO payments_v3(occurrence_id,amount_pence,paid_at,payment_method,note) VALUES(?1,?2,?3,?4,?5)`).bind(id,directTarget,sanitizeDate(b?.paid_at)||fallback,normalizePaymentMethod(b?.payment_method),'قيمة مصححة').run();}
  await logActivity(env.DB,'payment',id,'corrected',`اتصحح دفع ${row.title}`,`${moneyText(currentDirect+allocated)} ← ${moneyText(target)}`,{received_pence:currentDirect+allocated},{received_pence:target},false);return json({ok:true,received_pence:target,outstanding_pence:Math.max(0,earned-target)});
}
async function directPaid(db,id){const r=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) value FROM payments_v3 WHERE occurrence_id=?1 AND reversed_at IS NULL`).bind(id).first();return Number(r?.value||0);}
async function allocationPaid(db,id){const r=await db.prepare(`SELECT COALESCE(SUM(a.amount_pence),0) value FROM receipt_allocations_v4 a JOIN student_receipts_v4 rr ON rr.id=a.receipt_id WHERE a.occurrence_id=?1 AND rr.deleted_at IS NULL`).bind(id).first();return Number(r?.value||0);}
async function occurrencePaid(db,id){return (await directPaid(db,id))+(await allocationPaid(db,id));}
async function applyAvailableCreditToOccurrence(db,occurrenceId,studentId){
  const row=await db.prepare(`SELECT earned_pence FROM session_occurrences_v3 WHERE id=?1`).bind(occurrenceId).first();let due=Math.max(0,Number(row?.earned_pence||0)-await occurrencePaid(db,occurrenceId));if(due<=0)return 0;
  const receipts=await db.prepare(`SELECT rr.id,rr.amount_pence,COALESCE((SELECT SUM(a.amount_pence) FROM receipt_allocations_v4 a WHERE a.receipt_id=rr.id),0) allocated FROM student_receipts_v4 rr WHERE rr.student_id=?1 AND rr.deleted_at IS NULL ORDER BY rr.received_at,rr.id`).bind(studentId).all();let used=0;
  for(const r of receipts.results||[]){const credit=Math.max(0,Number(r.amount_pence||0)-Number(r.allocated||0));if(credit<=0)continue;const amount=Math.min(credit,due);await db.prepare(`INSERT INTO receipt_allocations_v4(receipt_id,occurrence_id,amount_pence) VALUES(?1,?2,?3)`).bind(r.id,occurrenceId,amount).run();used+=amount;due-=amount;if(due<=0)break;}
  return used;
}

async function createReceipt(request,env){
  const b=await safeJson(request)||{},studentId=nullablePositiveInt(b.student_id),amount=moneyToPence(b.amount),date=sanitizeDate(b.received_at)||todayISO();if(!studentId)return json({error:'اختاري الطالب'},400);if(amount<=0)return json({error:'اكتبي مبلغًا أكبر من صفر'},400);
  const student=await env.DB.prepare(`SELECT * FROM students_v3 WHERE id=?1 AND active=1 AND deleted_at IS NULL`).bind(studentId).first();if(!student)return json({error:'الطالب غير موجود'},404);
  const r=await env.DB.prepare(`INSERT INTO student_receipts_v4(student_id,amount_pence,received_at,payment_method,note) VALUES(?1,?2,?3,?4,?5)`).bind(studentId,amount,date,normalizePaymentMethod(b.payment_method),nullableText(b.note)).run();
  const allocation=await allocateReceipt(env.DB,r.meta?.last_row_id,studentId,amount);
  await logActivity(env.DB,'receipt',r.meta?.last_row_id,'created',`استلام من ${student.guardian_name||student.name}`,`${moneyText(amount)} · ${student.name}`,null,{student_id:studentId,amount_pence:amount,received_at:date},true);
  return json({ok:true,id:r.meta?.last_row_id,student_id:studentId,allocated_pence:allocation.allocated_pence,credit_pence:allocation.credit_pence,paid_items:allocation.paid_items},201);
}
async function allocateReceipt(db,receiptId,studentId,amount){
  const rows=await db.prepare(`SELECT o.id,o.earned_pence,${paidExpr('o')} paid_pence FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE r.student_id=?1 AND o.status='completed' ORDER BY COALESCE(o.rescheduled_to_date,o.session_date),o.id`).bind(studentId).all();let remaining=amount,allocated=0,items=0;
  for(const o of rows.results||[]){const due=Math.max(0,Number(o.earned_pence||0)-Number(o.paid_pence||0));if(due<=0)continue;const part=Math.min(due,remaining);if(part<=0)break;await db.prepare(`INSERT INTO receipt_allocations_v4(receipt_id,occurrence_id,amount_pence) VALUES(?1,?2,?3)`).bind(receiptId,o.id,part).run();remaining-=part;allocated+=part;items++;if(remaining<=0)break;}
  return {allocated_pence:allocated,credit_pence:remaining,paid_items:items};
}
async function listReceipts(url,env){const month=validMonth(url.searchParams.get('month'));const studentId=nullablePositiveInt(url.searchParams.get('student_id'));let sql=`SELECT rr.*,s.name student_name,s.guardian_name,COALESCE((SELECT SUM(a.amount_pence) FROM receipt_allocations_v4 a WHERE a.receipt_id=rr.id),0) allocated_pence FROM student_receipts_v4 rr JOIN students_v3 s ON s.id=rr.student_id WHERE 1=1`;const binds=[];if(month){sql+=` AND substr(rr.received_at,1,7)=?${binds.length+1}`;binds.push(month)}if(studentId){sql+=` AND rr.student_id=?${binds.length+1}`;binds.push(studentId)}sql+=` ORDER BY rr.received_at DESC,rr.id DESC LIMIT 200`;let q=env.DB.prepare(sql);if(binds.length)q=q.bind(...binds);const rows=await q.all();return json({receipts:rows.results||[]});}
async function getReceipt(env,id){const r=await env.DB.prepare(`SELECT rr.*,s.name student_name,s.guardian_name,COALESCE((SELECT SUM(a.amount_pence) FROM receipt_allocations_v4 a WHERE a.receipt_id=rr.id),0) allocated_pence FROM student_receipts_v4 rr JOIN students_v3 s ON s.id=rr.student_id WHERE rr.id=?1`).bind(id).first();if(!r)return json({error:'الاستلام غير موجود'},404);return json({receipt:r});}
async function updateReceipt(request,env,id){
  const before=await env.DB.prepare(`SELECT * FROM student_receipts_v4 WHERE id=?1 AND deleted_at IS NULL`).bind(id).first();if(!before)return json({error:'الاستلام غير موجود'},404);const b=await safeJson(request)||{},studentId=nullablePositiveInt(b.student_id??before.student_id),amount=moneyToPence(b.amount??penceToMoney(before.amount_pence)),date=sanitizeDate(b.received_at)||before.received_at;if(!studentId||amount<=0)return json({error:'راجعي الطالب والمبلغ'},400);
  const student=await env.DB.prepare(`SELECT * FROM students_v3 WHERE id=?1 AND active=1 AND deleted_at IS NULL`).bind(studentId).first();if(!student)return json({error:'الطالب غير موجود'},404);
  await env.DB.prepare(`UPDATE student_receipts_v4 SET student_id=?1,amount_pence=?2,received_at=?3,payment_method=?4,note=?5,updated_at=CURRENT_TIMESTAMP WHERE id=?6`).bind(studentId,amount,date,normalizePaymentMethod(b.payment_method??before.payment_method),b.note===undefined?before.note:nullableText(b.note),id).run();
  await env.DB.prepare(`DELETE FROM receipt_allocations_v4 WHERE receipt_id=?1`).bind(id).run();const allocation=await allocateReceipt(env.DB,id,studentId,amount);
  await logActivity(env.DB,'receipt',id,'updated',`اتعدل استلام ${student.name}`,moneyText(amount),before,{student_id:studentId,amount_pence:amount,received_at:date},false);return json({ok:true,allocated_pence:allocation.allocated_pence,credit_pence:allocation.credit_pence});
}
async function deleteReceipt(env,id){const before=await env.DB.prepare(`SELECT rr.*,s.name student_name,s.guardian_name FROM student_receipts_v4 rr JOIN students_v3 s ON s.id=rr.student_id WHERE rr.id=?1 AND rr.deleted_at IS NULL`).bind(id).first();if(!before)return json({error:'الاستلام غير موجود'},404);await env.DB.prepare(`UPDATE student_receipts_v4 SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?1`).bind(id).run();const event=await logActivity(env.DB,'receipt',id,'deleted',`اتحذف استلام ${before.student_name}`,moneyText(before.amount_pence),before,null,true);return json({ok:true,activity_id:event});}

async function listOutstanding(env){const rows=await env.DB.prepare(`SELECT o.id occurrence_id,r.student_id,s.name student_name,COALESCE(o.rescheduled_to_date,o.session_date) session_date,o.earned_pence,r.title,r.session_type,${paidExpr('o')} paid_pence FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id LEFT JOIN students_v3 s ON s.id=r.student_id WHERE o.status='completed' AND o.earned_pence>${paidExpr('o')} ORDER BY COALESCE(o.rescheduled_to_date,o.session_date),o.id`).all();const items=(rows.results||[]).map(r=>({...r,outstanding_pence:Math.max(0,Number(r.earned_pence||0)-Number(r.paid_pence||0))}));return json({items,total_pence:items.reduce((x,r)=>x+r.outstanding_pence,0)});}

async function listExpenses(url,env){const month=validMonth(url.searchParams.get('month'))||todayISO().slice(0,7);const rows=await env.DB.prepare(`SELECT * FROM expenses_v3 WHERE deleted_at IS NULL AND substr(expense_date,1,7)=?1 ORDER BY expense_date DESC,id DESC LIMIT 250`).bind(month).all();return json({month,expenses:rows.results||[]});}
async function getExpense(env,id){const e=await env.DB.prepare(`SELECT * FROM expenses_v3 WHERE id=?1`).bind(id).first();if(!e)return json({error:'المصروف غير موجود'},404);return json({expense:e});}
async function createExpense(request,env){const b=await safeJson(request),e=normalizeExpenseBody(b);if(e.error)return json({error:e.error},400);const r=await env.DB.prepare(`INSERT INTO expenses_v3(expense_date,scope,category,amount_pence,note) VALUES(?1,?2,?3,?4,?5)`).bind(e.date,e.scope,e.category,e.amount_pence,e.note).run();await logActivity(env.DB,'expense',r.meta?.last_row_id,'created','مصروف جديد',`${expenseCategoryLabel(e.category)} · ${moneyText(e.amount_pence)}`,null,e,true);return json({ok:true,id:r.meta?.last_row_id},201);}
async function updateExpense(request,env,id){const before=await env.DB.prepare(`SELECT * FROM expenses_v3 WHERE id=?1 AND deleted_at IS NULL`).bind(id).first();if(!before)return json({error:'المصروف غير موجود'},404);const b=await safeJson(request),e=normalizeExpenseBody({date:b?.date??before.expense_date,scope:b?.scope??before.scope,category:b?.category??before.category,amount:b?.amount??penceToMoney(before.amount_pence),note:b?.note??before.note});if(e.error)return json({error:e.error},400);await env.DB.prepare(`UPDATE expenses_v3 SET expense_date=?1,scope=?2,category=?3,amount_pence=?4,note=?5,updated_at=CURRENT_TIMESTAMP WHERE id=?6`).bind(e.date,e.scope,e.category,e.amount_pence,e.note,id).run();await logActivity(env.DB,'expense',id,'updated','اتعدل مصروف',`${expenseCategoryLabel(e.category)} · ${moneyText(e.amount_pence)}`,before,e,false);return json({ok:true});}
async function deleteExpense(env,id){const before=await env.DB.prepare(`SELECT * FROM expenses_v3 WHERE id=?1 AND deleted_at IS NULL`).bind(id).first();if(!before)return json({error:'المصروف غير موجود'},404);await env.DB.prepare(`UPDATE expenses_v3 SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?1`).bind(id).run();const event=await logActivity(env.DB,'expense',id,'deleted','اتحذف مصروف',`${expenseCategoryLabel(before.category)} · ${moneyText(before.amount_pence)}`,before,null,true);return json({ok:true,activity_id:event});}
function normalizeExpenseBody(b){const scope=b?.scope==='personal'?'personal':'business',category=String(b?.category||''),allowed=scope==='business'?BUSINESS_EXPENSE_CATEGORIES:PERSONAL_EXPENSE_CATEGORIES;if(!allowed.has(category))return{error:'فئة المصروف لا تناسب نوعه'};const amount=moneyToPence(b?.amount);if(amount<=0)return{error:'اكتبي مبلغًا أكبر من صفر'};return{date:sanitizeDate(b?.date)||todayISO(),scope,category,amount_pence:amount,note:nullableText(b?.note)};}

async function listOtherIncome(url,env){const month=validMonth(url.searchParams.get('month'))||todayISO().slice(0,7);const rows=await env.DB.prepare(`SELECT * FROM other_income_v3 WHERE deleted_at IS NULL AND substr(income_date,1,7)=?1 ORDER BY income_date DESC,id DESC LIMIT 250`).bind(month).all();return json({month,income:rows.results||[]});}
async function getOtherIncome(env,id){const i=await env.DB.prepare(`SELECT * FROM other_income_v3 WHERE id=?1`).bind(id).first();if(!i)return json({error:'الدخل غير موجود'},404);return json({income:i});}
async function createOtherIncome(request,env){const b=await safeJson(request),category=OTHER_INCOME_CATEGORIES.has(b?.category)?b.category:'other',amount=moneyToPence(b?.amount);if(amount<=0)return json({error:'اكتبي مبلغًا أكبر من صفر'},400);const x={date:sanitizeDate(b?.date)||todayISO(),category,amount_pence:amount,note:nullableText(b?.note)};const r=await env.DB.prepare(`INSERT INTO other_income_v3(income_date,category,amount_pence,note) VALUES(?1,?2,?3,?4)`).bind(x.date,x.category,x.amount_pence,x.note).run();await logActivity(env.DB,'other_income',r.meta?.last_row_id,'created','دخل آخر جديد',`${incomeCategoryLabel(category)} · ${moneyText(amount)}`,null,x,true);return json({ok:true,id:r.meta?.last_row_id},201);}
async function updateOtherIncome(request,env,id){const before=await env.DB.prepare(`SELECT * FROM other_income_v3 WHERE id=?1 AND deleted_at IS NULL`).bind(id).first();if(!before)return json({error:'الدخل غير موجود'},404);const b=await safeJson(request),category=OTHER_INCOME_CATEGORIES.has(b?.category)?b.category:before.category,amount=moneyToPence(b?.amount??penceToMoney(before.amount_pence));if(amount<=0)return json({error:'اكتبي مبلغًا أكبر من صفر'},400);const after={date:sanitizeDate(b?.date)||before.income_date,category,amount_pence:amount,note:b?.note===undefined?before.note:nullableText(b.note)};await env.DB.prepare(`UPDATE other_income_v3 SET income_date=?1,category=?2,amount_pence=?3,note=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?5`).bind(after.date,after.category,after.amount_pence,after.note,id).run();await logActivity(env.DB,'other_income',id,'updated','اتعدل دخل آخر',`${incomeCategoryLabel(category)} · ${moneyText(amount)}`,before,after,false);return json({ok:true});}
async function deleteOtherIncome(env,id){const before=await env.DB.prepare(`SELECT * FROM other_income_v3 WHERE id=?1 AND deleted_at IS NULL`).bind(id).first();if(!before)return json({error:'الدخل غير موجود'},404);await env.DB.prepare(`UPDATE other_income_v3 SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?1`).bind(id).run();const event=await logActivity(env.DB,'other_income',id,'deleted','اتحذف دخل آخر',`${incomeCategoryLabel(before.category)} · ${moneyText(before.amount_pence)}`,before,null,true);return json({ok:true,activity_id:event});}

async function restoreEntity(env,type,id){
  let table,title,detail;
  if(type==='expense'){table='expenses_v3';const e=await env.DB.prepare(`SELECT * FROM expenses_v3 WHERE id=?1`).bind(id).first();if(!e)return json({error:'العنصر غير موجود'},404);title='رجع مصروف';detail=`${expenseCategoryLabel(e.category)} · ${moneyText(e.amount_pence)}`;}
  if(type==='other_income'){table='other_income_v3';const i=await env.DB.prepare(`SELECT * FROM other_income_v3 WHERE id=?1`).bind(id).first();if(!i)return json({error:'العنصر غير موجود'},404);title='رجع دخل آخر';detail=`${incomeCategoryLabel(i.category)} · ${moneyText(i.amount_pence)}`;}
  if(type==='receipt'){table='student_receipts_v4';const r=await env.DB.prepare(`SELECT rr.*,s.name student_name FROM student_receipts_v4 rr JOIN students_v3 s ON s.id=rr.student_id WHERE rr.id=?1`).bind(id).first();if(!r)return json({error:'العنصر غير موجود'},404);title=`رجع استلام ${r.student_name}`;detail=moneyText(r.amount_pence);}
  if(!table)return json({error:'نوع غير صالح'},400);await env.DB.prepare(`UPDATE ${table} SET deleted_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?1`).bind(id).run();await logActivity(env.DB,type,id,'restored',title,detail,null,null,false);return json({ok:true});
}

async function listActivity(url,env){
  const type=String(url.searchParams.get('type')||'all'),q=String(url.searchParams.get('q')||'').trim(),limit=clampInt(url.searchParams.get('limit')||80,10,200);let sql=`SELECT a.*, (SELECT action FROM activity_events_v4 z WHERE z.entity_type=a.entity_type AND z.entity_id=a.entity_id ORDER BY z.id DESC LIMIT 1) latest_action FROM activity_events_v4 a WHERE 1=1`;const binds=[];
  if(type!=='all'){sql+=` AND a.entity_type=?${binds.length+1}`;binds.push(type)}if(q){sql+=` AND (a.title LIKE ?${binds.length+1} OR COALESCE(a.detail,'') LIKE ?${binds.length+1})`;binds.push(`%${q}%`)}sql+=` ORDER BY a.created_at DESC,a.id DESC LIMIT ${limit}`;let stmt=env.DB.prepare(sql);if(binds.length)stmt=stmt.bind(...binds);const rows=await stmt.all();return json({events:rows.results||[]});
}
async function reviewCenter(env){
  const items=[];
  const dup=await env.DB.prepare(`SELECT expense_date,scope,category,amount_pence,COUNT(*) count,GROUP_CONCAT(id) ids FROM expenses_v3 WHERE deleted_at IS NULL GROUP BY expense_date,scope,category,amount_pence HAVING COUNT(*)>1 ORDER BY expense_date DESC LIMIT 10`).all();
  for(const d of dup.results||[])items.push({kind:'duplicate_expense',tone:'attention',title:'مصروف متكرر محتاج مراجعة',text:`${expenseCategoryLabel(d.category)} · ${moneyText(d.amount_pence)} اتسجل ${d.count} مرات في ${d.expense_date}.`,entity_type:'expense',entity_ids:String(d.ids).split(',').map(Number)});
  const overdue=await env.DB.prepare(`SELECT o.id,r.student_id,s.name student_name,COALESCE(o.rescheduled_to_date,o.session_date) date,MAX(0,o.earned_pence-${paidExpr('o')}) due FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id LEFT JOIN students_v3 s ON s.id=r.student_id WHERE o.status='completed' AND date(COALESCE(o.rescheduled_to_date,o.session_date))<=date('now','-14 day') AND o.earned_pence>${paidExpr('o')} ORDER BY date LIMIT 10`).all();
  for(const x of overdue.results||[])items.push({kind:'overdue',tone:'attention',title:`مستحق قديم على ${x.student_name||'طالب'}`,text:`${moneyText(x.due)} من حصة ${x.date} لسه ما اتحصلتش.`,student_id:x.student_id});
  const cash=await env.DB.prepare(`SELECT * FROM cash_checks_v3 ORDER BY check_date DESC,id DESC LIMIT 1`).first();if(cash&&Math.abs(Number(cash.difference_pence||0))>=5000)items.push({kind:'cash_difference',tone:'info',title:'فرق في مطابقة الفلوس',text:`آخر مطابقة فيها فرق ${moneyText(Math.abs(cash.difference_pence))}. راجعي آخر الحركات.`});
  return json({items});
}
async function logActivity(db,entityType,entityId,action,title,detail,before,after,undoable=false){const r=await db.prepare(`INSERT INTO activity_events_v4(entity_type,entity_id,action,title,detail,before_json,after_json,undoable) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`).bind(entityType,entityId??null,action,String(title||'تعديل').slice(0,140),nullableText(detail),before?JSON.stringify(before):null,after?JSON.stringify(after):null,undoable?1:0).run();return Number(r.meta?.last_row_id||0);}

async function calculateExpectedBalance(db){const opening=await db.prepare(`SELECT value FROM settings_v3 WHERE key='opening_balance_pence'`).first(),direct=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) value FROM payments_v3 WHERE reversed_at IS NULL`).first(),receipts=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) value FROM student_receipts_v4 WHERE deleted_at IS NULL`).first(),other=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) value FROM other_income_v3 WHERE deleted_at IS NULL`).first(),expense=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) value FROM expenses_v3 WHERE deleted_at IS NULL`).first();return Number(opening?.value||0)+Number(direct?.value||0)+Number(receipts?.value||0)+Number(other?.value||0)-Number(expense?.value||0);}
async function getCashCheck(env){const expected=await calculateExpectedBalance(env.DB),last=await env.DB.prepare(`SELECT * FROM cash_checks_v3 ORDER BY check_date DESC,id DESC LIMIT 1`).first();return json({expected_balance_pence:expected,last_check:last||null});}
async function createCashCheck(request,env){const b=await safeJson(request),actual=moneyToSignedPence(b?.actual_balance);if(!Number.isFinite(actual))return json({error:'اكتبي الرصيد الموجود فعليًا'},400);const expected=await calculateExpectedBalance(env.DB),difference=actual-expected,date=sanitizeDate(b?.date)||todayISO(),r=await env.DB.prepare(`INSERT INTO cash_checks_v3(check_date,expected_balance_pence,actual_balance_pence,difference_pence,note) VALUES(?1,?2,?3,?4,?5)`).bind(date,expected,actual,difference,nullableText(b?.note)).run();await logActivity(env.DB,'settings',r.meta?.last_row_id,'cash_check','مطابقة الفلوس',difference===0?'الحساب متطابق':`الفرق ${moneyText(Math.abs(difference))}`,null,{expected,actual,difference},false);return json({ok:true,id:r.meta?.last_row_id,expected_balance_pence:expected,actual_balance_pence:actual,difference_pence:difference,unrecorded_spending_pence:Math.max(0,expected-actual),unrecorded_income_pence:Math.max(0,actual-expected)},201);}
async function getSettings(env){const rows=await env.DB.prepare(`SELECT key,value FROM settings_v3`).all();return json({settings:Object.fromEntries((rows.results||[]).map(r=>[r.key,r.value]))});}
async function updateSettings(request,env){const b=await safeJson(request),allowed={};if(b?.opening_balance!==undefined)allowed.opening_balance_pence=String(moneyToSignedPence(b.opening_balance));if(b?.sozan_display_name!==undefined)allowed.sozan_display_name=String(b.sozan_display_name||'سوزان').trim().slice(0,50)||'سوزان';for(const[k,v]of Object.entries(allowed))await env.DB.prepare(`INSERT INTO settings_v3(key,value,updated_at) VALUES(?1,?2,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(k,v).run();await logActivity(env.DB,'settings',null,'updated','اتعدلت الإعدادات','إعدادات البداية',null,allowed,false);return json({ok:true});}

async function getInsights(url,env){const date=sanitizeDate(url.searchParams.get('date'))||todayISO(),current=await buildDashboardData(env.DB,date),previous=await buildDashboardData(env.DB,previousMonthDate(date)),insights=[],s=current.summary,prev=previous.summary;if(s.outstanding_pence>0)insights.push({tone:'attention',title:'في فلوس لسه ما اتحصلتش',text:`عندك ${moneyText(s.outstanding_pence)} من حصص تمت ولسه ما اتدفعتش.`});if(s.received_total_pence>0&&s.expenses_pence/s.received_total_pence>=.8)insights.push({tone:'attention',title:'المصروف قريب من الدخل',text:`صرفتي حوالي ${Math.round(s.expenses_pence/s.received_total_pence*100)}% من اللي قبضتيه هذا الشهر.`});const top=current.expense_categories?.[0];if(top)insights.push({tone:'info',title:'أكبر باب صرف',text:`${expenseCategoryLabel(top.category)} هو أكبر بند: ${moneyText(top.amount_pence)}.`});if(prev.received_total_pence>0){const change=(s.received_total_pence-prev.received_total_pence)/prev.received_total_pence*100;if(Math.abs(change)>=10)insights.push({tone:change>0?'good':'attention',title:'مقارنة بالشهر اللي فات',text:`التحصيل ${change>0?'أعلى':'أقل'} بحوالي ${Math.abs(Math.round(change))}%.`});}if(s.true_hourly_pence>0)insights.push({tone:'good',title:'العائد الحقيقي للساعة',text:`متوسط صافي عائد ساعة الشغل مع الانتقال حوالي ${moneyText(s.true_hourly_pence)}.`});if(!insights.length)insights.push({tone:'info',title:'لسه بنبني الصورة',text:'سجلي الحصص والمصروفات لأيام قليلة، وبعدها التحليل هيبقى أوضح.'});return json({date,insights:insights.slice(0,5)});}

function effectiveDate(row){return row.rescheduled_to_date||row.session_date||todayISO();}
function expenseCategoryLabel(c){return({work_transport:'مواصلات الشغل',books_printing:'كتب وطباعة',teaching_supplies:'أدوات تعليم',work_internet:'إنترنت الشغل',center_fees:'مصاريف السنتر',study_materials:'مواد دراسية',other_business:'مصروف شغل آخر',home:'البيت',food:'الأكل',personal_transport:'مواصلات شخصية',bills:'فواتير',children:'الأطفال',commitments:'التزامات',personal_shopping:'شراء شخصي',health:'الصحة',other_personal:'مصروف شخصي آخر'})[c]||'أخرى';}
function incomeCategoryLabel(c){return({course:'كورس',extra_group:'مجموعة إضافية',materials:'مواد تعليمية',bonus:'مكافأة',other:'دخل آخر'})[c]||'دخل آخر';}
function weekdayLabel(n){return ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'][Number(n)]||'';}
function previousMonthDate(date){const[y,m]=date.split('-').map(Number),d=new Date(Date.UTC(y,m-2,15));return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-15`;}
function validMonth(v){return /^\d{4}-\d{2}$/.test(v||'')?v:null;}
function normalizePaymentMethod(v){return ['cash','bank','wallet','other'].includes(v)?v:'cash';}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:JSON_HEADERS});}
async function safeJson(request){try{return await request.json();}catch{return null;}}
function todayISO(){return new Date().toISOString().slice(0,10);}
function sanitizeDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||'')?v:null;}
function normalizeTime(v){return /^\d{2}:\d{2}$/.test(v||'')?v:'09:00';}
function normalizeTimeStrict(v){return /^([01]\d|2[0-3]):[0-5]\d$/.test(v||'')?v:null;}
function nullableText(v){const s=String(v??'').trim();return s?s.slice(0,300):null;}
function nullableInt(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?Math.round(n):null;}
function nullablePositiveInt(v){const n=Number(v);return Number.isFinite(n)&&n>0?Math.round(n):null;}
function clampInt(v,min,max){return Math.min(max,Math.max(min,Math.round(Number(v)||0)));}
function clampNumber(v,min,max){return Math.min(max,Math.max(min,Number(v)||0));}
function moneyToPence(v){const n=Number(String(v??'').replace(',','.'));return Number.isFinite(n)?Math.max(0,Math.round(n*100)):0;}
function moneyToPenceAllowZero(v){if(v===null||v===undefined||v==='')return null;const n=Number(String(v).replace(',','.'));return Number.isFinite(n)&&n>=0?Math.round(n*100):null;}
function moneyToSignedPence(v){const n=Number(String(v??'').replace(',','.'));return Number.isFinite(n)?Math.round(n*100):NaN;}
function penceToMoney(v){return Number(v||0)/100;}
function moneyText(v){return `${(Number(v||0)/100).toLocaleString('ar-EG',{maximumFractionDigits:2})} ج`;}
async function hmac(message,secret){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(message));return toBase64Url(String.fromCharCode(...new Uint8Array(sig)));}
function toBase64Url(s){return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function fromBase64Url(s){const pad=s.length%4?'='.repeat(4-(s.length%4)):'';return atob((s+pad).replace(/-/g,'+').replace(/_/g,'/'));}
async function safeEqual(a,b){const aa=new TextEncoder().encode(String(a)),bb=new TextEncoder().encode(String(b));if(aa.length!==bb.length)return false;let diff=0;for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];return diff===0;}
