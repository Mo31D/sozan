import base from './worker.js';

const JSON_HEADERS={'content-type':'application/json; charset=utf-8'};
const PACKAGE_DEFAULT=8;
let schemaReady=null;

export default{
 async fetch(request,env,ctx){
  const url=new URL(request.url),path=url.pathname,method=request.method;
  try{
   if(path==='/api/health')return json({ok:true,app:env.APP_NAME||'Sozan Tutor OS',version:'6.0',billing:'per_session_or_package',package_default:8,schedule_views:true,reports:true});
   if(!path.startsWith('/api/'))return base.fetch(request,env,ctx);
   if(path==='/api/login'||path==='/api/logout')return base.fetch(request,env,ctx);
   await ensureSchema(env.DB);
   if(method!=='GET'&&method!=='HEAD'&&path!=='/api/logout')return dedupeMutation(request,env,ctx,()=>dispatch(request,env,ctx));
   return dispatch(request,env,ctx);
  }catch(e){console.error(e);return json({error:'حدث خطأ غير متوقع',detail:String(e?.message||e)},500)}
 }
};

async function dispatch(request,env,ctx){
 const url=new URL(request.url),path=url.pathname,method=request.method;
 const auth=await authCheck(request,env);if(auth)return auth;
 if((path==='/api/v4/dashboard'||path==='/api/v3/dashboard'||path==='/api/v3/today')&&method==='GET')return dashboardV6(request,env,ctx);
 if(path==='/api/v3/sessions'&&method==='GET')return listSessionsV6(env.DB);
 if(path==='/api/v3/sessions'&&method==='POST')return createSessionV6(request,env,ctx);
 const sessionId=path.match(/^\/api\/v3\/sessions\/(\d+)$/);
 if(sessionId&&method==='PATCH')return updateSessionV6(request,env,ctx,Number(sessionId[1]));
 const occurrenceAction=path.match(/^\/api\/v3\/occurrences\/(\d+)\/(complete-paid|complete-unpaid|cancel|restore|reopen|collect)$/);
 if(occurrenceAction&&method==='POST')return occurrenceActionV6(request,env,ctx,Number(occurrenceAction[1]),occurrenceAction[2]);
 const correct=path.match(/^\/api\/v3\/occurrences\/(\d+)\/correct-payment$/);
 if(correct&&method==='POST'&&await occurrenceIsPackage(env.DB,Number(correct[1])))return json({error:'دفع الباقة بيتسجل من «قبضت فلوس»، مش من حصة واحدة.'},409);
 if(path==='/api/v4/receipts'&&method==='POST')return createReceiptV6(request,env.DB);
 const receipt=path.match(/^\/api\/v4\/receipts\/(\d+)$/);
 if(receipt&&method==='PATCH')return updateReceiptV6(request,env.DB,Number(receipt[1]));
 if(receipt&&method==='DELETE')return deleteReceiptV6(env.DB,Number(receipt[1]));
 const restore=path.match(/^\/api\/v4\/restore\/receipt\/(\d+)$/);
 if(restore&&method==='POST')return restoreReceiptV6(env.DB,Number(restore[1]));
 if(path==='/api/v4/students/summary'&&method==='GET')return studentSummariesV6(env.DB);
 const account=path.match(/^\/api\/v4\/students\/(\d+)\/account$/);
 if(account&&method==='GET')return studentAccountV6(env.DB,Number(account[1]));
 if(path==='/api/v6/schedule-range'&&method==='GET')return scheduleRangeV6(url,env.DB);
 if((path==='/api/v6/reports'||path==='/api/v4/reports')&&method==='GET')return reportV6(url,env.DB);
 if(path==='/api/v3/insights'&&method==='GET')return insightsV6(url,env.DB);
 if(path==='/api/v4/review'&&method==='GET')return reviewV6(env.DB);
 if(path==='/api/v4/reset-data'&&method==='POST')return resetV6(request,env,ctx);
 return base.fetch(request,env,ctx);
}

async function ensureSchema(db){
 if(schemaReady)return schemaReady;
 schemaReady=(async()=>{
  await db.batch([
   db.prepare(`CREATE TABLE IF NOT EXISTS student_billing_v6(student_id INTEGER PRIMARY KEY,billing_mode TEXT NOT NULL DEFAULT 'per_session' CHECK(billing_mode IN ('per_session','package')),package_size INTEGER NOT NULL DEFAULT 8 CHECK(package_size BETWEEN 1 AND 100),package_price_pence INTEGER NOT NULL DEFAULT 0 CHECK(package_price_pence>=0),cycle_anchor_date TEXT NOT NULL DEFAULT (date('now')),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(student_id) REFERENCES students_v3(id) ON DELETE CASCADE)`),
   db.prepare(`CREATE TABLE IF NOT EXISTS package_cycles_v6(id INTEGER PRIMARY KEY AUTOINCREMENT,student_id INTEGER NOT NULL,cycle_no INTEGER NOT NULL,package_size INTEGER NOT NULL,package_price_pence INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','due','paid')),started_on TEXT,completed_on TEXT,paid_on TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(student_id,cycle_no),FOREIGN KEY(student_id) REFERENCES students_v3(id) ON DELETE CASCADE)`),
   db.prepare(`CREATE TABLE IF NOT EXISTS package_cycle_occurrences_v6(id INTEGER PRIMARY KEY AUTOINCREMENT,cycle_id INTEGER NOT NULL,occurrence_id INTEGER NOT NULL UNIQUE,position INTEGER NOT NULL,earned_pence INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(cycle_id) REFERENCES package_cycles_v6(id) ON DELETE CASCADE,FOREIGN KEY(occurrence_id) REFERENCES session_occurrences_v3(id) ON DELETE CASCADE)`),
   db.prepare(`CREATE TABLE IF NOT EXISTS package_receipt_allocations_v6(id INTEGER PRIMARY KEY AUTOINCREMENT,receipt_id INTEGER NOT NULL,cycle_id INTEGER NOT NULL,amount_pence INTEGER NOT NULL CHECK(amount_pence>0),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(receipt_id) REFERENCES student_receipts_v4(id) ON DELETE CASCADE,FOREIGN KEY(cycle_id) REFERENCES package_cycles_v6(id) ON DELETE CASCADE)`),
   db.prepare(`CREATE TABLE IF NOT EXISTS mutation_dedupe_v1(dedupe_key TEXT PRIMARY KEY,method TEXT NOT NULL,path TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',response_status INTEGER,response_body TEXT,content_type TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,completed_at TEXT)`),
   db.prepare(`CREATE INDEX IF NOT EXISTS idx_package_cycles_student_v6 ON package_cycles_v6(student_id,status,cycle_no)`),
   db.prepare(`CREATE INDEX IF NOT EXISTS idx_package_occ_cycle_v6 ON package_cycle_occurrences_v6(cycle_id,position)`),
   db.prepare(`CREATE INDEX IF NOT EXISTS idx_package_alloc_receipt_v6 ON package_receipt_allocations_v6(receipt_id)`),
   db.prepare(`CREATE INDEX IF NOT EXISTS idx_package_alloc_cycle_v6 ON package_receipt_allocations_v6(cycle_id)`)
  ]);
  await db.prepare(`INSERT INTO student_billing_v6(student_id,billing_mode,package_size,package_price_pence,cycle_anchor_date) SELECT r.student_id,'package',8,MAX(r.price_pence),date('now') FROM recurring_sessions_v3 r WHERE r.active=1 AND r.student_id IS NOT NULL AND r.price_type='monthly' GROUP BY r.student_id ON CONFLICT(student_id) DO UPDATE SET billing_mode='package',package_size=8,package_price_pence=excluded.package_price_pence,updated_at=CURRENT_TIMESTAMP`).run();
  await db.prepare(`INSERT INTO student_billing_v6(student_id,billing_mode,package_size,package_price_pence,cycle_anchor_date) SELECT s.id,'per_session',8,0,date('now') FROM students_v3 s WHERE s.active=1 AND s.deleted_at IS NULL ON CONFLICT(student_id) DO NOTHING`).run();
  const monthly=await db.prepare(`SELECT r.id,r.student_id,b.package_size,b.package_price_pence FROM recurring_sessions_v3 r JOIN student_billing_v6 b ON b.student_id=r.student_id WHERE r.active=1 AND r.price_type='monthly'`).all();
  for(const r of monthly.results||[]){await db.prepare(`UPDATE recurring_sessions_v3 SET price_type='per_session',price_pence=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2`).bind(unitAmount(r.package_price_pence,r.package_size,1),r.id).run()}
 })().catch(e=>{schemaReady=null;throw e});
 return schemaReady;
}

