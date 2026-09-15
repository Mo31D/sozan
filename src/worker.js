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
const SESSION_TYPES = new Set([
  'private_student_home','private_sozan_home','online','center_group','own_group'
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
      if (path === '/api/health') return json({ ok:true, app:env.APP_NAME || 'Sozan Tutor OS', version:'3.1' });
      if (path === '/api/login' && request.method === 'POST') return handleLogin(request, env);
      if (path === '/api/logout' && request.method === 'POST') {
        return new Response(null, { status:204, headers:{'set-cookie':'sozan_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'} });
      }

      const auth = await requireAuth(request, env);
      if (auth) return auth;

      if ((path === '/api/v3/dashboard' || path === '/api/v3/today') && request.method === 'GET') return v3Dashboard(url, env);
      if (path === '/api/v3/students' && request.method === 'GET') return listStudents(env);
      if (path === '/api/v3/students' && request.method === 'POST') return createStudent(request, env);
      if (/^\/api\/v3\/students\/\d+$/.test(path) && request.method === 'PATCH') return updateStudent(request, url, env);

      if (path === '/api/v3/sessions' && request.method === 'GET') return listSessions(env);
      if (path === '/api/v3/sessions' && request.method === 'POST') return createSession(request, env);
      if (/^\/api\/v3\/sessions\/\d+$/.test(path) && request.method === 'PATCH') return updateSession(request, url, env);
      if (/^\/api\/v3\/sessions\/\d+$/.test(path) && request.method === 'DELETE') return disableSession(url, env);

      const action = path.match(/^\/api\/v3\/occurrences\/(\d+)\/(complete-paid|complete-unpaid|cancel|restore|collect)$/);
      if (action && request.method === 'POST') return handleOccurrenceAction(request, env, Number(action[1]), action[2]);
      const reschedule = path.match(/^\/api\/v3\/occurrences\/(\d+)\/reschedule$/);
      if (reschedule && request.method === 'POST') return rescheduleOccurrence(request, env, Number(reschedule[1]));
      const correct = path.match(/^\/api\/v3\/occurrences\/(\d+)\/correct-payment$/);
      if (correct && request.method === 'POST') return correctOccurrencePayment(request, env, Number(correct[1]));
      const paymentList = path.match(/^\/api\/v3\/occurrences\/(\d+)\/payments$/);
      if (paymentList && request.method === 'GET') return listOccurrencePayments(env, Number(paymentList[1]));

      if (path === '/api/v3/outstanding' && request.method === 'GET') return listOutstanding(env);
      if (path === '/api/v3/expenses' && request.method === 'GET') return listExpenses(url, env);
      if (path === '/api/v3/expenses' && request.method === 'POST') return createExpense(request, env);
      if (/^\/api\/v3\/expenses\/\d+$/.test(path) && request.method === 'PATCH') return updateExpense(request, url, env);
      if (/^\/api\/v3\/expenses\/\d+$/.test(path) && request.method === 'DELETE') return deleteExpense(url, env);
      if (path === '/api/v3/other-income' && request.method === 'GET') return listOtherIncome(url, env);
      if (path === '/api/v3/other-income' && request.method === 'POST') return createOtherIncome(request, env);
      if (path === '/api/v3/cash-check' && request.method === 'GET') return getCashCheck(url, env);
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
  if (!env.APP_PASSCODE || !env.SESSION_SECRET) return json({error:'الأمان غير مُعد. أضف APP_PASSCODE و SESSION_SECRET.'},503);
  const body = await safeJson(request);
  if (!body?.passcode || !(await safeEqual(String(body.passcode), String(env.APP_PASSCODE)))) return json({error:'الرمز غير صحيح'},401);
  const exp = Math.floor(Date.now()/1000) + SESSION_MAX_AGE;
  const payload = btoa(JSON.stringify({exp}));
  const sig = await hmac(payload, env.SESSION_SECRET);
  const token = `${toBase64Url(payload)}.${sig}`;
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return new Response(JSON.stringify({ok:true}), { status:200, headers:{...JSON_HEADERS,'set-cookie':`sozan_session=${token}; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=${SESSION_MAX_AGE}`} });
}

async function requireAuth(request, env) {
  if (!env.APP_PASSCODE || !env.SESSION_SECRET) return json({error:'التطبيق غير مؤمّن بعد. أضف أسرار الدخول قبل الاستخدام.'},503);
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|;\s*)sozan_session=([^;]+)/);
  if (!match) return json({error:'AUTH_REQUIRED'},401);
  const [payloadB64,sig] = match[1].split('.');
  if (!payloadB64 || !sig) return json({error:'AUTH_REQUIRED'},401);
  const payload = fromBase64Url(payloadB64);
  const expected = await hmac(payload, env.SESSION_SECRET);
  if (!(await safeEqual(sig, expected))) return json({error:'AUTH_REQUIRED'},401);
  try { const data=JSON.parse(atob(payload)); if (!data.exp || data.exp < Math.floor(Date.now()/1000)) return json({error:'AUTH_REQUIRED'},401); }
  catch { return json({error:'AUTH_REQUIRED'},401); }
  return null;
}

