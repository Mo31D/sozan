import app from './billing-guard.js';
import { ensureMonthlyDuesThroughMonth, rebalanceStudentsWithMonthly, rebalanceStudentAll } from './billing.js';

export { ensureMonthlyDuesThroughMonth, rebalanceStudentsWithMonthly };

const JSON_HEADERS = { 'content-type':'application/json; charset=utf-8' };
const PENDING_TTL_SECONDS = 30;
const REPLAY_WINDOW_SECONDS = 3;
const POLL_ATTEMPTS = 40;
const POLL_MS = 250;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Monthly billing is a student-level plan. A second weekly slot for the same
    // student inherits the existing monthly plan instead of creating mixed billing.
    if (path === '/api/v3/sessions' && method === 'POST') {
      return createSessionWithBillingInheritance(request, env, ctx);
    }

    // Make all occurrence-changing actions idempotent. The paid-completion path is
    // handled here so a receipt already allocated to a monthly due can never be
    // re-used as credit for a per-session lesson.
    const action = path.match(/^\/api\/v3\/occurrences\/(\d+)\/(complete-paid|complete-unpaid|cancel|restore|reopen|collect)$/);
    if (action && method === 'POST') {
      return dedupeMutation(request, env, ctx, req => handleOccurrenceAction(req, env, ctx, Number(action[1]), action[2]));
    }
    if (/^\/api\/v3\/occurrences\/\d+\/(reschedule|correct-payment)$/.test(path) && method === 'POST') {
      return dedupeMutation(request, env, ctx, req => app.fetch(req, env, ctx));
    }
    if (/^\/api\/v4\/restore\/(expense|other_income|receipt)\/\d+$/.test(path) && method === 'POST') {
      return dedupeMutation(request, env, ctx, req => app.fetch(req, env, ctx));
    }

    // The older receipt API calculates credit before the monthly ledger sees the
    // receipt. Correct the response after the combined rebalance so the toast and
    // account UI show the true allocated/credit values.
    if (path === '/api/v4/receipts' && method === 'POST') {
      const response = await app.fetch(request, env, ctx);
      return response.ok ? correctReceiptResponse(response, env) : response;
    }
    const receiptMutation = path.match(/^\/api\/v4\/receipts\/(\d+)$/);
    if (receiptMutation && method === 'PATCH') {
      const response = await app.fetch(request, env, ctx);
      return response.ok ? correctReceiptResponse(response, env, Number(receiptMutation[1])) : response;
    }

    // Add billing type to student timeline items so the UI never describes a
    // monthly lesson as "paid" merely because its per-occurrence earned value is 0.
    const account = path.match(/^\/api\/v4\/students\/(\d+)\/account$/);
    if (account && method === 'GET') {
      const response = await app.fetch(request, env, ctx);
      if (!response.ok) return response;
      const data = await response.json();
      return json(await annotateStudentAccount(env.DB, data, Number(account[1])));
    }

    // Base insights pre-date monthly billing; return one consistent monthly-aware
    // view instead of mixing the old occurrence-only totals with the new ledger.
    if (path === '/api/v3/insights' && method === 'GET') {
      const auth = await authProbe(request, env, ctx);
      if (auth) return auth;
      return monthlyAwareInsights(url, env.DB);
    }

    return app.fetch(request, env, ctx);
  }
};

async function createSessionWithBillingInheritance(request, env, ctx) {
  const body = await safeBody(request);
  if (!body) return app.fetch(request, env, ctx);
  let studentId = positiveInt(body.student_id);
  if (!studentId) {
    const name = String(body.student_name || body.title || '').trim();
    if (name) {
      const s = await env.DB.prepare(`SELECT id FROM students_v3 WHERE active=1 AND deleted_at IS NULL AND lower(trim(name))=lower(trim(?1)) ORDER BY id LIMIT 1`).bind(name).first();
      studentId = Number(s?.id || 0);
    }
  }
  if (!studentId) return app.fetch(request, env, ctx);

  const plan = await env.DB.prepare(`SELECT price_pence,billing_day FROM recurring_sessions_v3 WHERE active=1 AND student_id=?1 AND price_type='monthly' ORDER BY id LIMIT 1`).bind(studentId).first();
  if (!plan || body.price_type === 'monthly') return app.fetch(request, env, ctx);

  const amended = {
    ...body,
    student_id: studentId,
    price_type: 'monthly',
    price: Number(plan.price_pence || 0) / 100,
    billing_day: Number(plan.billing_day || 1)
  };
  const req = jsonRequest(request, amended);
  const response = await app.fetch(req, env, ctx);
  if (!response.ok) return response;
  const data = await response.json().catch(() => ({}));
  return json({ ...data, inherited_monthly:true }, response.status);
}