async function authCheck(request,env){
 const probe=new Request(new URL('/api/v3/settings',request.url),{method:'GET',headers:request.headers});
 const r=await base.fetch(probe,env);return r.ok?null:r;
}

async function listSessionsV6(db){
 const rows=await db.prepare(`SELECT r.*,s.name student_name,s.guardian_name,COALESCE(b.billing_mode,'per_session') billing_mode,COALESCE(b.package_size,8) package_size,COALESCE(b.package_price_pence,0) package_price_pence FROM recurring_sessions_v3 r LEFT JOIN students_v3 s ON s.id=r.student_id LEFT JOIN student_billing_v6 b ON b.student_id=r.student_id WHERE r.active=1 ORDER BY r.weekday,CASE WHEN r.start_time='' THEN '99:99' ELSE r.start_time END,r.id`).all();
 return json({sessions:rows.results||[]});
}

async function createSessionV6(request,env,ctx){
 const body=await safeJson(request)||{},mode=normalizeMode(body.billing_mode),size=packageSize(body.package_size),packagePrice=moneyPence(body.package_price??body.price);
 const send={...body,price_type:'per_session'};
 if(mode==='package')send.price=unitAmount(packagePrice,size,1)/100;
 const res=await base.fetch(jsonRequest(request,send),env,ctx);if(!res.ok)return res;
 const data=await res.json();
 if(data.student_id){
  const current=await billingPlan(env.DB,data.student_id);
  const finalMode=body.billing_mode?mode:(current?.billing_mode||'per_session');
  if(body.billing_mode)await setBillingPlan(env.DB,data.student_id,finalMode,size,packagePrice);
  const plan=await billingPlan(env.DB,data.student_id);
  if(plan?.billing_mode==='package')await env.DB.prepare(`UPDATE recurring_sessions_v3 SET price_type='per_session',price_pence=?1 WHERE id=?2`).bind(unitAmount(plan.package_price_pence,plan.package_size,1),data.id).run();
 }
 return json({...data,billing_mode:mode},res.status);
}

async function updateSessionV6(request,env,ctx,id){
 const before=await env.DB.prepare(`SELECT * FROM recurring_sessions_v3 WHERE id=?1`).bind(id).first();if(!before)return json({error:'الحصة غير موجودة'},404);
 const body=await safeJson(request)||{},studentId=Number(before.student_id||body.student_id||0),current=studentId?await billingPlan(env.DB,studentId):null;
 const requested=body.billing_mode?normalizeMode(body.billing_mode):(current?.billing_mode||'per_session');
 if(studentId&&current&&requested!==current.billing_mode){
  const active=await env.DB.prepare(`SELECT COUNT(*) c FROM package_cycle_occurrences_v6 x JOIN package_cycles_v6 c ON c.id=x.cycle_id WHERE c.student_id=?1`).bind(studentId).first();
  const due=await env.DB.prepare(`SELECT COUNT(*) c FROM package_cycles_v6 WHERE student_id=?1 AND status IN ('due','paid')`).bind(studentId).first();
  if(Number(active?.c||0)>0||Number(due?.c||0)>0)return json({error:'طريقة الحساب اتستخدمت بالفعل للطالب. علشان ما نغيّرش تاريخ قديم، كمّلي الدورة الحالية الأول ثم غيّري النظام.'},409);
 }
 const size=packageSize(body.package_size??current?.package_size),pkg=moneyPence(body.package_price??((current?.package_price_pence||0)/100));
 const send={...body,price_type:'per_session'};
 if(requested==='package')send.price=unitAmount(pkg,size,1)/100;
 const res=await base.fetch(jsonRequest(request,send),env,ctx);if(!res.ok)return res;
 if(studentId&&body.billing_mode)await setBillingPlan(env.DB,studentId,requested,size,pkg);
 return res;
}

async function setBillingPlan(db,studentId,mode,size,price){
 await db.prepare(`INSERT INTO student_billing_v6(student_id,billing_mode,package_size,package_price_pence,cycle_anchor_date) VALUES(?1,?2,?3,?4,date('now')) ON CONFLICT(student_id) DO UPDATE SET billing_mode=excluded.billing_mode,package_size=excluded.package_size,package_price_pence=excluded.package_price_pence,updated_at=CURRENT_TIMESTAMP`).bind(studentId,mode,size,mode==='package'?price:0).run();
 if(mode==='package')await db.prepare(`UPDATE recurring_sessions_v3 SET price_type='per_session',price_pence=?1,updated_at=CURRENT_TIMESTAMP WHERE student_id=?2 AND active=1`).bind(unitAmount(price,size,1),studentId).run();
}