async function v3Dashboard(url, env) {
  const date = sanitizeDate(url.searchParams.get('date')) || todayISO();
  return json(await buildDashboardData(env.DB, date));
}

async function buildDashboardData(db, date) {
  await ensureOccurrencesForDateV3(db, date);
  const month = date.slice(0,7);
  const sessions = await db.prepare(`
    SELECT o.id,
           o.session_date AS original_session_date,
           COALESCE(o.rescheduled_to_date,o.session_date) AS session_date,
           o.status,o.gross_pence,o.center_cut_pence,o.earned_pence,
           o.rescheduled_to_date,o.rescheduled_to_start,o.rescheduled_at,o.reschedule_note,
           COALESCE(o.rescheduled_to_start,o.scheduled_start,r.start_time) AS start_time,
           r.title,r.session_type,r.duration_minutes,r.travel_minutes,r.student_count,r.location,
           COALESCE((SELECT SUM(p.amount_pence) FROM payments_v3 p WHERE p.occurrence_id=o.id AND p.reversed_at IS NULL),0) paid_pence
    FROM session_occurrences_v3 o
    JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id
    WHERE COALESCE(o.rescheduled_to_date,o.session_date)=?1
    ORDER BY COALESCE(o.rescheduled_to_start,o.scheduled_start,r.start_time),o.id
  `).bind(date).all();

  const earned = await db.prepare(`SELECT COALESCE(SUM(earned_pence),0) value FROM session_occurrences_v3 WHERE substr(COALESCE(rescheduled_to_date,session_date),1,7)=?1 AND status='completed'`).bind(month).first();
  const receivedLessons = await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) value FROM payments_v3 WHERE reversed_at IS NULL AND substr(paid_at,1,7)=?1`).bind(month).first();
  const otherIncome = await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) value FROM other_income_v3 WHERE substr(income_date,1,7)=?1`).bind(month).first();
  const expenses = await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) total,COALESCE(SUM(CASE WHEN scope='business' THEN amount_pence ELSE 0 END),0) business,COALESCE(SUM(CASE WHEN scope='personal' THEN amount_pence ELSE 0 END),0) personal FROM expenses_v3 WHERE substr(expense_date,1,7)=?1`).bind(month).first();
  const outstanding = await db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN o.status='completed' THEN MAX(0,o.earned_pence-COALESCE((SELECT SUM(p.amount_pence) FROM payments_v3 p WHERE p.occurrence_id=o.id AND p.reversed_at IS NULL),0)) ELSE 0 END),0) value
    FROM session_occurrences_v3 o
  `).first();
  const time = await db.prepare(`
    SELECT COALESCE(SUM(r.duration_minutes),0) teaching_minutes,COALESCE(SUM(r.travel_minutes),0) travel_minutes
    FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id
    WHERE substr(COALESCE(o.rescheduled_to_date,o.session_date),1,7)=?1 AND o.status='completed'
  `).bind(month).first();
  const categories = await db.prepare(`SELECT scope,category,SUM(amount_pence) amount_pence FROM expenses_v3 WHERE substr(expense_date,1,7)=?1 GROUP BY scope,category ORDER BY amount_pence DESC`).bind(month).all();
  const expectedBalance = await calculateExpectedBalance(db);
  const lastCheck = await db.prepare(`SELECT * FROM cash_checks_v3 ORDER BY check_date DESC,id DESC LIMIT 1`).first();
  const received = Number(receivedLessons?.value||0)+Number(otherIncome?.value||0);
  const expenseTotal = Number(expenses?.total||0);
  const businessExpenses = Number(expenses?.business||0);
  const realMinutes = Number(time?.teaching_minutes||0)+Number(time?.travel_minutes||0);
  const businessProfit = Number(earned?.value||0)-businessExpenses;
  return {
    date,month,
    sessions:(sessions.results||[]).map(s=>({...s,outstanding_pence:Math.max(0,Number(s.earned_pence||0)-Number(s.paid_pence||0))})),
    expense_categories:categories.results||[], last_cash_check:lastCheck||null,
    summary:{
      earned_pence:Number(earned?.value||0),received_lessons_pence:Number(receivedLessons?.value||0),other_income_pence:Number(otherIncome?.value||0),received_total_pence:received,
      expenses_pence:expenseTotal,business_expenses_pence:businessExpenses,personal_expenses_pence:Number(expenses?.personal||0),month_left_pence:received-expenseTotal,
      outstanding_pence:Number(outstanding?.value||0),teaching_minutes:Number(time?.teaching_minutes||0),travel_minutes:Number(time?.travel_minutes||0),
      true_hourly_pence:realMinutes>0?Math.round((businessProfit*60)/realMinutes):0,expected_balance_pence:expectedBalance
    }
  };
}