async function handleOccurrenceAction(request, env, ctx, id, action) {
  const row = await occurrenceRow(env.DB, id);
  if (!row) return json({ error:'الحصة غير موجودة' }, 404);

  if (row.price_type === 'monthly') {
    return app.fetch(request, env, ctx);
  }
  if (action === 'complete-paid' || action === 'complete-unpaid') {
    const auth = await authProbe(request, env, ctx);
    if (auth) return auth;
    return completePerSession(request, env.DB, row, action);
  }
  if (action === 'collect') {
    const auth = await authProbe(request, env, ctx);
    if (auth) return auth;
    return collectPerSession(request, env.DB, row);
  }
  return app.fetch(request, env, ctx);
}

async function completePerSession(request, db, row, action) {
  if (row.status === 'completed') {
    const paid = await occurrencePaid(db, row.id);
    return json({ ok:true, unchanged:true, earned_pence:Number(row.earned_pence || 0), paid_pence:paid, outstanding_pence:Math.max(0, Number(row.earned_pence || 0) - paid) });
  }
  if (row.status !== 'scheduled') return json({ error:'الحصة مش مجدولة حاليًا' }, 409);

  const earned = Math.max(0, Number(row.gross_pence || 0) - Number(row.center_cut_pence || 0));
  await db.prepare(`UPDATE session_occurrences_v3 SET status='completed',earned_pence=?1,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND status='scheduled'`).bind(earned,row.id).run();
  if (row.student_id) await rebalanceStudentAll(db, Number(row.student_id));

  let paid = await occurrencePaid(db, row.id);
  if (action === 'complete-paid') {
    const body = await safeBody(request) || {};
    const remainder = Math.max(0, earned - paid);
    if (remainder > 0) {
      await db.prepare(`INSERT INTO payments_v3(occurrence_id,amount_pence,paid_at,payment_method,note) VALUES(?1,?2,?3,?4,?5)`).bind(row.id,remainder,validDate(body.paid_at) || effectiveDate(row),paymentMethod(body.payment_method),'دفع مباشر من الحصة').run();
    }
    paid = await occurrencePaid(db, row.id);
  }

  await db.prepare(`INSERT INTO activity_events_v4(entity_type,entity_id,action,title,detail,undoable) VALUES('occurrence',?1,'completed',?2,?3,0)`).bind(row.id,`تمت حصة ${row.title}`,paid>=earned?'اتدفعت بالكامل':`باقي ${moneyText(Math.max(0,earned-paid))}`).run();
  return json({ ok:true, earned_pence:earned, paid_pence:paid, outstanding_pence:Math.max(0,earned-paid) });
}

async function collectPerSession(request, db, row) {
  if (row.status !== 'completed') return json({ error:'الحصة لم تكتمل بعد' }, 409);
  if (row.student_id) await rebalanceStudentAll(db, Number(row.student_id));
  const already = await occurrencePaid(db, row.id);
  const due = Math.max(0, Number(row.earned_pence || 0) - already);
  if (due <= 0) return json({ error:'الحصة مدفوعة بالكامل بالفعل' }, 409);
  const body = await safeBody(request) || {};
  const requested = body.amount === undefined || body.amount === '' ? due : moneyToPence(body.amount);
  if (!requested || requested > due) return json({ error:'قيمة التحصيل غير صحيحة' }, 400);
  await db.prepare(`INSERT INTO payments_v3(occurrence_id,amount_pence,paid_at,payment_method,note) VALUES(?1,?2,?3,?4,?5)`).bind(row.id,requested,validDate(body.paid_at) || londonDateISO(),paymentMethod(body.payment_method),text(body.note) || 'تحصيل مباشر').run();
  await db.prepare(`INSERT INTO activity_events_v4(entity_type,entity_id,action,title,detail,undoable) VALUES('payment',?1,'collected',?2,?3,0)`).bind(row.id,`تحصيل ${row.title}`,moneyText(requested)).run();
  return json({ ok:true, paid_pence:already+requested, outstanding_pence:Math.max(0,due-requested) });
}