async function occurrenceActionV6(request,env,ctx,id,action){
 const row=await occurrenceDetails(env.DB,id);if(!row)return json({error:'الحصة غير موجودة'},404);
 if(row.billing_mode!=='package')return base.fetch(request,env,ctx);
 if(action==='complete-paid'||action==='complete-unpaid')return completePackageOccurrence(env.DB,row);
 if(action==='reopen')return reopenPackageOccurrence(env.DB,row);
 if(action==='collect')return json({error:'تحصيل الباقة بيتسجل من زر «قبضت فلوس» بعد اكتمال عدد الحصص.'},409);
 return base.fetch(request,env,ctx);
}

async function completePackageOccurrence(db,row){
 if(row.status==='completed')return json({ok:true,unchanged:true,billing_mode:'package',package:await packageStateForOccurrence(db,row.id)});
 if(row.status!=='scheduled')return json({error:'الحصة مش مجدولة حاليًا'},409);
 let cycle=await db.prepare(`SELECT * FROM package_cycles_v6 WHERE student_id=?1 AND status='open' ORDER BY cycle_no DESC LIMIT 1`).bind(row.student_id).first();
 if(!cycle){const n=await db.prepare(`SELECT COALESCE(MAX(cycle_no),0)+1 n FROM package_cycles_v6 WHERE student_id=?1`).bind(row.student_id).first();const r=await db.prepare(`INSERT INTO package_cycles_v6(student_id,cycle_no,package_size,package_price_pence,status,started_on) VALUES(?1,?2,?3,?4,'open',?5)`).bind(row.student_id,Number(n?.n||1),row.package_size,row.package_price_pence,effectiveDate(row)).run();cycle=await db.prepare(`SELECT * FROM package_cycles_v6 WHERE id=?1`).bind(r.meta.last_row_id).first()}
 const count=await db.prepare(`SELECT COUNT(*) c FROM package_cycle_occurrences_v6 WHERE cycle_id=?1`).bind(cycle.id).first(),position=Number(count?.c||0)+1;
 if(position>Number(cycle.package_size))return json({error:'الدورة الحالية مكتملة بالفعل. أعيدي فتح الصفحة وحاولي مرة أخرى.'},409);
 const earned=unitAmount(cycle.package_price_pence,cycle.package_size,position);
 await db.batch([
  db.prepare(`UPDATE session_occurrences_v3 SET status='completed',gross_pence=?1,center_cut_pence=0,earned_pence=?1,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND status='scheduled'`).bind(earned,row.id),
  db.prepare(`INSERT INTO package_cycle_occurrences_v6(cycle_id,occurrence_id,position,earned_pence) VALUES(?1,?2,?3,?4)`).bind(cycle.id,row.id,position,earned)
 ]);
 if(position===Number(cycle.package_size))await db.prepare(`UPDATE package_cycles_v6 SET status='due',completed_on=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2`).bind(effectiveDate(row),cycle.id).run();
 await logActivity(db,'occurrence',row.id,'completed',`تمت حصة ${row.title}`,position===Number(cycle.package_size)?`اكتملت باقة ${cycle.package_size}/${cycle.package_size} · جاهزة للتحصيل`:`الدورة الحالية ${position}/${cycle.package_size}`);
 await rebalanceStudent(db,row.student_id);
 return json({ok:true,billing_mode:'package',earned_pence:earned,package:await packageStateForOccurrence(db,row.id)});
}

