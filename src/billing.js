import app from './wrapper.js';

const JSON_HEADERS={'content-type':'application/json; charset=utf-8'};
const DASHBOARD_PATHS=new Set(['/api/v3/dashboard','/api/v3/today','/api/v4/dashboard']);

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url),path=url.pathname,method=request.method;

    if(DASHBOARD_PATHS.has(path)&&method==='GET'){
      const auth=await authProbe(request,env,ctx);if(auth)return auth;
      const date=validDate(url.searchParams.get('date'))||londonDateISO(),month=date.slice(0,7);
      await ensureMonthlyDuesThroughMonth(env.DB,month);
      await rebalanceStudentsWithMonthly(env.DB);
      const response=await app.fetch(request,env,ctx);if(!response.ok)return response;
      const data=await response.json();
      return json(await augmentDashboard(env.DB,data,date));
    }

    if(path==='/api/v4/students/summary'&&method==='GET'){
      const auth=await authProbe(request,env,ctx);if(auth)return auth;
      await ensureMonthlyDuesThroughMonth(env.DB,londonDateISO().slice(0,7));
      await rebalanceStudentsWithMonthly(env.DB);
      const response=await app.fetch(request,env,ctx);if(!response.ok)return response;
      return json(await augmentStudentSummaries(env.DB,await response.json()));
    }

    const accountMatch=path.match(/^\/api\/v4\/students\/(\d+)\/account$/);
    if(accountMatch&&method==='GET'){
      const auth=await authProbe(request,env,ctx);if(auth)return auth;
      const studentId=Number(accountMatch[1]);
      await ensureMonthlyDuesThroughMonth(env.DB,londonDateISO().slice(0,7));
      await rebalanceStudentAll(env.DB,studentId);
      const response=await app.fetch(request,env,ctx);if(!response.ok)return response;
      return json(await augmentStudentAccount(env.DB,await response.json(),studentId));
    }

    if(path==='/api/v4/review'&&method==='GET'){
      const auth=await authProbe(request,env,ctx);if(auth)return auth;
      await ensureMonthlyDuesThroughMonth(env.DB,londonDateISO().slice(0,7));
      await rebalanceStudentsWithMonthly(env.DB);
      const response=await app.fetch(request,env,ctx);if(!response.ok)return response;
      const data=await response.json();
      data.items=[...(data.items||[]),...await monthlyReviewItems(env.DB)];
      return json(data);
    }

    if(path==='/api/v3/sessions'&&method==='POST'){
      const body=await safeBody(request);
      const response=await app.fetch(request,env,ctx);if(!response.ok)return response;
      const out=await response.clone().json().catch(()=>({}));
      if(out.id&&body?.price_type)await applyBillingMethod(env.DB,Number(out.id),body,null);
      return response;
    }

    const sessionMatch=path.match(/^\/api\/v3\/sessions\/(\d+)$/);
    if(sessionMatch&&method==='PATCH'){
      const id=Number(sessionMatch[1]),before=await sessionRow(env.DB,id),body=await safeBody(request);
      if(before?.price_type==='monthly')await ensureMonthlyDuesThroughMonth(env.DB,londonDateISO().slice(0,7));
      const response=await app.fetch(request,env,ctx);if(!response.ok)return response;
      if(body?.price_type)await applyBillingMethod(env.DB,id,body,before);
      return response;
    }
    if(sessionMatch&&method==='DELETE'){
      const id=Number(sessionMatch[1]),before=await sessionRow(env.DB,id);
      if(before?.price_type==='monthly')await ensureMonthlyDuesThroughMonth(env.DB,londonDateISO().slice(0,7));
      const response=await app.fetch(request,env,ctx);if(response.ok&&before?.price_type==='monthly'){
        await env.DB.prepare(`UPDATE recurring_sessions_v3 SET billing_end_month=COALESCE(billing_end_month,?1) WHERE id=?2`).bind(londonDateISO().slice(0,7),id).run();
      }
      return response;
    }

    const occAction=path.match(/^\/api\/v3\/occurrences\/(\d+)\/(complete-paid|complete-unpaid|collect)$/);
    if(occAction&&method==='POST'){
      const id=Number(occAction[1]),action=occAction[2],row=await occurrenceBillingRow(env.DB,id);
      if(row?.price_type==='monthly'){
        const auth=await authProbe(request,env,ctx);if(auth)return auth;
        if(action==='collect')return json({error:'الاشتراك الشهري بيتسجل من «قبضت فلوس»، مش من الحصة نفسها.'},409);
        return completeMonthlyOccurrence(env.DB,row);
      }
    }
    const correction=path.match(/^\/api\/v3\/occurrences\/(\d+)\/correct-payment$/);
    if(correction&&method==='POST'){
      const row=await occurrenceBillingRow(env.DB,Number(correction[1]));
      if(row?.price_type==='monthly'){
        const auth=await authProbe(request,env,ctx);if(auth)return auth;
        return json({error:'دفع الاشتراك الشهري يتعدل من حركة الاستلام، مش من الحصة.'},409);
      }
    }

    const receiptMutation=path.match(/^\/api\/v4\/receipts(?:\/(\d+))?$/);
    if(receiptMutation&&['POST','PATCH','DELETE'].includes(method)){
      const id=Number(receiptMutation[1]||0),before=id?await env.DB.prepare(`SELECT student_id FROM student_receipts_v4 WHERE id=?1`).bind(id).first():null,body=method==='POST'?await safeBody(request):null;
      const response=await app.fetch(request,env,ctx);if(!response.ok)return response;
      const after=id?await env.DB.prepare(`SELECT student_id FROM student_receipts_v4 WHERE id=?1`).bind(id).first():null;
      const students=new Set([Number(before?.student_id||0),Number(after?.student_id||0),Number(body?.student_id||0)].filter(Boolean));
      await ensureMonthlyDuesThroughMonth(env.DB,londonDateISO().slice(0,7));
      for(const studentId of students)await rebalanceStudentAll(env.DB,studentId);
      return response;
    }

    const restoreReceipt=path.match(/^\/api\/v4\/restore\/receipt\/(\d+)$/);
    if(restoreReceipt&&method==='POST'){
      const response=await app.fetch(request,env,ctx);if(!response.ok)return response;
      const r=await env.DB.prepare(`SELECT student_id FROM student_receipts_v4 WHERE id=?1`).bind(Number(restoreReceipt[1])).first();
      await ensureMonthlyDuesThroughMonth(env.DB,londonDateISO().slice(0,7));
      if(r?.student_id)await rebalanceStudentAll(env.DB,Number(r.student_id));
      return response;
    }

    if(path==='/api/v4/reset-data'&&method==='POST'){
      const response=await app.fetch(request,env,ctx);
      if(response.ok)await env.DB.batch([env.DB.prepare(`DELETE FROM monthly_due_allocations_v5`),env.DB.prepare(`DELETE FROM monthly_dues_v5`)]);
      return response;
    }

    return app.fetch(request,env,ctx);
  }
};