async function correctReceiptResponse(response, env, forcedId=0) {
  const data = await response.json().catch(() => ({}));
  const id = Number(forcedId || data.id || 0);
  if (!id) return json(data, response.status);
  const r = await env.DB.prepare(`SELECT amount_pence FROM student_receipts_v4 WHERE id=?1 AND deleted_at IS NULL`).bind(id).first();
  if (!r) return json(data, response.status);
  const occurrence = await env.DB.prepare(`SELECT COALESCE(SUM(amount_pence),0) value FROM receipt_allocations_v4 WHERE receipt_id=?1`).bind(id).first();
  const monthly = await env.DB.prepare(`SELECT COALESCE(SUM(amount_pence),0) value FROM monthly_due_allocations_v5 WHERE receipt_id=?1`).bind(id).first();
  const occurrenceAllocated = Number(occurrence?.value || 0), monthlyAllocated = Number(monthly?.value || 0), amount = Number(r.amount_pence || 0);
  return json({
    ...data,
    allocated_pence: occurrenceAllocated + monthlyAllocated,
    occurrence_allocated_pence: occurrenceAllocated,
    monthly_allocated_pence: monthlyAllocated,
    credit_pence: Math.max(0, amount - occurrenceAllocated - monthlyAllocated)
  }, response.status);
}

async function annotateStudentAccount(db, data, studentId) {
  const rows = await db.prepare(`SELECT o.id,r.price_type FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE r.student_id=?1`).bind(studentId).all();
  const map = new Map((rows.results || []).map(x => [Number(x.id), x.price_type || 'per_session']));
  data.timeline = (data.timeline || []).map(x => x.kind === 'session' ? { ...x, billing_type:map.get(Number(x.id)) || 'per_session' } : x);
  return data;
}

async function monthlyAwareInsights(url, db) {
  const date = validDate(url.searchParams.get('date')) || londonDateISO();
  const month = date.slice(0,7);
  const previous = previousMonth(month);
  await ensureMonthlyDuesThroughMonth(db, month);
  await rebalanceStudentsWithMonthly(db);

  const [earnedSessions,earnedMonthly,receivedStudent,other,expenses,occDue,monthlyDue,time,top,prevStudent,prevOther] = await Promise.all([
    db.prepare(`SELECT COALESCE(SUM(earned_pence),0) value FROM session_occurrences_v3 WHERE status='completed' AND substr(COALESCE(rescheduled_to_date,session_date),1,7)=?1`).bind(month).first(),
    db.prepare(`SELECT COALESCE(SUM(MAX(0,amount_pence+adjustment_pence)),0) value FROM monthly_dues_v5 WHERE month=?1`).bind(month).first(),
    db.prepare(`SELECT COALESCE((SELECT SUM(amount_pence) FROM payments_v3 WHERE reversed_at IS NULL AND substr(paid_at,1,7)=?1),0)+COALESCE((SELECT SUM(amount_pence) FROM student_receipts_v4 WHERE deleted_at IS NULL AND substr(received_at,1,7)=?1),0) value`).bind(month).first(),
    db.prepare(`SELECT COALESCE(SUM(amount_pence),0) value FROM other_income_v3 WHERE deleted_at IS NULL AND substr(income_date,1,7)=?1`).bind(month).first(),
    db.prepare(`SELECT COALESCE(SUM(amount_pence),0) total,COALESCE(SUM(CASE WHEN scope='business' THEN amount_pence ELSE 0 END),0) business FROM expenses_v3 WHERE deleted_at IS NULL AND substr(expense_date,1,7)=?1`).bind(month).first(),
    db.prepare(`SELECT COALESCE(SUM(MAX(0,o.earned_pence-COALESCE((SELECT SUM(p.amount_pence) FROM payments_v3 p WHERE p.occurrence_id=o.id AND p.reversed_at IS NULL),0)-COALESCE((SELECT SUM(a.amount_pence) FROM receipt_allocations_v4 a JOIN student_receipts_v4 rr ON rr.id=a.receipt_id WHERE a.occurrence_id=o.id AND rr.deleted_at IS NULL),0))),0) value FROM session_occurrences_v3 o WHERE o.status='completed'`).first(),
    db.prepare(`SELECT COALESCE(SUM(MAX(0,(d.amount_pence+d.adjustment_pence)-COALESCE((SELECT SUM(a.amount_pence) FROM monthly_due_allocations_v5 a WHERE a.monthly_due_id=d.id),0))),0) value FROM monthly_dues_v5 d`).first(),
    db.prepare(`SELECT COALESCE(SUM(r.duration_minutes+r.travel_minutes),0) value FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE o.status='completed' AND substr(COALESCE(o.rescheduled_to_date,o.session_date),1,7)=?1`).bind(month).first(),
    db.prepare(`SELECT category,SUM(amount_pence) amount_pence FROM expenses_v3 WHERE deleted_at IS NULL AND substr(expense_date,1,7)=?1 GROUP BY category ORDER BY amount_pence DESC LIMIT 1`).bind(month).first(),
    db.prepare(`SELECT COALESCE((SELECT SUM(amount_pence) FROM payments_v3 WHERE reversed_at IS NULL AND substr(paid_at,1,7)=?1),0)+COALESCE((SELECT SUM(amount_pence) FROM student_receipts_v4 WHERE deleted_at IS NULL AND substr(received_at,1,7)=?1),0) value`).bind(previous).first(),
    db.prepare(`SELECT COALESCE(SUM(amount_pence),0) value FROM other_income_v3 WHERE deleted_at IS NULL AND substr(income_date,1,7)=?1`).bind(previous).first()
  ]);

  const received = Number(receivedStudent?.value || 0) + Number(other?.value || 0);
  const prevReceived = Number(prevStudent?.value || 0) + Number(prevOther?.value || 0);
  const outstanding = Number(occDue?.value || 0) + Number(monthlyDue?.value || 0);
  const earned = Number(earnedSessions?.value || 0) + Number(earnedMonthly?.value || 0);
  const realMinutes = Number(time?.value || 0);
  const hourly = realMinutes > 0 ? Math.round((earned - Number(expenses?.business || 0)) * 60 / realMinutes) : 0;
  const insights = [];
  if (outstanding > 0) insights.push({ tone:'attention', title:'في مستحقات لسه ما اتحصلتش', text:`عندك ${moneyText(outstanding)} لسه مستحقين من الطلاب.` });
  if (received > 0 && Number(expenses?.total || 0) / received >= .8) insights.push({ tone:'attention', title:'المصروف قريب من الدخل', text:`صرفتي حوالي ${Math.round(Number(expenses.total||0)/received*100)}% من اللي قبضتيه هذا الشهر.` });
  if (top) insights.push({ tone:'info', title:'أكبر باب صرف', text:`${expenseLabel(top.category)} هو أكبر بند: ${moneyText(top.amount_pence)}.` });
  if (prevReceived > 0) {
    const change = (received - prevReceived) / prevReceived * 100;
    if (Math.abs(change) >= 10) insights.push({ tone:change>0?'good':'attention', title:'مقارنة بالشهر اللي فات', text:`التحصيل ${change>0?'أعلى':'أقل'} بحوالي ${Math.abs(Math.round(change))}%.` });
  }
  if (hourly > 0) insights.push({ tone:'good', title:'العائد الحقيقي للساعة', text:`متوسط صافي عائد ساعة الشغل مع الانتقال حوالي ${moneyText(hourly)}.` });
  if (!insights.length) insights.push({ tone:'info', title:'لسه بنبني الصورة', text:'سجلي الحصص والمصروفات لأيام قليلة، وبعدها التحليل هيبقى أوضح.' });
  return json({ date, insights:insights.slice(0,5) });
}