async function reopenPackageOccurrence(db,row){
 const link=await db.prepare(`SELECT x.*,c.student_id,c.status,c.cycle_no FROM package_cycle_occurrences_v6 x JOIN package_cycles_v6 c ON c.id=x.cycle_id WHERE x.occurrence_id=?1`).bind(row.id).first();
 if(!link)return baseLikeReopen(db,row.id);
 const allocated=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) v FROM package_receipt_allocations_v6 WHERE cycle_id=?1`).bind(link.cycle_id).first();
 const later=await db.prepare(`SELECT COUNT(*) c FROM package_cycle_occurrences_v6 x JOIN package_cycles_v6 c ON c.id=x.cycle_id WHERE c.student_id=?1 AND c.cycle_no>?2`).bind(link.student_id,link.cycle_no).first();
 if(Number(allocated?.v||0)>0||Number(later?.c||0)>0)return json({error:'مش ممكن نرجع الحصة لأن دورة الباقة بعدها اتقفلت أو اتسجل عليها دفع. استخدمي سجل النشاط للمراجعة بدل تغيير التاريخ.'},409);
 await db.prepare(`DELETE FROM package_cycle_occurrences_v6 WHERE occurrence_id=?1`).bind(row.id).run();
 await db.prepare(`UPDATE session_occurrences_v3 SET status='scheduled',earned_pence=0,gross_pence=?1,center_cut_pence=0,completed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?2`).bind(unitAmount(row.package_price_pence,row.package_size,1),row.id).run();
 await rebuildCycle(db,link.cycle_id);
 await rebalanceStudent(db,link.student_id);
 await logActivity(db,'occurrence',row.id,'reopened',`تم التراجع عن ${row.title}`,'رجعت الحصة للمجدول');
 return json({ok:true});
}

async function rebuildCycle(db,cycleId){
 const c=await db.prepare(`SELECT * FROM package_cycles_v6 WHERE id=?1`).bind(cycleId).first();if(!c)return;
 const rows=await db.prepare(`SELECT x.id,x.occurrence_id,COALESCE(o.rescheduled_to_date,o.session_date) d FROM package_cycle_occurrences_v6 x JOIN session_occurrences_v3 o ON o.id=x.occurrence_id WHERE x.cycle_id=?1 ORDER BY d,o.id`).bind(cycleId).all();
 let pos=0;for(const x of rows.results||[]){pos++;const earned=unitAmount(c.package_price_pence,c.package_size,pos);await db.batch([db.prepare(`UPDATE package_cycle_occurrences_v6 SET position=?1,earned_pence=?2 WHERE id=?3`).bind(pos,earned,x.id),db.prepare(`UPDATE session_occurrences_v3 SET earned_pence=?1,gross_pence=?1,center_cut_pence=0 WHERE id=?2`).bind(earned,x.occurrence_id)])}
 if(pos===0)await db.prepare(`DELETE FROM package_cycles_v6 WHERE id=?1`).bind(cycleId).run();else await db.prepare(`UPDATE package_cycles_v6 SET status=?1,completed_on=?2,paid_on=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?3`).bind(pos>=Number(c.package_size)?'due':'open',pos>=Number(c.package_size)?(rows.results||[]).at(-1)?.d:null,cycleId).run();
}

async function baseLikeReopen(db,id){await db.prepare(`UPDATE session_occurrences_v3 SET status='scheduled',earned_pence=0,completed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?1`).bind(id).run();return json({ok:true})}

async function createReceiptV6(request,db){
 const b=await safeJson(request)||{},studentId=positiveInt(b.student_id),amount=moneyPence(b.amount),date=validDate(b.received_at)||todayLondon();if(!studentId||amount<=0)return json({error:'اختاري الطالب واكتبي مبلغ صحيح'},400);
 const s=await db.prepare(`SELECT id,name FROM students_v3 WHERE id=?1 AND active=1 AND deleted_at IS NULL`).bind(studentId).first();if(!s)return json({error:'الطالب غير موجود'},404);
 const r=await db.prepare(`INSERT INTO student_receipts_v4(student_id,amount_pence,received_at,payment_method,note) VALUES(?1,?2,?3,?4,?5)`).bind(studentId,amount,date,paymentMethod(b.payment_method),text(b.note)).run();
 await logActivity(db,'receipt',r.meta.last_row_id,'created',`استلام من ${s.name}`,moneyText(amount));
 const state=await rebalanceStudent(db,studentId);return json({ok:true,id:r.meta.last_row_id,...state},201);
}
async function updateReceiptV6(request,db,id){const old=await db.prepare(`SELECT * FROM student_receipts_v4 WHERE id=?1 AND deleted_at IS NULL`).bind(id).first();if(!old)return json({error:'الاستلام غير موجود'},404);const b=await safeJson(request)||{},studentId=positiveInt(b.student_id)||old.student_id,amount=b.amount!==undefined?moneyPence(b.amount):old.amount_pence,date=validDate(b.received_at)||old.received_at;if(amount<=0)return json({error:'المبلغ غير صحيح'},400);await db.prepare(`UPDATE student_receipts_v4 SET student_id=?1,amount_pence=?2,received_at=?3,payment_method=?4,note=?5,updated_at=CURRENT_TIMESTAMP WHERE id=?6`).bind(studentId,amount,date,paymentMethod(b.payment_method||old.payment_method),text(b.note??old.note),id).run();await rebalanceStudent(db,old.student_id);const state=await rebalanceStudent(db,studentId);await logActivity(db,'receipt',id,'updated','تم تعديل استلام',moneyText(amount));return json({ok:true,id,...state})}
async function deleteReceiptV6(db,id){const r=await db.prepare(`SELECT * FROM student_receipts_v4 WHERE id=?1 AND deleted_at IS NULL`).bind(id).first();if(!r)return json({error:'الاستلام غير موجود'},404);await db.prepare(`UPDATE student_receipts_v4 SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?1`).bind(id).run();await rebalanceStudent(db,r.student_id);await logActivity(db,'receipt',id,'deleted','تم حذف استلام',moneyText(r.amount_pence));return json({ok:true})}
async function restoreReceiptV6(db,id){const r=await db.prepare(`SELECT * FROM student_receipts_v4 WHERE id=?1`).bind(id).first();if(!r)return json({error:'الاستلام غير موجود'},404);await db.prepare(`UPDATE student_receipts_v4 SET deleted_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?1`).bind(id).run();await rebalanceStudent(db,r.student_id);await logActivity(db,'receipt',id,'restored','تم استرجاع استلام',moneyText(r.amount_pence));return json({ok:true})}

async function rebalanceStudent(db,studentId){
 const receipts=await db.prepare(`SELECT * FROM student_receipts_v4 WHERE student_id=?1 AND deleted_at IS NULL ORDER BY received_at,id`).bind(studentId).all();
 await db.prepare(`DELETE FROM receipt_allocations_v4 WHERE receipt_id IN (SELECT id FROM student_receipts_v4 WHERE student_id=?1)`).bind(studentId).run();
 await db.prepare(`DELETE FROM package_receipt_allocations_v6 WHERE receipt_id IN (SELECT id FROM student_receipts_v4 WHERE student_id=?1)`).bind(studentId).run();
 const plan=await billingPlan(db,studentId);let totalAllocated=0;
 if(plan?.billing_mode==='package'){
  await db.prepare(`UPDATE package_cycles_v6 SET status=CASE WHEN (SELECT COUNT(*) FROM package_cycle_occurrences_v6 x WHERE x.cycle_id=package_cycles_v6.id)>=package_size THEN 'due' ELSE 'open' END,paid_on=NULL WHERE student_id=?1`).bind(studentId).run();
  const dues=await db.prepare(`SELECT * FROM package_cycles_v6 WHERE student_id=?1 AND status='due' ORDER BY completed_on,cycle_no`).bind(studentId).all();let ri=0,remaining=(receipts.results||[])[0]?.amount_pence||0;
  for(const d of dues.results||[]){let need=Number(d.package_price_pence||0);while(need>0&&ri<(receipts.results||[]).length){const rr=receipts.results[ri];if(remaining<=0){ri++;remaining=(receipts.results||[])[ri]?.amount_pence||0;continue}const take=Math.min(need,remaining);await db.prepare(`INSERT INTO package_receipt_allocations_v6(receipt_id,cycle_id,amount_pence) VALUES(?1,?2,?3)`).bind(rr.id,d.id,take).run();need-=take;remaining-=take;totalAllocated+=take}if(need===0)await db.prepare(`UPDATE package_cycles_v6 SET status='paid',paid_on=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?1`).bind(d.id).run()}
 }else{
  const dues=await db.prepare(`SELECT o.id,o.earned_pence,COALESCE((SELECT SUM(p.amount_pence) FROM payments_v3 p WHERE p.occurrence_id=o.id AND p.reversed_at IS NULL),0) direct_paid FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE r.student_id=?1 AND o.status='completed' ORDER BY COALESCE(o.rescheduled_to_date,o.session_date),o.id`).bind(studentId).all();let ri=0,remaining=(receipts.results||[])[0]?.amount_pence||0;
  for(const d of dues.results||[]){let need=Math.max(0,Number(d.earned_pence||0)-Number(d.direct_paid||0));while(need>0&&ri<(receipts.results||[]).length){const rr=receipts.results[ri];if(remaining<=0){ri++;remaining=(receipts.results||[])[ri]?.amount_pence||0;continue}const take=Math.min(need,remaining);await db.prepare(`INSERT INTO receipt_allocations_v4(receipt_id,occurrence_id,amount_pence) VALUES(?1,?2,?3)`).bind(rr.id,d.id,take).run();need-=take;remaining-=take;totalAllocated+=take}}
 }
 const total=(receipts.results||[]).reduce((n,r)=>n+Number(r.amount_pence||0),0);return{allocated_pence:totalAllocated,credit_pence:Math.max(0,total-totalAllocated)};
}

async function studentSummariesV6(db){
 const students=await db.prepare(`SELECT s.*,COALESCE(b.billing_mode,'per_session') billing_mode,COALESCE(b.package_size,8) package_size,COALESCE(b.package_price_pence,0) package_price_pence FROM students_v3 s LEFT JOIN student_billing_v6 b ON b.student_id=s.id WHERE s.active=1 AND s.deleted_at IS NULL ORDER BY s.name`).all();const out=[];
 for(const s of students.results||[])out.push(await studentSummaryOne(db,s));
 out.sort((a,b)=>Number(b.due_now_pence||0)-Number(a.due_now_pence||0)||String(a.name).localeCompare(String(b.name),'ar'));
 return json({students:out,total_outstanding_pence:out.reduce((n,x)=>n+Number(x.due_now_pence||0),0)});
}

async function studentSummaryOne(db,s){
 const receipts=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) total FROM student_receipts_v4 WHERE student_id=?1 AND deleted_at IS NULL`).bind(s.id).first();
 const occAlloc=await db.prepare(`SELECT COALESCE(SUM(a.amount_pence),0) total FROM receipt_allocations_v4 a JOIN student_receipts_v4 r ON r.id=a.receipt_id WHERE r.student_id=?1 AND r.deleted_at IS NULL`).bind(s.id).first();
 const pkgAlloc=await db.prepare(`SELECT COALESCE(SUM(a.amount_pence),0) total FROM package_receipt_allocations_v6 a JOIN student_receipts_v4 r ON r.id=a.receipt_id WHERE r.student_id=?1 AND r.deleted_at IS NULL`).bind(s.id).first();
 const last=await db.prepare(`SELECT amount_pence,received_at FROM student_receipts_v4 WHERE student_id=?1 AND deleted_at IS NULL ORDER BY received_at DESC,id DESC LIMIT 1`).bind(s.id).first();
 let due=0,count=0,progress=null,workNotDue=0;
 if(s.billing_mode==='package'){
  let cycle=await db.prepare(`SELECT c.*,COUNT(x.id) completed_count,COALESCE(SUM(x.earned_pence),0) work_pence,COALESCE((SELECT SUM(a.amount_pence) FROM package_receipt_allocations_v6 a WHERE a.cycle_id=c.id),0) paid_pence FROM package_cycles_v6 c LEFT JOIN package_cycle_occurrences_v6 x ON x.cycle_id=c.id WHERE c.student_id=?1 GROUP BY c.id ORDER BY c.cycle_no DESC LIMIT 1`).bind(s.id).first();
  if(!cycle)cycle={cycle_no:1,package_size:s.package_size,package_price_pence:s.package_price_pence,status:'open',completed_count:0,work_pence:0,paid_pence:0};
  const dueRow=await db.prepare(`SELECT COALESCE(SUM(MAX(0,c.package_price_pence-COALESCE((SELECT SUM(a.amount_pence) FROM package_receipt_allocations_v6 a WHERE a.cycle_id=c.id),0))),0) total,COUNT(*) count FROM package_cycles_v6 c WHERE c.student_id=?1 AND c.status='due'`).bind(s.id).first();due=Number(dueRow?.total||0);count=Number(dueRow?.count||0);workNotDue=cycle.status==='open'?Number(cycle.work_pence||0):0;progress={cycle_no:Number(cycle.cycle_no||1),completed:Number(cycle.completed_count||0),size:Number(cycle.package_size||s.package_size),status:cycle.status,package_price_pence:Number(cycle.package_price_pence||s.package_price_pence),paid_pence:Number(cycle.paid_pence||0)};
 }else{
  const d=await db.prepare(`SELECT COALESCE(SUM(MAX(0,o.earned_pence-COALESCE((SELECT SUM(p.amount_pence) FROM payments_v3 p WHERE p.occurrence_id=o.id AND p.reversed_at IS NULL),0)-COALESCE((SELECT SUM(a.amount_pence) FROM receipt_allocations_v4 a JOIN student_receipts_v4 rr ON rr.id=a.receipt_id WHERE a.occurrence_id=o.id AND rr.deleted_at IS NULL),0))),0) total,COALESCE(SUM(CASE WHEN o.earned_pence>COALESCE((SELECT SUM(p.amount_pence) FROM payments_v3 p WHERE p.occurrence_id=o.id AND p.reversed_at IS NULL),0)+COALESCE((SELECT SUM(a.amount_pence) FROM receipt_allocations_v4 a JOIN student_receipts_v4 rr ON rr.id=a.receipt_id WHERE a.occurrence_id=o.id AND rr.deleted_at IS NULL),0) THEN 1 ELSE 0 END),0) count FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE r.student_id=?1 AND o.status='completed'`).bind(s.id).first();due=Number(d?.total||0);count=Number(d?.count||0);
 }
 const credit=Math.max(0,Number(receipts?.total||0)-Number(occAlloc?.total||0)-Number(pkgAlloc?.total||0));
 return{...s,outstanding_pence:due,due_now_pence:due,outstanding_count:count,credit_pence:credit,last_payment_pence:Number(last?.amount_pence||0),last_payment_date:last?.received_at||null,package_progress:progress,work_not_due_pence:workNotDue};
}