async function ensureOccurrencesForDateV3(db,date) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const rows = await db.prepare(`SELECT * FROM recurring_sessions_v3 WHERE active=1 AND weekday=?1`).bind(weekday).all();
  for (const r of rows.results||[]) {
    const gross=sessionGross(r); const cut=Math.round(gross*Number(r.center_cut_percent||0)/100);
    await db.prepare(`INSERT OR IGNORE INTO session_occurrences_v3(recurring_session_id,session_date,scheduled_start,status,gross_pence,center_cut_pence,earned_pence) VALUES(?1,?2,?3,'scheduled',?4,?5,0)`).bind(r.id,date,r.start_time,gross,cut).run();
  }
}
function sessionGross(r){const price=Number(r.price_pence||0),count=Math.max(1,Number(r.student_count||1));return r.price_basis==='per_student'?price*count:price;}

async function listStudents(env){const rows=await env.DB.prepare(`SELECT * FROM students_v3 WHERE active=1 ORDER BY name COLLATE NOCASE`).all();return json({students:rows.results||[]});}
async function createStudent(request,env){const b=await safeJson(request),name=String(b?.name||'').trim();if(!name)return json({error:'اكتبي اسم الطالب'},400);const result=await env.DB.prepare(`INSERT INTO students_v3(name,age,level,notes) VALUES(?1,?2,?3,?4)`).bind(name.slice(0,100),nullableInt(b?.age),nullableText(b?.level),nullableText(b?.notes)).run();return json({ok:true,id:result.meta?.last_row_id},201);}
async function updateStudent(request,url,env){const id=Number(url.pathname.split('/').pop()),b=await safeJson(request),existing=await env.DB.prepare(`SELECT * FROM students_v3 WHERE id=?1`).bind(id).first();if(!existing)return json({error:'الطالب غير موجود'},404);const name=String(b?.name??existing.name).trim();await env.DB.prepare(`UPDATE students_v3 SET name=?1,age=?2,level=?3,notes=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?5`).bind(name.slice(0,100),b?.age===undefined?existing.age:nullableInt(b.age),b?.level===undefined?existing.level:nullableText(b.level),b?.notes===undefined?existing.notes:nullableText(b.notes),id).run();return json({ok:true});}