async function authProbe(request,env,ctx){
  const probe=new Request(new URL('/api/v3/settings',request.url),{method:'GET',headers:request.headers});
  const response=await app.fetch(probe,env,ctx);return response.ok?null:response;
}

async function applyBillingMethod(db,sessionId,body,before){
  let row=await sessionRow(db,sessionId);if(!row)return;
  const currentMonth=londonDateISO().slice(0,7),method=body.price_type==='monthly'?'monthly':'per_session';
  let studentId=Number(row.student_id||0);
  if(method==='monthly'&&!studentId){
    const name=String(row.title||'').trim();
    let student=await db.prepare(`SELECT id FROM students_v3 WHERE active=1 AND deleted_at IS NULL AND lower(trim(name))=lower(trim(?1)) ORDER BY id LIMIT 1`).bind(name).first();
    if(!student){const created=await db.prepare(`INSERT INTO students_v3(name) VALUES(?1)`).bind(name.slice(0,100)).run();student={id:Number(created.meta?.last_row_id||0)};}
    studentId=Number(student?.id||0);if(studentId)await db.prepare(`UPDATE recurring_sessions_v3 SET student_id=?1 WHERE id=?2`).bind(studentId,sessionId).run();
    row=await sessionRow(db,sessionId);
  }

  if(method==='monthly'){
    let start=validMonth(body.billing_start_month)||row.billing_start_month||currentMonth;
    if(before&&before.price_type!=='monthly'){
      const earned=await db.prepare(`SELECT COUNT(*) count FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE r.student_id=?1 AND o.status='completed' AND o.earned_pence>0 AND substr(COALESCE(o.rescheduled_to_date,o.session_date),1,7)=?2`).bind(studentId,currentMonth).first();
      if(Number(earned?.count||0)>0)start=nextMonth(currentMonth);
    }
    const day=clampDay(body.billing_day||row.billing_day||1),price=Number(row.price_pence||0);
    if(studentId){
      await db.prepare(`UPDATE recurring_sessions_v3 SET price_type='monthly',price_pence=?1,billing_start_month=CASE WHEN price_type='monthly' AND billing_start_month IS NOT NULL THEN billing_start_month ELSE ?2 END,billing_end_month=NULL,billing_day=?3,updated_at=CURRENT_TIMESTAMP WHERE active=1 AND student_id=?4`).bind(price,start,day,studentId).run();
    }else{
      await db.prepare(`UPDATE recurring_sessions_v3 SET price_type='monthly',billing_start_month=COALESCE(billing_start_month,?1),billing_end_month=NULL,billing_day=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?3`).bind(start,day,sessionId).run();
    }
    if(start<=currentMonth){await ensureMonthlyDuesThroughMonth(db,currentMonth);if(studentId)await rebalanceStudentAll(db,studentId);}
  }else if(before?.price_type==='monthly'||row.price_type==='per_session'){
    if(before?.price_type==='monthly')await ensureMonthlyDuesThroughMonth(db,currentMonth);
    const price=Number(row.price_pence||0);
    if(studentId&&before?.price_type==='monthly'){
      await db.prepare(`UPDATE recurring_sessions_v3 SET price_type='per_session',price_pence=?1,billing_end_month=?2,updated_at=CURRENT_TIMESTAMP WHERE active=1 AND student_id=?3 AND price_type='monthly'`).bind(price,currentMonth,studentId).run();
      await rebalanceStudentAll(db,studentId);
    }else{
      await db.prepare(`UPDATE recurring_sessions_v3 SET price_type='per_session',billing_end_month=CASE WHEN billing_start_month IS NOT NULL THEN ?1 ELSE billing_end_month END,updated_at=CURRENT_TIMESTAMP WHERE id=?2`).bind(currentMonth,sessionId).run();
    }
  }
}