async function studentAccountV6(db,studentId){
 const s=await db.prepare(`SELECT s.*,COALESCE(b.billing_mode,'per_session') billing_mode,COALESCE(b.package_size,8) package_size,COALESCE(b.package_price_pence,0) package_price_pence FROM students_v3 s LEFT JOIN student_billing_v6 b ON b.student_id=s.id WHERE s.id=?1 AND s.active=1 AND s.deleted_at IS NULL`).bind(studentId).first();if(!s)return json({error:'الطالب غير موجود'},404);
 const summary=await studentSummaryOne(db,s),cycles=await db.prepare(`SELECT c.*,COUNT(x.id) completed_count,COALESCE(SUM(x.earned_pence),0) work_pence,COALESCE((SELECT SUM(a.amount_pence) FROM package_receipt_allocations_v6 a WHERE a.cycle_id=c.id),0) paid_pence FROM package_cycles_v6 c LEFT JOIN package_cycle_occurrences_v6 x ON x.cycle_id=c.id WHERE c.student_id=?1 GROUP BY c.id ORDER BY c.cycle_no DESC LIMIT 20`).bind(studentId).all();
 const timeline=await db.prepare(`SELECT 'session' kind,COALESCE(o.rescheduled_to_date,o.session_date) date,o.id,o.status,o.earned_pence,r.title,CASE WHEN b.billing_mode='package' THEN 'package' ELSE 'per_session' END billing_mode FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id LEFT JOIN student_billing_v6 b ON b.student_id=r.student_id WHERE r.student_id=?1 UNION ALL SELECT 'receipt' kind,received_at date,id,CASE WHEN deleted_at IS NULL THEN 'active' ELSE 'deleted' END status,amount_pence earned_pence,'استلام' title,'receipt' billing_mode FROM student_receipts_v4 WHERE student_id=?1 ORDER BY date DESC LIMIT 50`).bind(studentId).all();return json({student:summary,package_cycles:cycles.results||[],timeline:timeline.results||[]});
}