async function listSessions(env){const rows=await env.DB.prepare(`SELECT r.*,s.name student_name,s.age student_age,s.level student_level FROM recurring_sessions_v3 r LEFT JOIN students_v3 s ON s.id=r.student_id WHERE r.active=1 ORDER BY r.weekday,r.start_time,r.id`).all();return json({sessions:rows.results||[]});}
async function createSession(request,env){
  const b=await safeJson(request),title=String(b?.title||b?.student_name||'').trim();
  if(!title)return json({error:'اكتبي اسم الطالب أو المجموعة'},400); if(!SESSION_TYPES.has(b?.session_type))return json({error:'نوع الحصة غير صالح'},400);
  let studentId=nullablePositiveInt(b?.student_id);
  if(!studentId&&b?.student_name&&!['center_group','own_group'].includes(b.session_type)){const c=await env.DB.prepare(`INSERT INTO students_v3(name,age,level) VALUES(?1,?2,?3)`).bind(String(b.student_name).trim().slice(0,100),nullableInt(b.age),nullableText(b.level)).run();studentId=Number(c.meta?.last_row_id||0)||null;}
  const v=normalizeSessionBody(b); const result=await env.DB.prepare(`INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_type,price_basis,price_pence,student_count,center_cut_percent,travel_minutes,location) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`).bind(studentId,title.slice(0,120),b.session_type,v.weekday,v.start_time,v.duration_minutes,v.price_type,v.price_basis,v.price_pence,v.student_count,v.center_cut_percent,v.travel_minutes,v.location).run();
  return json({ok:true,id:result.meta?.last_row_id},201);
}

async function updateSession(request,url,env){
  const id=Number(url.pathname.split('/').pop()); const existing=await env.DB.prepare(`SELECT * FROM recurring_sessions_v3 WHERE id=?1 AND active=1`).bind(id).first();
  if(!existing)return json({error:'الحصة غير موجودة'},404);
  const b=await safeJson(request),merged={...existing,...b},title=String(merged.title||'').trim();
  if(!title)return json({error:'اسم الحصة مطلوب'},400); if(!SESSION_TYPES.has(merged.session_type))return json({error:'نوع الحصة غير صالح'},400);
  const v=normalizeSessionBody({...merged,price:b?.price??penceToMoney(existing.price_pence)});
  await env.DB.prepare(`UPDATE recurring_sessions_v3 SET title=?1,session_type=?2,weekday=?3,start_time=?4,duration_minutes=?5,price_type=?6,price_basis=?7,price_pence=?8,student_count=?9,center_cut_percent=?10,travel_minutes=?11,location=?12,updated_at=CURRENT_TIMESTAMP WHERE id=?13`).bind(title.slice(0,120),merged.session_type,v.weekday,v.start_time,v.duration_minutes,v.price_type,v.price_basis,v.price_pence,v.student_count,v.center_cut_percent,v.travel_minutes,v.location,id).run();
  const gross=v.price_basis==='per_student'?v.price_pence*v.student_count:v.price_pence; const cut=Math.round(gross*v.center_cut_percent/100);
  await env.DB.prepare(`UPDATE session_occurrences_v3 SET gross_pence=?1,center_cut_pence=?2,updated_at=CURRENT_TIMESTAMP WHERE recurring_session_id=?3 AND status='scheduled' AND rescheduled_to_date IS NOT NULL`).bind(gross,cut,id).run();
  await env.DB.prepare(`DELETE FROM session_occurrences_v3 WHERE recurring_session_id=?1 AND session_date>=?2 AND status='scheduled' AND rescheduled_to_date IS NULL AND NOT EXISTS(SELECT 1 FROM payments_v3 p WHERE p.occurrence_id=session_occurrences_v3.id AND p.reversed_at IS NULL)`).bind(id,todayISO()).run();
  return json({ok:true,future_only:true});
}

function normalizeSessionBody(b){const priceType=['per_session','monthly'].includes(b?.price_type)?b.price_type:'per_session',priceBasis=['total_session','per_student'].includes(b?.price_basis)?b.price_basis:'total_session';return{weekday:clampInt(b?.weekday,0,6),start_time:normalizeTime(b?.start_time),duration_minutes:clampInt(b?.duration_minutes??60,15,360),price_type:priceType,price_basis:priceBasis,price_pence:moneyToPence(b?.price??b?.price_amount??0),student_count:clampInt(b?.student_count??1,1,100),center_cut_percent:clampNumber(b?.center_cut_percent??0,0,100),travel_minutes:clampInt(b?.travel_minutes??0,0,360),location:nullableText(b?.location)};}
async function disableSession(url,env){const id=Number(url.pathname.split('/').pop());await env.DB.prepare(`UPDATE recurring_sessions_v3 SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?1`).bind(id).run();return json({ok:true});}