async function dedupeMutation(request, env, ctx, handler) {
  const body = await request.clone().text();
  const url = new URL(request.url);
  const cookie = request.headers.get('cookie') || '';
  const key = await sha256(`AUDIT\n${request.method}\n${url.pathname}${url.search}\n${cookie}\n${body}`);
  const existing = await readDedupe(env.DB,key);
  if (existing?.status === 'done' && Number(existing.replay_fresh) === 1) return replay(existing);
  if (existing?.status === 'pending' && Number(existing.pending_fresh) === 1) {
    const done = await waitForDone(env.DB,key);
    if (done?.status === 'done') return replay(done);
    return json({ error:'العملية لسه بتتحفظ. استني لحظة من غير ما تضغطي تاني.' },409);
  }
  if (existing) await env.DB.prepare(`DELETE FROM mutation_dedupe_v1 WHERE dedupe_key=?1`).bind(key).run();
  const claim = await env.DB.prepare(`INSERT OR IGNORE INTO mutation_dedupe_v1(dedupe_key,method,path,status) VALUES(?1,?2,?3,'pending')`).bind(key,request.method,`${url.pathname}${url.search}`).run();
  if (Number(claim.meta?.changes || 0) === 0) {
    const done = await waitForDone(env.DB,key);
    if (done?.status === 'done') return replay(done);
    return json({ error:'العملية لسه بتتحفظ. استني لحظة من غير ما تضغطي تاني.' },409);
  }
  try {
    const response = await handler(request);
    if (!response.ok) { await env.DB.prepare(`DELETE FROM mutation_dedupe_v1 WHERE dedupe_key=?1`).bind(key).run(); return response; }
    const responseBody = await response.clone().text();
    await env.DB.prepare(`UPDATE mutation_dedupe_v1 SET status='done',response_status=?1,response_body=?2,content_type=?3,completed_at=CURRENT_TIMESTAMP WHERE dedupe_key=?4`).bind(response.status,responseBody,response.headers.get('content-type')||JSON_HEADERS['content-type'],key).run();
    if (ctx?.waitUntil) ctx.waitUntil(env.DB.prepare(`DELETE FROM mutation_dedupe_v1 WHERE created_at < datetime('now','-1 day')`).run());
    return response;
  } catch (e) {
    await env.DB.prepare(`DELETE FROM mutation_dedupe_v1 WHERE dedupe_key=?1`).bind(key).run();
    throw e;
  }
}