async function dashboardV6(request,env,ctx){
 const url=new URL(request.url),date=validDate(url.searchParams.get('date'))||todayLondon();
 const baseReq=new Request(new URL(`/api/v4/dashboard?date=${date}`,request.url),{method:'GET',headers:request.headers}),r=await base.fetch(baseReq,env,ctx);if(!r.ok)return r;const d=await r.json();
 const month=date.slice(0,7),earned=await env.DB.prepare(`SELECT COALESCE(SUM(earned_pence),0) v FROM session_occurrences_v3 WHERE status='completed' AND substr(COALESCE(rescheduled_to_date,session_date),1,7)=?1`).bind(month).first(),due=await totalDueNow(env.DB),workNotDue=await totalPackageWorkNotDue(env.DB);
 for(const s of d.sessions||[]){const plan=s.student_id?await billingPlan(env.DB,s.student_id):null;s.billing_mode=plan?.billing_mode||'per_session';if(s.billing_mode==='package'){s.outstanding_pence=0;s.paid_pence=0;s.package=await packageStateForOccurrence(env.DB,s.id)||await currentPackageState(env.DB,s.student_id)}}
 d.summary.earned_pence=Number(earned?.v||0);d.summary.outstanding_pence=due;d.summary.work_not_due_pence=workNotDue;return json(d);
}

async function scheduleRangeV6(url,db){
 const start=validDate(url.searchParams.get('start')),end=validDate(url.searchParams.get('end'));if(!start||!end||start>end)return json({error:'الفترة غير صحيحة'},400);const days=daysBetween(start,end);if(days.length>62)return json({error:'اختاري فترة أقصر'},400);
 const sessions=await db.prepare(`SELECT r.*,s.name student_name,COALESCE(b.billing_mode,'per_session') billing_mode,COALESCE(b.package_size,8) package_size,COALESCE(b.package_price_pence,0) package_price_pence FROM recurring_sessions_v3 r LEFT JOIN students_v3 s ON s.id=r.student_id LEFT JOIN student_billing_v6 b ON b.student_id=r.student_id WHERE r.active=1`).all();
 const occ=await db.prepare(`SELECT o.*,r.student_id,r.title,r.session_type,r.duration_minutes,r.travel_minutes FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE (COALESCE(o.rescheduled_to_date,o.session_date) BETWEEN ?1 AND ?2) OR (o.session_date BETWEEN ?1 AND ?2)`).bind(start,end).all();const byOriginal=new Map((occ.results||[]).map(o=>[`${o.recurring_session_id}|${o.session_date}`,o])),out=[];
 for(const date of days){const wd=new Date(`${date}T12:00:00Z`).getUTCDay();for(const s of sessions.results||[]){if(Number(s.weekday)!==wd)continue;const o=byOriginal.get(`${s.id}|${date}`);if(o?.rescheduled_to_date&&o.rescheduled_to_date!==date)continue;out.push(scheduleItem(date,s,o))}for(const o of occ.results||[]){if(o.rescheduled_to_date===date&&o.session_date!==date){const s=(sessions.results||[]).find(x=>Number(x.id)===Number(o.recurring_session_id));if(s)out.push(scheduleItem(date,s,o))}}
 }
 out.sort((a,b)=>a.date.localeCompare(b.date)||String(a.start_time||'99:99').localeCompare(String(b.start_time||'99:99')));return json({start,end,items:out});
}
function scheduleItem(date,s,o){return{date,occurrence_id:o?.id||null,recurring_session_id:s.id,student_id:s.student_id,title:s.title,session_type:s.session_type,start_time:o?.rescheduled_to_start||o?.scheduled_start||s.start_time||'',duration_minutes:s.duration_minutes,travel_minutes:s.travel_minutes,status:o?.status||'scheduled',billing_mode:s.billing_mode||'per_session',package_size:s.package_size,package_price_pence:s.package_price_pence}}

async function reportV6(url,db){
 const month=validMonth(url.searchParams.get('month'))||todayLondon().slice(0,7);const earned=await db.prepare(`SELECT COALESCE(SUM(earned_pence),0) total,COUNT(*) sessions FROM session_occurrences_v3 WHERE status='completed' AND substr(COALESCE(rescheduled_to_date,session_date),1,7)=?1`).bind(month).first();
 const receipts=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) v FROM student_receipts_v4 WHERE deleted_at IS NULL AND substr(received_at,1,7)=?1`).bind(month).first(),direct=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) v FROM payments_v3 WHERE reversed_at IS NULL AND substr(paid_at,1,7)=?1`).bind(month).first(),other=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) v FROM other_income_v3 WHERE deleted_at IS NULL AND substr(income_date,1,7)=?1`).bind(month).first(),exp=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) total,COALESCE(SUM(CASE WHEN scope='business' THEN amount_pence ELSE 0 END),0) business,COALESCE(SUM(CASE WHEN scope='personal' THEN amount_pence ELSE 0 END),0) personal FROM expenses_v3 WHERE deleted_at IS NULL AND substr(expense_date,1,7)=?1`).bind(month).first();
 const byType=await db.prepare(`SELECT r.session_type key,SUM(o.earned_pence) amount_pence,COUNT(*) count FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE o.status='completed' AND substr(COALESCE(o.rescheduled_to_date,o.session_date),1,7)=?1 GROUP BY r.session_type ORDER BY amount_pence DESC`).bind(month).all(),byBilling=await db.prepare(`SELECT COALESCE(b.billing_mode,'per_session') key,SUM(o.earned_pence) amount_pence,COUNT(*) count FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id LEFT JOIN student_billing_v6 b ON b.student_id=r.student_id WHERE o.status='completed' AND substr(COALESCE(o.rescheduled_to_date,o.session_date),1,7)=?1 GROUP BY key`).bind(month).all(),expenseCats=await db.prepare(`SELECT category key,SUM(amount_pence) amount_pence,COUNT(*) count FROM expenses_v3 WHERE deleted_at IS NULL AND substr(expense_date,1,7)=?1 GROUP BY category ORDER BY amount_pence DESC`).bind(month).all();
 const cash=Number(receipts?.v||0)+Number(direct?.v||0),expenses=Number(exp?.total||0);return json({month,summary:{worked_pence:Number(earned?.total||0),completed_sessions:Number(earned?.sessions||0),student_cash_pence:cash,other_income_pence:Number(other?.v||0),expenses_pence:expenses,business_expenses_pence:Number(exp?.business||0),personal_expenses_pence:Number(exp?.personal||0),cash_net_pence:cash+Number(other?.v||0)-expenses,due_now_pence:await totalDueNow(db),work_not_due_pence:await totalPackageWorkNotDue(db)},by_type:byType.results||[],by_billing:byBilling.results||[],expenses_by_category:expenseCats.results||[]});
}