export async function ensureMonthlyDuesThroughMonth(db,targetMonth){
  if(!validMonth(targetMonth))return;
  const rows=await db.prepare(`SELECT r.*,s.name student_name FROM recurring_sessions_v3 r LEFT JOIN students_v3 s ON s.id=r.student_id WHERE r.price_type='monthly' AND r.billing_start_month IS NOT NULL AND r.billing_start_month<=?1`).bind(targetMonth).all();
  const groups=new Map();
  for(const row of rows.results||[]){const key=row.student_id?`student:${row.student_id}`:`session:${row.id}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  for(const [accountKey,plans] of groups){
    const starts=plans.map(x=>x.billing_start_month).filter(validMonth).sort();if(!starts.length)continue;
    for(const month of monthsBetween(starts[0],targetMonth)){
      const active=plans.filter(p=>p.billing_start_month<=month&&(!p.billing_end_month||p.billing_end_month>=month));if(!active.length)continue;
      active.sort((a,b)=>monthlyNet(b)-monthlyNet(a));const p=active[0],day=clampDay(p.billing_day||1),dueDate=dueDateForMonth(month,day),amount=monthlyNet(p);
      await db.prepare(`INSERT OR IGNORE INTO monthly_dues_v5(account_key,student_id,source_session_id,title,session_type,month,due_date,amount_pence,note) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)`).bind(accountKey,p.student_id||null,p.id,p.student_name||p.title,p.session_type,month,dueDate,amount,'استحقاق شهري تلقائي').run();
    }
  }
}

export async function rebalanceStudentsWithMonthly(db){
  const rows=await db.prepare(`SELECT DISTINCT student_id FROM monthly_dues_v5 WHERE student_id IS NOT NULL`).all();
  for(const r of rows.results||[])await rebalanceStudentAll(db,Number(r.student_id));
}

export async function rebalanceStudentAll(db,studentId){
  if(!studentId)return;
  const receipts=await db.prepare(`SELECT id,amount_pence,received_at FROM student_receipts_v4 WHERE student_id=?1 AND deleted_at IS NULL ORDER BY received_at,id`).bind(studentId).all();
  const occurrences=await db.prepare(`SELECT o.id,COALESCE(o.rescheduled_to_date,o.session_date) due_date,o.earned_pence,COALESCE((SELECT SUM(p.amount_pence) FROM payments_v3 p WHERE p.occurrence_id=o.id AND p.reversed_at IS NULL),0) direct_paid FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE r.student_id=?1 AND o.status='completed' AND o.earned_pence>0 ORDER BY due_date,o.id`).bind(studentId).all();
  const dues=await db.prepare(`SELECT id,due_date,MAX(0,amount_pence+adjustment_pence) amount_pence FROM monthly_dues_v5 WHERE student_id=?1 ORDER BY due_date,id`).bind(studentId).all();
  const obligations=[];
  for(const o of occurrences.results||[]){const remaining=Math.max(0,Number(o.earned_pence||0)-Number(o.direct_paid||0));if(remaining>0)obligations.push({kind:'occurrence',id:Number(o.id),date:o.due_date,remaining});}
  for(const d of dues.results||[]){const remaining=Math.max(0,Number(d.amount_pence||0));if(remaining>0)obligations.push({kind:'monthly',id:Number(d.id),date:d.due_date,remaining});}
  obligations.sort((a,b)=>String(a.date).localeCompare(String(b.date))||(a.kind==='monthly'?-1:1)||a.id-b.id);
  const statements=[
    db.prepare(`DELETE FROM receipt_allocations_v4 WHERE receipt_id IN (SELECT id FROM student_receipts_v4 WHERE student_id=?1)`).bind(studentId),
    db.prepare(`DELETE FROM monthly_due_allocations_v5 WHERE receipt_id IN (SELECT id FROM student_receipts_v4 WHERE student_id=?1)`).bind(studentId)
  ];
  let idx=0;
  for(const receipt of receipts.results||[]){let left=Number(receipt.amount_pence||0);while(left>0&&idx<obligations.length){while(idx<obligations.length&&obligations[idx].remaining<=0)idx++;if(idx>=obligations.length)break;const ob=obligations[idx],amount=Math.min(left,ob.remaining);if(amount>0){if(ob.kind==='occurrence')statements.push(db.prepare(`INSERT INTO receipt_allocations_v4(receipt_id,occurrence_id,amount_pence) VALUES(?1,?2,?3)`).bind(receipt.id,ob.id,amount));else statements.push(db.prepare(`INSERT INTO monthly_due_allocations_v5(receipt_id,monthly_due_id,amount_pence) VALUES(?1,?2,?3)`).bind(receipt.id,ob.id,amount));left-=amount;ob.remaining-=amount;}}}
  await db.batch(statements);
}

async function completeMonthlyOccurrence(db,row){
  const month=String(row.effective_date||row.session_date).slice(0,7);await ensureMonthlyDuesThroughMonth(db,month);if(row.student_id)await rebalanceStudentAll(db,Number(row.student_id));
  await db.prepare(`UPDATE session_occurrences_v3 SET status='completed',earned_pence=0,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?1`).bind(row.id).run();
  await db.prepare(`INSERT INTO activity_events_v4(entity_type,entity_id,action,title,detail,undoable) VALUES('occurrence',?1,'completed',?2,?3,0)`).bind(row.id,`تمت حصة ${row.title}`,'اشتراك شهري · التحصيل منفصل عن الحصة').run();
  const due=await monthlyDueForStudentMonth(db,Number(row.student_id||0),month);
  return json({ok:true,earned_pence:0,paid_pence:0,outstanding_pence:0,billing_type:'monthly',monthly_outstanding_pence:due?.outstanding_pence||0});
}

async function augmentDashboard(db,data,date){
  const month=date.slice(0,7),dues=await db.prepare(`SELECT d.*,COALESCE((SELECT SUM(a.amount_pence) FROM monthly_due_allocations_v5 a WHERE a.monthly_due_id=d.id),0) paid_pence FROM monthly_dues_v5 d WHERE d.month=?1`).bind(month).all();
  const dueByStudent=new Map();let monthlyEarned=0;
  for(const d of dues.results||[]){const total=Math.max(0,Number(d.amount_pence||0)+Number(d.adjustment_pence||0)),paid=Number(d.paid_pence||0),outstanding=Math.max(0,total-paid);monthlyEarned+=total;if(d.student_id)dueByStudent.set(Number(d.student_id),{total,paid,outstanding,month});}
  const billingRows=await db.prepare(`SELECT id,student_id,price_type FROM recurring_sessions_v3`).all(),billingMap=new Map((billingRows.results||[]).map(x=>[Number(x.id),x]));
  data.sessions=(data.sessions||[]).map(s=>{const b=billingMap.get(Number(s.recurring_session_id));if(b?.price_type!=='monthly')return {...s,price_type:b?.price_type||'per_session'};const due=dueByStudent.get(Number(b.student_id||s.student_id))||{total:0,paid:0,outstanding:0,month};return {...s,price_type:'monthly',monthly_due_pence:due.total,monthly_paid_pence:due.paid,monthly_outstanding_pence:due.outstanding,billing_month:month};});
  const allMonthly=await db.prepare(`SELECT COALESCE(SUM(MAX(0,(d.amount_pence+d.adjustment_pence)-COALESCE((SELECT SUM(a.amount_pence) FROM monthly_due_allocations_v5 a WHERE a.monthly_due_id=d.id),0))),0) value FROM monthly_dues_v5 d`).first();
  data.summary=data.summary||{};data.summary.monthly_earned_pence=monthlyEarned;data.summary.earned_pence=Number(data.summary.earned_pence||0)+monthlyEarned;data.summary.outstanding_pence=Number(data.summary.outstanding_pence||0)+Number(allMonthly?.value||0);
  const time=await db.prepare(`SELECT COALESCE(SUM(r.duration_minutes+r.travel_minutes),0) minutes FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE o.status='completed' AND substr(COALESCE(o.rescheduled_to_date,o.session_date),1,7)=?1`).bind(month).first();const mins=Number(time?.minutes||0),profit=Number(data.summary.earned_pence||0)-Number(data.summary.business_expenses_pence||0);data.summary.true_hourly_pence=mins>0?Math.round(profit*60/mins):0;
  return data;
}

async function augmentStudentSummaries(db,data){
  const monthlyPlans=await db.prepare(`SELECT student_id,MAX(price_pence) price_pence FROM recurring_sessions_v3 WHERE active=1 AND price_type='monthly' AND student_id IS NOT NULL GROUP BY student_id`).all(),planMap=new Map((monthlyPlans.results||[]).map(x=>[Number(x.student_id),Number(x.price_pence||0)]));
  for(const s of data.students||[]){const extra=await monthlyStudentTotals(db,Number(s.id));s.outstanding_pence=Number(s.outstanding_pence||0)+extra.outstanding;s.outstanding_count=Number(s.outstanding_count||0)+extra.count;s.credit_pence=Math.max(0,Number(s.credit_pence||0)-extra.allocated);s.billing_type=planMap.has(Number(s.id))?'monthly':'per_session';s.monthly_price_pence=planMap.get(Number(s.id))||0;}
  data.students=(data.students||[]).sort((a,b)=>Number(b.outstanding_pence||0)-Number(a.outstanding_pence||0)||String(a.name).localeCompare(String(b.name),'ar'));data.total_outstanding_pence=(data.students||[]).reduce((n,s)=>n+Number(s.outstanding_pence||0),0);return data;
}

async function augmentStudentAccount(db,data,studentId){const extra=await monthlyStudentTotals(db,studentId),plan=await db.prepare(`SELECT MAX(price_pence) price_pence FROM recurring_sessions_v3 WHERE active=1 AND price_type='monthly' AND student_id=?1`).bind(studentId).first();if(data.student){data.student.outstanding_pence=Number(data.student.outstanding_pence||0)+extra.outstanding;data.student.outstanding_count=Number(data.student.outstanding_count||0)+extra.count;data.student.credit_pence=Math.max(0,Number(data.student.credit_pence||0)-extra.allocated);data.student.billing_type=Number(plan?.price_pence||0)>0?'monthly':'per_session';data.student.monthly_price_pence=Number(plan?.price_pence||0);}data.monthly_dues=(await db.prepare(`SELECT d.*,COALESCE((SELECT SUM(a.amount_pence) FROM monthly_due_allocations_v5 a WHERE a.monthly_due_id=d.id),0) paid_pence FROM monthly_dues_v5 d WHERE student_id=?1 ORDER BY month DESC LIMIT 18`).bind(studentId).all()).results||[];return data;}

async function monthlyStudentTotals(db,studentId){const r=await db.prepare(`SELECT COALESCE(SUM(MAX(0,(d.amount_pence+d.adjustment_pence)-COALESCE((SELECT SUM(a.amount_pence) FROM monthly_due_allocations_v5 a WHERE a.monthly_due_id=d.id),0))),0) outstanding,COUNT(CASE WHEN (d.amount_pence+d.adjustment_pence)>COALESCE((SELECT SUM(a.amount_pence) FROM monthly_due_allocations_v5 a WHERE a.monthly_due_id=d.id),0) THEN 1 END) count,COALESCE((SELECT SUM(a.amount_pence) FROM monthly_due_allocations_v5 a JOIN monthly_dues_v5 md ON md.id=a.monthly_due_id WHERE md.student_id=?1),0) allocated FROM monthly_dues_v5 d WHERE d.student_id=?1`).bind(studentId).first();return{outstanding:Number(r?.outstanding||0),count:Number(r?.count||0),allocated:Number(r?.allocated||0)}}

async function monthlyReviewItems(db){const rows=await db.prepare(`SELECT d.student_id,d.title,d.month,d.due_date,MAX(0,(d.amount_pence+d.adjustment_pence)-COALESCE((SELECT SUM(a.amount_pence) FROM monthly_due_allocations_v5 a WHERE a.monthly_due_id=d.id),0)) outstanding FROM monthly_dues_v5 d WHERE d.due_date<date('now','-14 day') ORDER BY d.due_date LIMIT 8`).all();return (rows.results||[]).filter(x=>Number(x.outstanding||0)>0).map(x=>({tone:'attention',title:`اشتراك ${x.title} لسه مستحق`,text:`${x.month} · باقي ${moneyText(x.outstanding)}`,student_id:x.student_id||null,entity_type:'monthly_due'}));}

async function monthlyDueForStudentMonth(db,studentId,month){if(!studentId)return null;const d=await db.prepare(`SELECT d.*,COALESCE((SELECT SUM(a.amount_pence) FROM monthly_due_allocations_v5 a WHERE a.monthly_due_id=d.id),0) paid_pence FROM monthly_dues_v5 d WHERE student_id=?1 AND month=?2 ORDER BY id LIMIT 1`).bind(studentId,month).first();if(!d)return null;const total=Math.max(0,Number(d.amount_pence||0)+Number(d.adjustment_pence||0));return{...d,total_pence:total,outstanding_pence:Math.max(0,total-Number(d.paid_pence||0))};}
async function occurrenceBillingRow(db,id){return db.prepare(`SELECT o.*,COALESCE(o.rescheduled_to_date,o.session_date) effective_date,r.title,r.student_id,r.price_type,r.id recurring_session_id FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE o.id=?1`).bind(id).first();}
async function sessionRow(db,id){return db.prepare(`SELECT * FROM recurring_sessions_v3 WHERE id=?1`).bind(id).first();}
function monthlyNet(r){const price=Number(r.price_pence||0),count=Math.max(1,Number(r.student_count||1)),gross=r.price_basis==='per_student'?price*count:price,cut=Math.round(gross*Number(r.center_cut_percent||0)/100);return Math.max(0,gross-cut);}
function dueDateForMonth(month,day){const[y,m]=month.split('-').map(Number),last=new Date(Date.UTC(y,m,0)).getUTCDate();return `${month}-${String(Math.min(last,Math.max(1,day))).padStart(2,'0')}`;}
function monthsBetween(start,end){const out=[];if(!validMonth(start)||!validMonth(end)||start>end)return out;let cur=start;for(let i=0;i<120&&cur<=end;i++){out.push(cur);cur=nextMonth(cur);}return out;}
function nextMonth(month){const[y,m]=month.split('-').map(Number),d=new Date(Date.UTC(y,m,1));return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;}
function londonDateISO(){const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),g=t=>p.find(x=>x.type===t)?.value;return `${g('year')}-${g('month')}-${g('day')}`;}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v||''))?String(v):null;}
function validMonth(v){return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v||''))?String(v):null;}
function clampDay(v){return Math.min(28,Math.max(1,Math.round(Number(v)||1)));}
async function safeBody(request){try{return await request.clone().json();}catch{return null;}}
function moneyText(p){return `${(Number(p||0)/100).toLocaleString('ar-EG',{maximumFractionDigits:2})} ج`;}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:JSON_HEADERS});}