async function readDedupe(db,key){return db.prepare(`SELECT status,response_status,response_body,content_type,CASE WHEN created_at>=datetime('now','-${PENDING_TTL_SECONDS} seconds') THEN 1 ELSE 0 END pending_fresh,CASE WHEN completed_at IS NOT NULL AND completed_at>=datetime('now','-${REPLAY_WINDOW_SECONDS} seconds') THEN 1 ELSE 0 END replay_fresh FROM mutation_dedupe_v1 WHERE dedupe_key=?1`).bind(key).first();}
async function waitForDone(db,key){for(let i=0;i<POLL_ATTEMPTS;i++){const r=await readDedupe(db,key);if(!r||r.status==='done')return r||null;await new Promise(resolve=>setTimeout(resolve,POLL_MS));}return readDedupe(db,key);}
function replay(row){return new Response(row.response_body||'',{status:Number(row.response_status||200),headers:{'content-type':row.content_type||JSON_HEADERS['content-type'],'x-sozan-deduplicated':'1'}});}

async function authProbe(request, env, ctx){const probe=new Request(new URL('/api/v3/settings',request.url),{method:'GET',headers:request.headers});const r=await app.fetch(probe,env,ctx);return r.ok?null:r;}
async function occurrenceRow(db,id){return db.prepare(`SELECT o.*,COALESCE(o.rescheduled_to_date,o.session_date) effective_date,r.title,r.student_id,r.price_type,r.session_type FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE o.id=?1`).bind(id).first();}
async function occurrencePaid(db,id){const x=await db.prepare(`SELECT COALESCE((SELECT SUM(amount_pence) FROM payments_v3 WHERE occurrence_id=?1 AND reversed_at IS NULL),0)+COALESCE((SELECT SUM(a.amount_pence) FROM receipt_allocations_v4 a JOIN student_receipts_v4 rr ON rr.id=a.receipt_id WHERE a.occurrence_id=?1 AND rr.deleted_at IS NULL),0) value`).bind(id).first();return Number(x?.value||0);}
function jsonRequest(request,body){const headers=new Headers(request.headers);headers.set('content-type','application/json');return new Request(request.url,{method:request.method,headers,body:JSON.stringify(body)});}
async function safeBody(request){try{return await request.clone().json();}catch{return null;}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:JSON_HEADERS});}
function positiveInt(v){const n=Number(v);return Number.isFinite(n)&&n>0?Math.round(n):0;}
function paymentMethod(v){return ['cash','bank','wallet','other'].includes(v)?v:'cash';}
function moneyToPence(v){const n=Number(String(v??'').replace(',','.'));return Number.isFinite(n)?Math.max(0,Math.round(n*100)):0;}
function moneyText(v){return `${(Number(v||0)/100).toLocaleString('ar-EG',{maximumFractionDigits:2})} ج`;}
function text(v){const s=String(v??'').trim();return s?s.slice(0,300):null;}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v||''))?String(v):null;}
function effectiveDate(r){return r.effective_date||r.session_date||londonDateISO();}
function londonDateISO(){const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),g=t=>p.find(x=>x.type===t)?.value;return `${g('year')}-${g('month')}-${g('day')}`;}
function previousMonth(month){const[y,m]=month.split('-').map(Number),d=new Date(Date.UTC(y,m-2,1));return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;}
function expenseLabel(c){return({work_transport:'مواصلات الشغل',books_printing:'كتب وطباعة',teaching_supplies:'أدوات تعليم',work_internet:'إنترنت الشغل',center_fees:'مصاريف السنتر',study_materials:'مواد دراسية',other_business:'مصروف شغل آخر',home:'البيت',food:'الأكل',personal_transport:'مواصلات شخصية',bills:'فواتير',children:'الأطفال',commitments:'التزامات',personal_shopping:'شراء شخصي',health:'الصحة',other_personal:'مصروف شخصي آخر'})[c]||'أخرى';}
async function sha256(value){const bytes=new TextEncoder().encode(value),digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');}