async function insightsV6(url,db){const date=validDate(url.searchParams.get('date'))||todayLondon(),month=date.slice(0,7),due=await totalDueNow(db),work=await totalPackageWorkNotDue(db),ready=await db.prepare(`SELECT COUNT(*) c FROM package_cycles_v6 WHERE status='due'`).first(),near=await db.prepare(`SELECT COUNT(*) c FROM (SELECT c.id,c.package_size,COUNT(x.id) n FROM package_cycles_v6 c LEFT JOIN package_cycle_occurrences_v6 x ON x.cycle_id=c.id WHERE c.status='open' GROUP BY c.id HAVING n>=c.package_size-1)`).first(),r=await reportV6(new URL(`https://local/api/v6/reports?month=${month}`),db),rep=await r.json(),ins=[];if(Number(ready?.c||0)>0)ins.push({tone:'attention',title:'في باقات جاهزة للتحصيل',text:`${ready.c} دورة اكتملت ووصل موعد دفعها.`});if(Number(near?.c||0)>0)ins.push({tone:'info',title:'دفعات قريبة',text:`${near.c} دورة فاضل لها حصة تقريبًا على موعد الدفع.`});if(work>0)ins.push({tone:'info',title:'شغل اتعمل ولسه موعد دفعه مجاش',text:`قيمة الشغل داخل الدورات المفتوحة ${moneyText(work)}.`});if(Number(rep.summary.cash_net_pence||0)<0)ins.push({tone:'attention',title:'المصروف أعلى من المقبوض',text:'راجعي المصروفات والتحصيلات المسجلة هذا الشهر.'});if(!ins.length)ins.push({tone:'good',title:'الصورة مستقرة',text:'مفيش حاجة ملحّة محتاجة مراجعة دلوقتي.'});return json({date,insights:ins.slice(0,5),due_now_pence:due})}

async function reviewV6(db){const duplicates=await db.prepare(`SELECT entity_type,title,detail,COUNT(*) c,MAX(created_at) latest FROM activity_events_v4 WHERE created_at>=datetime('now','-2 days') GROUP BY entity_type,title,detail,strftime('%Y-%m-%d %H:%M',created_at) HAVING COUNT(*)>1 ORDER BY latest DESC LIMIT 10`).all(),due=await db.prepare(`SELECT s.name,c.id,c.package_price_pence,c.completed_on FROM package_cycles_v6 c JOIN students_v3 s ON s.id=c.student_id WHERE c.status='due' ORDER BY c.completed_on LIMIT 10`).all(),items=[];for(const d of duplicates.results||[])items.push({type:'duplicate',title:`حركة مكررة محتملة: ${d.title}`,detail:d.detail||'',severity:'review'});for(const d of due.results||[])items.push({type:'package_due',title:`${d.name}: الباقة اكتملت`,detail:`جاهز للتحصيل ${moneyText(d.package_price_pence)}`,severity:'attention'});return json({items,all_good:items.length===0})}

async function resetV6(request,env,ctx){const r=await base.fetch(request,env,ctx);if(!r.ok)return r;await env.DB.batch([env.DB.prepare(`DELETE FROM package_receipt_allocations_v6`),env.DB.prepare(`DELETE FROM package_cycle_occurrences_v6`),env.DB.prepare(`DELETE FROM package_cycles_v6`),env.DB.prepare(`DELETE FROM student_billing_v6`),env.DB.prepare(`DELETE FROM monthly_due_allocations_v5`),env.DB.prepare(`DELETE FROM monthly_dues_v5`),env.DB.prepare(`DELETE FROM mutation_dedupe_v1`)]).catch(()=>{});return r}