async function activePaidAmount(db,id){const row=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) paid FROM payments_v3 WHERE occurrence_id=?1 AND reversed_at IS NULL`).bind(id).first();return Number(row?.paid||0);}

async function handleOccurrenceAction(request,env,id,action){
  const b=await safeJson(request)||{}; const row=await env.DB.prepare(`SELECT o.*,r.title FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE o.id=?1`).bind(id).first();
  if(!row)return json({error:'الحصة غير موجودة'},404); const alreadyPaid=await activePaidAmount(env.DB,id);
  if(action==='cancel'){
    if(alreadyPaid>0)return json({error:'الحصة عليها تحصيل مسجل. صححي التحصيل أولًا ثم ألغِي الحصة.'},409);
    if(row.status==='completed')return json({error:'الحصة مكتملة بالفعل. صححي حالتها قبل الإلغاء.'},409);
    await env.DB.prepare(`UPDATE session_occurrences_v3 SET status='cancelled',earned_pence=0,completed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?1`).bind(id).run();
    return json({ok:true});
  }
  if(action==='restore'){
    if(row.status!=='cancelled')return json({error:'الحصة ليست ملغاة'},409);
    await env.DB.prepare(`UPDATE session_occurrences_v3 SET status='scheduled',earned_pence=0,completed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?1`).bind(id).run();
    return json({ok:true});
  }
  if(action==='complete-paid'||action==='complete-unpaid'){
    if(row.status==='cancelled')return json({error:'الحصة ملغاة. ارجعيها للجدول أولًا.'},409);
    const earned=Math.max(0,Number(row.gross_pence||0)-Number(row.center_cut_pence||0));
    await env.DB.prepare(`UPDATE session_occurrences_v3 SET status='completed',earned_pence=?1,completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=?2`).bind(earned,id).run();
    if(action==='complete-paid'){
      const remainder=Math.max(0,earned-alreadyPaid);
      if(remainder>0){const paidAt=sanitizeDate(b?.paid_at)||row.rescheduled_to_date||row.session_date||todayISO();await env.DB.prepare(`INSERT INTO payments_v3(occurrence_id,amount_pence,paid_at,payment_method,note) VALUES(?1,?2,?3,?4,?5)`).bind(id,remainder,paidAt,normalizePaymentMethod(b?.payment_method),nullableText(b?.note)).run();}
    }
    return json({ok:true});
  }
  if(action==='collect'){
    if(row.status!=='completed')return json({error:'الحصة لم تُسجل كمكتملة بعد'},409); const outstanding=Math.max(0,Number(row.earned_pence||0)-alreadyPaid);
    if(outstanding<=0)return json({error:'الحصة مدفوعة بالكامل بالفعل'},409); const amount=b?.amount?moneyToPence(b.amount):outstanding;
    if(amount<=0||amount>outstanding)return json({error:'قيمة التحصيل غير صحيحة'},400);
    await env.DB.prepare(`INSERT INTO payments_v3(occurrence_id,amount_pence,paid_at,payment_method,note) VALUES(?1,?2,?3,?4,?5)`).bind(id,amount,sanitizeDate(b?.paid_at)||todayISO(),normalizePaymentMethod(b?.payment_method),nullableText(b?.note)).run();
    return json({ok:true});
  }
  return json({error:'إجراء غير صالح'},400);
}

async function rescheduleOccurrence(request,env,id){
  const b=await safeJson(request)||{}; const targetDate=sanitizeDate(b?.date),targetTime=normalizeTimeStrict(b?.time);
  if(!targetDate||!targetTime)return json({error:'اختاري اليوم والساعة الجديدة'},400);
  const row=await env.DB.prepare(`SELECT * FROM session_occurrences_v3 WHERE id=?1`).bind(id).first();
  if(!row)return json({error:'الحصة غير موجودة'},404);
  if(row.status!=='scheduled')return json({error:'يمكن نقل الحصة قبل تنفيذها أو إلغائها فقط'},409);
  if(await activePaidAmount(env.DB,id)>0)return json({error:'الحصة عليها تحصيل مسجل ولا يمكن نقلها'},409);
  const conflict=await env.DB.prepare(`SELECT id FROM session_occurrences_v3 WHERE recurring_session_id=?1 AND id<>?2 AND COALESCE(rescheduled_to_date,session_date)=?3 AND status<>'cancelled' LIMIT 1`).bind(row.recurring_session_id,id,targetDate).first();
  if(conflict)return json({error:'يوجد بالفعل موعد آخر لنفس الحصة في اليوم الجديد'},409);
  const originalTime=row.scheduled_start||'09:00';
  if(targetDate===row.session_date && targetTime===originalTime){
    await env.DB.prepare(`UPDATE session_occurrences_v3 SET rescheduled_to_date=NULL,rescheduled_to_start=NULL,rescheduled_at=NULL,reschedule_note=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?1`).bind(id).run();
    return json({ok:true,restored_original:true});
  }
  await env.DB.prepare(`UPDATE session_occurrences_v3 SET rescheduled_to_date=?1,rescheduled_to_start=?2,rescheduled_at=CURRENT_TIMESTAMP,reschedule_note=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?4`).bind(targetDate,targetTime,nullableText(b?.note),id).run();
  return json({ok:true,date:targetDate,time:targetTime});
}

async function correctOccurrencePayment(request,env,id){
  const b=await safeJson(request)||{}; const row=await env.DB.prepare(`SELECT * FROM session_occurrences_v3 WHERE id=?1`).bind(id).first();
  if(!row)return json({error:'الحصة غير موجودة'},404); if(row.status!=='completed')return json({error:'تصحيح الدفع متاح للحصص المكتملة فقط'},409);
  const target=moneyToPenceAllowZero(b?.received_total); const earned=Number(row.earned_pence||0);
  if(target===null)return json({error:'اكتبي المبلغ الصحيح الذي تم تحصيله'},400); if(target>earned)return json({error:'المبلغ المحصل لا يمكن أن يتجاوز المستحق للحصة'},400);
  const active=await env.DB.prepare(`SELECT * FROM payments_v3 WHERE occurrence_id=?1 AND reversed_at IS NULL ORDER BY paid_at,id`).bind(id).all();
  const current=(active.results||[]).reduce((s,p)=>s+Number(p.amount_pence||0),0);
  if(current===target)return json({ok:true,unchanged:true});
  const reason=nullableText(b?.reason)||'تصحيح التحصيل';
  await env.DB.prepare(`UPDATE payments_v3 SET reversed_at=CURRENT_TIMESTAMP,reversal_reason=?1 WHERE occurrence_id=?2 AND reversed_at IS NULL`).bind(reason,id).run();
  if(target>0){const fallbackDate=(active.results||[])[0]?.paid_at||todayISO();await env.DB.prepare(`INSERT INTO payments_v3(occurrence_id,amount_pence,paid_at,payment_method,note) VALUES(?1,?2,?3,?4,?5)`).bind(id,target,sanitizeDate(b?.paid_at)||fallbackDate,normalizePaymentMethod(b?.payment_method),`قيمة مصححة${b?.note?` - ${String(b.note).slice(0,180)}`:''}`).run();}
  return json({ok:true,previous_pence:current,received_pence:target,outstanding_pence:Math.max(0,earned-target)});
}

async function listOccurrencePayments(env,id){const rows=await env.DB.prepare(`SELECT id,amount_pence,paid_at,payment_method,note,reversed_at,reversal_reason,created_at FROM payments_v3 WHERE occurrence_id=?1 ORDER BY id DESC`).bind(id).all();return json({payments:rows.results||[]});}

async function listOutstanding(env){
  const rows=await env.DB.prepare(`SELECT o.id occurrence_id,COALESCE(o.rescheduled_to_date,o.session_date) session_date,o.earned_pence,r.title,r.session_type,COALESCE((SELECT SUM(p.amount_pence) FROM payments_v3 p WHERE p.occurrence_id=o.id AND p.reversed_at IS NULL),0) paid_pence FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE o.status='completed' AND o.earned_pence>COALESCE((SELECT SUM(p.amount_pence) FROM payments_v3 p WHERE p.occurrence_id=o.id AND p.reversed_at IS NULL),0) ORDER BY COALESCE(o.rescheduled_to_date,o.session_date),o.id`).all();
  const items=(rows.results||[]).map(r=>({...r,outstanding_pence:Math.max(0,Number(r.earned_pence||0)-Number(r.paid_pence||0))}));return json({items,total_pence:items.reduce((s,x)=>s+x.outstanding_pence,0)});
}

async function listExpenses(url,env){const month=validMonth(url.searchParams.get('month'))||todayISO().slice(0,7);const rows=await env.DB.prepare(`SELECT * FROM expenses_v3 WHERE substr(expense_date,1,7)=?1 ORDER BY expense_date DESC,id DESC LIMIT 250`).bind(month).all();return json({month,expenses:rows.results||[]});}
async function createExpense(request,env){const b=await safeJson(request),e=normalizeExpenseBody(b);if(e.error)return json({error:e.error},400);const r=await env.DB.prepare(`INSERT INTO expenses_v3(expense_date,scope,category,amount_pence,note) VALUES(?1,?2,?3,?4,?5)`).bind(e.date,e.scope,e.category,e.amount_pence,e.note).run();return json({ok:true,id:r.meta?.last_row_id},201);}
async function updateExpense(request,url,env){const id=Number(url.pathname.split('/').pop()),x=await env.DB.prepare(`SELECT * FROM expenses_v3 WHERE id=?1`).bind(id).first();if(!x)return json({error:'المصروف غير موجود'},404);const b=await safeJson(request),e=normalizeExpenseBody({date:b?.date??x.expense_date,scope:b?.scope??x.scope,category:b?.category??x.category,amount:b?.amount??penceToMoney(x.amount_pence),note:b?.note??x.note});if(e.error)return json({error:e.error},400);await env.DB.prepare(`UPDATE expenses_v3 SET expense_date=?1,scope=?2,category=?3,amount_pence=?4,note=?5,updated_at=CURRENT_TIMESTAMP WHERE id=?6`).bind(e.date,e.scope,e.category,e.amount_pence,e.note,id).run();return json({ok:true});}
async function deleteExpense(url,env){const id=Number(url.pathname.split('/').pop());await env.DB.prepare(`DELETE FROM expenses_v3 WHERE id=?1`).bind(id).run();return json({ok:true});}
function normalizeExpenseBody(b){const scope=b?.scope==='personal'?'personal':'business',category=String(b?.category||''),allowed=scope==='business'?BUSINESS_EXPENSE_CATEGORIES:PERSONAL_EXPENSE_CATEGORIES;if(!allowed.has(category))return{error:'فئة المصروف لا تناسب نوعه'};const amount=moneyToPence(b?.amount);if(amount<=0)return{error:'اكتبي مبلغًا أكبر من صفر'};return{date:sanitizeDate(b?.date)||todayISO(),scope,category,amount_pence:amount,note:nullableText(b?.note)};}
async function listOtherIncome(url,env){const month=validMonth(url.searchParams.get('month'))||todayISO().slice(0,7),rows=await env.DB.prepare(`SELECT * FROM other_income_v3 WHERE substr(income_date,1,7)=?1 ORDER BY income_date DESC,id DESC`).bind(month).all();return json({month,income:rows.results||[]});}
async function createOtherIncome(request,env){const b=await safeJson(request),category=OTHER_INCOME_CATEGORIES.has(b?.category)?b.category:'other',amount=moneyToPence(b?.amount);if(amount<=0)return json({error:'اكتبي مبلغًا أكبر من صفر'},400);const r=await env.DB.prepare(`INSERT INTO other_income_v3(income_date,category,amount_pence,note) VALUES(?1,?2,?3,?4)`).bind(sanitizeDate(b?.date)||todayISO(),category,amount,nullableText(b?.note)).run();return json({ok:true,id:r.meta?.last_row_id},201);}

async function calculateExpectedBalance(db){const o=await db.prepare(`SELECT value FROM settings_v3 WHERE key='opening_balance_pence'`).first(),lesson=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) value FROM payments_v3 WHERE reversed_at IS NULL`).first(),other=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) value FROM other_income_v3`).first(),expense=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) value FROM expenses_v3`).first();return Number(o?.value||0)+Number(lesson?.value||0)+Number(other?.value||0)-Number(expense?.value||0);}
async function getCashCheck(url,env){const expected=await calculateExpectedBalance(env.DB),last=await env.DB.prepare(`SELECT * FROM cash_checks_v3 ORDER BY check_date DESC,id DESC LIMIT 1`).first();return json({expected_balance_pence:expected,last_check:last||null});}
async function createCashCheck(request,env){const b=await safeJson(request),actual=moneyToSignedPence(b?.actual_balance);if(!Number.isFinite(actual))return json({error:'اكتبي الرصيد الموجود فعليًا'},400);const expected=await calculateExpectedBalance(env.DB),difference=actual-expected,date=sanitizeDate(b?.date)||todayISO(),r=await env.DB.prepare(`INSERT INTO cash_checks_v3(check_date,expected_balance_pence,actual_balance_pence,difference_pence,note) VALUES(?1,?2,?3,?4,?5)`).bind(date,expected,actual,difference,nullableText(b?.note)).run();return json({ok:true,id:r.meta?.last_row_id,expected_balance_pence:expected,actual_balance_pence:actual,difference_pence:difference,unrecorded_spending_pence:Math.max(0,expected-actual),unrecorded_income_pence:Math.max(0,actual-expected)},201);}
async function getSettings(env){const rows=await env.DB.prepare(`SELECT key,value FROM settings_v3`).all();return json({settings:Object.fromEntries((rows.results||[]).map(r=>[r.key,r.value]))});}
async function updateSettings(request,env){const b=await safeJson(request),allowed={};if(b?.opening_balance!==undefined)allowed.opening_balance_pence=String(moneyToSignedPence(b.opening_balance));if(b?.sozan_display_name!==undefined)allowed.sozan_display_name=String(b.sozan_display_name||'سوزان').trim().slice(0,50)||'سوزان';if(b?.cash_check_frequency_days!==undefined)allowed.cash_check_frequency_days=String(clampInt(b.cash_check_frequency_days,1,60));for(const[k,v]of Object.entries(allowed))await env.DB.prepare(`INSERT INTO settings_v3(key,value,updated_at) VALUES(?1,?2,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(k,v).run();return json({ok:true});}

async function getInsights(url,env){const date=sanitizeDate(url.searchParams.get('date'))||todayISO(),current=await buildDashboardData(env.DB,date),previous=await buildDashboardData(env.DB,previousMonthDate(date)),insights=[],s=current.summary,prev=previous.summary;if(s.outstanding_pence>0)insights.push({tone:'attention',title:'في فلوس لسه ما اتحصلتش',text:`عندك ${moneyText(s.outstanding_pence)} من حصص تمت ولسه ما اتدفعتش.`});if(s.received_total_pence>0){const ratio=s.expenses_pence/s.received_total_pence;if(ratio>=.8)insights.push({tone:'attention',title:'المصروف قريب من الدخل',text:`صرفتي حوالي ${Math.round(ratio*100)}% من اللي قبضتيه هذا الشهر.`});}const top=current.expense_categories?.[0];if(top&&Number(top.amount_pence||0)>0)insights.push({tone:'info',title:'أكبر باب صرف',text:`${expenseCategoryLabel(top.category)} هو أكبر بند مسجل: ${moneyText(top.amount_pence)}.`});if(prev.received_total_pence>0){const change=((s.received_total_pence-prev.received_total_pence)/prev.received_total_pence)*100;if(Math.abs(change)>=10)insights.push({tone:change>0?'good':'attention',title:'مقارنة بالشهر اللي فات',text:`التحصيل ${change>0?'أعلى':'أقل'} بحوالي ${Math.abs(Math.round(change))}%.`});}if(s.true_hourly_pence>0)insights.push({tone:'good',title:'العائد الحقيقي للساعة',text:`متوسط صافي عائد ساعة الشغل مع وقت الانتقال حوالي ${moneyText(s.true_hourly_pence)}.`});if(!insights.length)insights.push({tone:'info',title:'لسه بنبني الصورة',text:'سجلي الحصص والمصروفات لأيام قليلة، وبعدها التحليل هيبقى أوضح وأدق.'});return json({date,insights:insights.slice(0,5)});}

function expenseCategoryLabel(category){return({work_transport:'مواصلات الشغل',books_printing:'كتب وطباعة',teaching_supplies:'أدوات تعليم',work_internet:'إنترنت الشغل',center_fees:'مصاريف السنتر',study_materials:'مواد دراسية',other_business:'مصروف شغل آخر',home:'البيت',food:'الأكل',personal_transport:'مواصلات شخصية',bills:'فواتير',children:'الأطفال',commitments:'التزامات',personal_shopping:'شراء شخصي',health:'الصحة',other_personal:'مصروف شخصي آخر'})[category]||'أخرى';}
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