async function totalDueNow(db){const per=await db.prepare(`SELECT COALESCE(SUM(MAX(0,o.earned_pence-COALESCE((SELECT SUM(p.amount_pence) FROM payments_v3 p WHERE p.occurrence_id=o.id AND p.reversed_at IS NULL),0)-COALESCE((SELECT SUM(a.amount_pence) FROM receipt_allocations_v4 a JOIN student_receipts_v4 rr ON rr.id=a.receipt_id WHERE a.occurrence_id=o.id AND rr.deleted_at IS NULL),0))),0) v FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id LEFT JOIN student_billing_v6 b ON b.student_id=r.student_id WHERE o.status='completed' AND COALESCE(b.billing_mode,'per_session')='per_session'`).first(),pkg=await db.prepare(`SELECT COALESCE(SUM(MAX(0,c.package_price_pence-COALESCE((SELECT SUM(a.amount_pence) FROM package_receipt_allocations_v6 a WHERE a.cycle_id=c.id),0))),0) v FROM package_cycles_v6 c WHERE c.status='due'`).first();return Number(per?.v||0)+Number(pkg?.v||0)}
async function totalPackageWorkNotDue(db){const r=await db.prepare(`SELECT COALESCE(SUM(x.earned_pence),0) v FROM package_cycle_occurrences_v6 x JOIN package_cycles_v6 c ON c.id=x.cycle_id WHERE c.status='open'`).first();return Number(r?.v||0)}
async function billingPlan(db,studentId){return db.prepare(`SELECT * FROM student_billing_v6 WHERE student_id=?1`).bind(studentId).first()}
async function occurrenceDetails(db,id){return db.prepare(`SELECT o.*,COALESCE(o.rescheduled_to_date,o.session_date) effective_date,r.student_id,r.title,r.session_type,r.duration_minutes,r.travel_minutes,COALESCE(b.billing_mode,'per_session') billing_mode,COALESCE(b.package_size,8) package_size,COALESCE(b.package_price_pence,0) package_price_pence FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id LEFT JOIN student_billing_v6 b ON b.student_id=r.student_id WHERE o.id=?1`).bind(id).first()}
async function occurrenceIsPackage(db,id){const r=await occurrenceDetails(db,id);return r?.billing_mode==='package'}
async function packageStateForOccurrence(db,id){return db.prepare(`SELECT c.id cycle_id,c.cycle_no,c.package_size,c.package_price_pence,c.status,x.position completed,COALESCE((SELECT SUM(a.amount_pence) FROM package_receipt_allocations_v6 a WHERE a.cycle_id=c.id),0) paid_pence FROM package_cycle_occurrences_v6 x JOIN package_cycles_v6 c ON c.id=x.cycle_id WHERE x.occurrence_id=?1`).bind(id).first()}
async function currentPackageState(db,studentId){let c=await db.prepare(`SELECT c.id cycle_id,c.cycle_no,c.package_size,c.package_price_pence,c.status,COUNT(x.id) completed,COALESCE((SELECT SUM(a.amount_pence) FROM package_receipt_allocations_v6 a WHERE a.cycle_id=c.id),0) paid_pence FROM package_cycles_v6 c LEFT JOIN package_cycle_occurrences_v6 x ON x.cycle_id=c.id WHERE c.student_id=?1 GROUP BY c.id ORDER BY c.cycle_no DESC LIMIT 1`).bind(studentId).first();if(c)return c;const p=await billingPlan(db,studentId);return p?{cycle_id:null,cycle_no:1,package_size:p.package_size,package_price_pence:p.package_price_pence,status:'open',completed:0,paid_pence:0}:null}

async function dedupeMutation(request,env,ctx,handler){const url=new URL(request.url),body=await request.clone().text(),cookie=request.headers.get('cookie')||'',key=await sha256(`${request.method}\n${url.pathname}${url.search}\n${cookie}\n${body}`),old=await env.DB.prepare(`SELECT *,CASE WHEN completed_at>=datetime('now','-2 seconds') THEN 1 ELSE 0 END fresh FROM mutation_dedupe_v1 WHERE dedupe_key=?1`).bind(key).first();if(old?.status==='done'&&Number(old.fresh)===1)return replay(old);if(old?.status==='pending'&&old.created_at){for(let i=0;i<30;i++){await sleep(150);const r=await env.DB.prepare(`SELECT * FROM mutation_dedupe_v1 WHERE dedupe_key=?1`).bind(key).first();if(r?.status==='done')return replay(r)}return json({error:'العملية لسه بتتحفظ. استني لحظة.'},409)}if(old)await env.DB.prepare(`DELETE FROM mutation_dedupe_v1 WHERE dedupe_key=?1`).bind(key).run();await env.DB.prepare(`INSERT INTO mutation_dedupe_v1(dedupe_key,method,path,status) VALUES(?1,?2,?3,'pending')`).bind(key,request.method,`${url.pathname}${url.search}`).run();try{const response=await handler();if(!response.ok){await env.DB.prepare(`DELETE FROM mutation_dedupe_v1 WHERE dedupe_key=?1`).bind(key).run();return response}const txt=await response.clone().text();await env.DB.prepare(`UPDATE mutation_dedupe_v1 SET status='done',response_status=?1,response_body=?2,content_type=?3,completed_at=CURRENT_TIMESTAMP WHERE dedupe_key=?4`).bind(response.status,txt,response.headers.get('content-type')||JSON_HEADERS['content-type'],key).run();ctx?.waitUntil?.(env.DB.prepare(`DELETE FROM mutation_dedupe_v1 WHERE created_at<datetime('now','-1 day')`).run());return response}catch(e){await env.DB.prepare(`DELETE FROM mutation_dedupe_v1 WHERE dedupe_key=?1`).bind(key).run();throw e}}
function replay(r){return new Response(r.response_body||'',{status:Number(r.response_status||200),headers:{'content-type':r.content_type||JSON_HEADERS['content-type'],'x-sozan-deduplicated':'1'}})}

async function logActivity(db,type,id,action,title,detail){await db.prepare(`INSERT INTO activity_events_v4(entity_type,entity_id,action,title,detail,undoable) VALUES(?1,?2,?3,?4,?5,0)`).bind(type,id,action,title,detail||null).run()}
function unitAmount(total,size,pos){total=Math.max(0,Number(total||0));size=Math.max(1,Number(size||1));pos=Math.max(1,Number(pos||1));return Math.floor(total*pos/size)-Math.floor(total*(pos-1)/size)}
function normalizeMode(v){return v==='package'?'package':'per_session'}
function packageSize(v){const n=Math.round(Number(v||PACKAGE_DEFAULT));return Math.max(1,Math.min(100,Number.isFinite(n)?n:PACKAGE_DEFAULT))}
function moneyPence(v){const n=Number(String(v??'0').replace(',','.'));return Number.isFinite(n)?Math.max(0,Math.round(n*100)):0}
function positiveInt(v){const n=Number(v);return Number.isInteger(n)&&n>0?n:0}
function text(v){const s=String(v??'').trim();return s?s.slice(0,300):null}
function paymentMethod(v){return ['cash','bank','wallet','other'].includes(v)?v:'cash'}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v||''))?String(v):null}
function validMonth(v){return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v||''))?String(v):null}
function todayLondon(){const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),g=t=>p.find(x=>x.type===t)?.value;return `${g('year')}-${g('month')}-${g('day')}`}
function effectiveDate(r){return r.effective_date||r.rescheduled_to_date||r.session_date||todayLondon()}
function daysBetween(a,b){const out=[],d=new Date(`${a}T12:00:00Z`),end=new Date(`${b}T12:00:00Z`);while(d<=end){out.push(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()+1)}return out}
function moneyText(p){return `${(Number(p||0)/100).toLocaleString('ar-EG',{maximumFractionDigits:2})} ج`}
async function safeJson(r){try{return await r.clone().json()}catch{return null}}
function jsonRequest(request,body){const h=new Headers(request.headers);h.set('content-type','application/json');return new Request(request.url,{method:request.method,headers:h,body:JSON.stringify(body)})}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:JSON_HEADERS})}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
async function sha256(s){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return[...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('')}
