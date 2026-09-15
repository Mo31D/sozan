import app from './v6.js';

const EXTRA='<script type="module" src="/v6-extra.js"></script>';
const JSON_HEADERS={'content-type':'application/json; charset=utf-8'};
let compatibilityReady=null;

export default{
 async fetch(request,env,ctx){
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(method==='GET'&&(path==='/'||path==='/index.html'))return serveHtml(request,env);
  if(!path.startsWith('/api/'))return app.fetch(request,env,ctx);
  if(path==='/api/health'||path==='/api/login'||path==='/api/logout')return app.fetch(request,env,ctx);

  try{
   await ensureCompatibility(env.DB);

   if(path==='/api/v4/students/summary'&&method==='GET'){
    const auth=await authCheck(request,env,ctx);if(auth)return auth;
    return json({students:await summaryRows(env.DB),total_outstanding_pence:await canonicalTotalDue(env.DB)});
   }
   const account=path.match(/^\/api\/v4\/students\/(\d+)\/account$/);
   if(account&&method==='GET'){
    const auth=await authCheck(request,env,ctx);if(auth)return auth;
    return canonicalAccount(env.DB,Number(account[1]));
   }
   if((path==='/api/v6/reports'||path==='/api/v4/reports')&&method==='GET'){
    const auth=await authCheck(request,env,ctx);if(auth)return auth;
    return canonicalReport(url,env.DB);
   }
   if(path==='/api/v4/review'&&method==='GET'){
    const auth=await authCheck(request,env,ctx);if(auth)return auth;
    return canonicalReview(env.DB);
   }

   let forwarded=request;
   if(path==='/api/v3/sessions'&&method==='POST')forwarded=await inheritPackageOnCreate(request,env.DB);
   const context=await mutationContext(forwarded,env.DB);
   let response=await app.fetch(forwarded,env,ctx);
   if(!response.ok)return response;

   if(context.studentIds.size){
    for(const id of context.studentIds)await unifiedRebalance(env.DB,id);
   }

   if((path==='/api/v4/dashboard'||path==='/api/v3/dashboard'||path==='/api/v3/today')&&method==='GET'){
    const data=await response.json();
    data.summary=data.summary||{};
    data.summary.outstanding_pence=await canonicalTotalDue(env.DB);
    data.summary.work_not_due_pence=await totalOpenPackageWork(env.DB);
    for(const s of data.sessions||[]){
     if(s.billing_mode==='package'&&s.status==='scheduled')s.package=await nextPackageState(env.DB,Number(s.student_id||0));
    }
    return json(data,response.status);
   }

   const receiptId=path.match(/^\/api\/v4\/receipts\/(\d+)$/);
   if(path==='/api/v4/receipts'&&method==='POST'){
    const data=await response.json();return rewriteReceiptResult(env.DB,data,response.status,Number(data.id||0));
   }
   if(receiptId&&method==='PATCH'){
    const data=await response.json();return rewriteReceiptResult(env.DB,data,response.status,Number(receiptId[1]));
   }

   return response;
  }catch(e){console.error(e);return json({error:'حدث خطأ غير متوقع',detail:String(e?.message||e)},500)}
 }
};

async function serveHtml(request,env){
 const response=await env.ASSETS.fetch(request);if(!response.ok)return response;
 let html=await response.text();if(!html.includes('/v6-extra.js'))html=html.replace('</body>',`  ${EXTRA}\n</body>`);
 const headers=new Headers(response.headers);headers.set('content-type','text/html; charset=utf-8');headers.set('cache-control','no-cache');return new Response(html,{status:response.status,headers});
}

async function authCheck(request,env,ctx){
 const probe=new Request(new URL('/api/v3/settings',request.url),{method:'GET',headers:request.headers});
 const r=await app.fetch(probe,env,ctx);return r.ok?null:r;
}

async function ensureCompatibility(db){
 if(compatibilityReady)return compatibilityReady;
 compatibilityReady=(async()=>{
  await db.batch([
   db.prepare(`CREATE TABLE IF NOT EXISTS student_billing_v6(student_id INTEGER PRIMARY KEY,billing_mode TEXT NOT NULL DEFAULT 'per_session' CHECK(billing_mode IN ('per_session','package')),package_size INTEGER NOT NULL DEFAULT 8 CHECK(package_size BETWEEN 1 AND 100),package_price_pence INTEGER NOT NULL DEFAULT 0 CHECK(package_price_pence>=0),cycle_anchor_date TEXT NOT NULL DEFAULT (date('now')),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(student_id) REFERENCES students_v3(id) ON DELETE CASCADE)`),
   db.prepare(`CREATE TABLE IF NOT EXISTS package_cycles_v6(id INTEGER PRIMARY KEY AUTOINCREMENT,student_id INTEGER NOT NULL,cycle_no INTEGER NOT NULL,package_size INTEGER NOT NULL,package_price_pence INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','due','paid')),started_on TEXT,completed_on TEXT,paid_on TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(student_id,cycle_no),FOREIGN KEY(student_id) REFERENCES students_v3(id) ON DELETE CASCADE)`),
   db.prepare(`CREATE TABLE IF NOT EXISTS package_cycle_occurrences_v6(id INTEGER PRIMARY KEY AUTOINCREMENT,cycle_id INTEGER NOT NULL,occurrence_id INTEGER NOT NULL UNIQUE,position INTEGER NOT NULL,earned_pence INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(cycle_id) REFERENCES package_cycles_v6(id) ON DELETE CASCADE,FOREIGN KEY(occurrence_id) REFERENCES session_occurrences_v3(id) ON DELETE CASCADE)`),
   db.prepare(`CREATE TABLE IF NOT EXISTS package_receipt_allocations_v6(id INTEGER PRIMARY KEY AUTOINCREMENT,receipt_id INTEGER NOT NULL,cycle_id INTEGER NOT NULL,amount_pence INTEGER NOT NULL CHECK(amount_pence>0),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(receipt_id) REFERENCES student_receipts_v4(id) ON DELETE CASCADE,FOREIGN KEY(cycle_id) REFERENCES package_cycles_v6(id) ON DELETE CASCADE)`),
   db.prepare(`CREATE INDEX IF NOT EXISTS idx_package_cycles_student_v6 ON package_cycles_v6(student_id,status,cycle_no)`),
   db.prepare(`CREATE INDEX IF NOT EXISTS idx_package_occ_cycle_v6 ON package_cycle_occurrences_v6(cycle_id,position)`),
   db.prepare(`CREATE INDEX IF NOT EXISTS idx_package_alloc_receipt_v6 ON package_receipt_allocations_v6(receipt_id)`),
   db.prepare(`CREATE INDEX IF NOT EXISTS idx_package_alloc_cycle_v6 ON package_receipt_allocations_v6(cycle_id)`)
  ]);

  await db.prepare(`INSERT INTO student_billing_v6(student_id,billing_mode,package_size,package_price_pence,cycle_anchor_date)
    SELECT r.student_id,'package',8,MAX(r.price_pence),COALESCE(MIN(r.billing_start_month)||'-01',date('now'))
    FROM recurring_sessions_v3 r
    WHERE r.active=1 AND r.student_id IS NOT NULL AND r.price_type='monthly'
    GROUP BY r.student_id
    ON CONFLICT(student_id) DO UPDATE SET billing_mode='package',package_size=8,package_price_pence=excluded.package_price_pence,cycle_anchor_date=MIN(student_billing_v6.cycle_anchor_date,excluded.cycle_anchor_date),updated_at=CURRENT_TIMESTAMP`).run();
  await db.prepare(`INSERT INTO student_billing_v6(student_id,billing_mode,package_size,package_price_pence,cycle_anchor_date)
    SELECT s.id,'per_session',8,0,date('now') FROM students_v3 s WHERE s.active=1 AND s.deleted_at IS NULL
    ON CONFLICT(student_id) DO NOTHING`).run();

  const legacy=await db.prepare(`SELECT b.student_id,b.package_size,b.package_price_pence,b.cycle_anchor_date
    FROM student_billing_v6 b
    WHERE b.billing_mode='package' AND EXISTS(SELECT 1 FROM recurring_sessions_v3 r WHERE r.student_id=b.student_id AND r.price_type='monthly')`).all();
  for(const p of legacy.results||[]){await backfillLegacyMonthly(db,p);await unifiedRebalance(db,Number(p.student_id));}
 })().catch(e=>{compatibilityReady=null;throw e});
 return compatibilityReady;
}

async function backfillLegacyMonthly(db,plan){
 const studentId=Number(plan.student_id),size=Math.max(1,Number(plan.package_size||8)),price=Math.max(0,Number(plan.package_price_pence||0)),anchor=validDate(plan.cycle_anchor_date)||todayLondon();
 const rows=await db.prepare(`SELECT o.id,COALESCE(o.rescheduled_to_date,o.session_date) d
   FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id
   WHERE r.student_id=?1 AND r.price_type='monthly' AND o.status='completed'
     AND COALESCE(o.rescheduled_to_date,o.session_date)>=?2
     AND NOT EXISTS(SELECT 1 FROM package_cycle_occurrences_v6 x WHERE x.occurrence_id=o.id)
   ORDER BY d,o.id`).bind(studentId,anchor).all();
 for(const o of rows.results||[]){
  let cycle=await db.prepare(`SELECT c.*,COUNT(x.id) n FROM package_cycles_v6 c LEFT JOIN package_cycle_occurrences_v6 x ON x.cycle_id=c.id WHERE c.student_id=?1 GROUP BY c.id HAVING n<c.package_size ORDER BY c.cycle_no DESC LIMIT 1`).bind(studentId).first();
  if(!cycle){const n=await db.prepare(`SELECT COALESCE(MAX(cycle_no),0)+1 n FROM package_cycles_v6 WHERE student_id=?1`).bind(studentId).first();const c=await db.prepare(`INSERT INTO package_cycles_v6(student_id,cycle_no,package_size,package_price_pence,status,started_on) VALUES(?1,?2,?3,?4,'open',?5)`).bind(studentId,Number(n?.n||1),size,price,o.d).run();cycle={id:Number(c.meta?.last_row_id||0),cycle_no:Number(n?.n||1),package_size:size,package_price_pence:price,n:0};}
  const position=Number(cycle.n||0)+1,earned=unitShare(Number(cycle.package_price_pence||price),Number(cycle.package_size||size),position);
  await db.batch([
   db.prepare(`INSERT OR IGNORE INTO package_cycle_occurrences_v6(cycle_id,occurrence_id,position,earned_pence) VALUES(?1,?2,?3,?4)`).bind(cycle.id,o.id,position,earned),
   db.prepare(`UPDATE session_occurrences_v3 SET gross_pence=?1,center_cut_pence=0,earned_pence=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2`).bind(earned,o.id)
  ]);
  if(position>=Number(cycle.package_size||size))await db.prepare(`UPDATE package_cycles_v6 SET status='due',completed_on=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2`).bind(o.d,cycle.id).run();
 }
}

async function inheritPackageOnCreate(request,db){
 const body=await safeJson(request);if(!body)return request;
 let studentId=positiveInt(body.student_id),plan=null;
 if(studentId)plan=await db.prepare(`SELECT * FROM student_billing_v6 WHERE student_id=?1`).bind(studentId).first();
 if(!plan&&!['center_group','own_group'].includes(body.session_type)){
  const name=String(body.student_name||body.title||'').trim();
  if(name){const s=await db.prepare(`SELECT s.id,b.billing_mode,b.package_size,b.package_price_pence FROM students_v3 s LEFT JOIN student_billing_v6 b ON b.student_id=s.id WHERE s.active=1 AND s.deleted_at IS NULL AND lower(trim(s.name))=lower(trim(?1)) ORDER BY s.id LIMIT 1`).bind(name).first();if(s){studentId=Number(s.id);plan=s;}}
 }
 if(plan?.billing_mode!=='package')return request;
 const amended={...body,student_id:studentId,billing_mode:'package',package_size:Number(plan.package_size||8),package_price:Number(plan.package_price_pence||0)/100,price:unitShare(Number(plan.package_price_pence||0),Number(plan.package_size||8),1)/100};
 return jsonRequest(request,amended);
}

async function mutationContext(request,db){
 const url=new URL(request.url),path=url.pathname,method=request.method,ids=new Set();
 if(/^\/api\/v3\/occurrences\/\d+\/(complete-paid|complete-unpaid|cancel|restore|reopen|collect|correct-payment)$/.test(path)&&method==='POST'){
  const id=Number(path.match(/occurrences\/(\d+)/)?.[1]||0),r=id?await db.prepare(`SELECT r.student_id FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE o.id=?1`).bind(id).first():null;if(r?.student_id)ids.add(Number(r.student_id));
 }
 const receipt=path.match(/^\/api\/v4\/receipts(?:\/(\d+))?$/);
 if(receipt&&['POST','PATCH','DELETE'].includes(method)){
  const rid=Number(receipt[1]||0);if(rid){const r=await db.prepare(`SELECT student_id FROM student_receipts_v4 WHERE id=?1`).bind(rid).first();if(r?.student_id)ids.add(Number(r.student_id));}
  if(method!=='DELETE'){const b=await safeJson(request);if(b?.student_id)ids.add(Number(b.student_id));}
 }
 const restore=path.match(/^\/api\/v4\/restore\/receipt\/(\d+)$/);if(restore&&method==='POST'){const r=await db.prepare(`SELECT student_id FROM student_receipts_v4 WHERE id=?1`).bind(Number(restore[1])).first();if(r?.student_id)ids.add(Number(r.student_id));}
 return{studentIds:ids};
}

async function unifiedRebalance(db,studentId){
 if(!studentId)return{allocated_pence:0,credit_pence:0};
 const receipts=await db.prepare(`SELECT id,amount_pence,received_at FROM student_receipts_v4 WHERE student_id=?1 AND deleted_at IS NULL ORDER BY received_at,id`).bind(studentId).all();
 await db.batch([
  db.prepare(`DELETE FROM receipt_allocations_v4 WHERE receipt_id IN (SELECT id FROM student_receipts_v4 WHERE student_id=?1)`).bind(studentId),
  db.prepare(`DELETE FROM package_receipt_allocations_v6 WHERE receipt_id IN (SELECT id FROM student_receipts_v4 WHERE student_id=?1)`).bind(studentId)
 ]);

 const occurrences=await db.prepare(`SELECT o.id,COALESCE(o.rescheduled_to_date,o.session_date) due_date,o.earned_pence,
    COALESCE((SELECT SUM(p.amount_pence) FROM payments_v3 p WHERE p.occurrence_id=o.id AND p.reversed_at IS NULL),0) direct_paid
   FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id
   WHERE r.student_id=?1 AND o.status='completed'
     AND NOT EXISTS(SELECT 1 FROM package_cycle_occurrences_v6 x WHERE x.occurrence_id=o.id)
   ORDER BY due_date,o.id`).bind(studentId).all();
 const cycles=await db.prepare(`SELECT c.id,c.cycle_no,c.package_size,c.package_price_pence,c.started_on,c.completed_on,COUNT(x.id) completed_count
   FROM package_cycles_v6 c LEFT JOIN package_cycle_occurrences_v6 x ON x.cycle_id=c.id
   WHERE c.student_id=?1 GROUP BY c.id ORDER BY c.cycle_no`).bind(studentId).all();

 const obligations=[];
 for(const o of occurrences.results||[]){const need=Math.max(0,Number(o.earned_pence||0)-Number(o.direct_paid||0));if(need>0)obligations.push({kind:'occurrence',id:Number(o.id),date:o.due_date,remaining:need});}
 for(const c of cycles.results||[]){const full=Number(c.completed_count||0)>=Number(c.package_size||0);await db.prepare(`UPDATE package_cycles_v6 SET status=?1,paid_on=NULL,completed_on=CASE WHEN ?1='open' THEN NULL ELSE COALESCE(completed_on,started_on) END,updated_at=CURRENT_TIMESTAMP WHERE id=?2`).bind(full?'due':'open',c.id).run();if(full)obligations.push({kind:'package',id:Number(c.id),date:c.completed_on||c.started_on||'9999-12-31',remaining:Number(c.package_price_pence||0)});}
 obligations.sort((a,b)=>String(a.date).localeCompare(String(b.date))||(a.kind===b.kind?a.id-b.id:(a.kind==='occurrence'?-1:1)));

 let oi=0,totalAllocated=0;
 for(const receipt of receipts.results||[]){let left=Number(receipt.amount_pence||0);while(left>0&&oi<obligations.length){while(oi<obligations.length&&obligations[oi].remaining<=0)oi++;if(oi>=obligations.length)break;const ob=obligations[oi],take=Math.min(left,ob.remaining);if(take<=0)break;if(ob.kind==='occurrence')await db.prepare(`INSERT INTO receipt_allocations_v4(receipt_id,occurrence_id,amount_pence) VALUES(?1,?2,?3)`).bind(receipt.id,ob.id,take).run();else await db.prepare(`INSERT INTO package_receipt_allocations_v6(receipt_id,cycle_id,amount_pence) VALUES(?1,?2,?3)`).bind(receipt.id,ob.id,take).run();left-=take;ob.remaining-=take;totalAllocated+=take;}}

 for(const c of cycles.results||[]){if(Number(c.completed_count||0)<Number(c.package_size||0))continue;const p=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) v FROM package_receipt_allocations_v6 WHERE cycle_id=?1`).bind(c.id).first(),paid=Number(p?.v||0)>=Number(c.package_price_pence||0);await db.prepare(`UPDATE package_cycles_v6 SET status=?1,paid_on=CASE WHEN ?1='paid' THEN COALESCE(paid_on,CURRENT_TIMESTAMP) ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?2`).bind(paid?'paid':'due',c.id).run();}
 const total=(receipts.results||[]).reduce((n,r)=>n+Number(r.amount_pence||0),0);return{allocated_pence:totalAllocated,credit_pence:Math.max(0,total-totalAllocated)};
}

async function summaryRows(db,onlyId=0){
 const filter=onlyId?' AND s.id=?1':'';
 let stmt=db.prepare(`WITH
 occ_due AS (
  SELECT r.student_id,
   COALESCE(SUM(MAX(0,o.earned_pence-COALESCE((SELECT SUM(p.amount_pence) FROM payments_v3 p WHERE p.occurrence_id=o.id AND p.reversed_at IS NULL),0)-COALESCE((SELECT SUM(a.amount_pence) FROM receipt_allocations_v4 a JOIN student_receipts_v4 rr ON rr.id=a.receipt_id WHERE a.occurrence_id=o.id AND rr.deleted_at IS NULL),0))),0) due,
   COALESCE(SUM(CASE WHEN o.earned_pence>COALESCE((SELECT SUM(p.amount_pence) FROM payments_v3 p WHERE p.occurrence_id=o.id AND p.reversed_at IS NULL),0)+COALESCE((SELECT SUM(a.amount_pence) FROM receipt_allocations_v4 a JOIN student_receipts_v4 rr ON rr.id=a.receipt_id WHERE a.occurrence_id=o.id AND rr.deleted_at IS NULL),0) THEN 1 ELSE 0 END),0) cnt
  FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id
  WHERE o.status='completed' AND r.student_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM package_cycle_occurrences_v6 x WHERE x.occurrence_id=o.id)
  GROUP BY r.student_id
 ),
 cycle_stats AS (
  SELECT c.id,c.student_id,c.cycle_no,c.package_size,c.package_price_pence,c.status,c.started_on,c.completed_on,COUNT(x.id) completed_count,COALESCE(SUM(x.earned_pence),0) work_pence,COALESCE((SELECT SUM(a.amount_pence) FROM package_receipt_allocations_v6 a WHERE a.cycle_id=c.id),0) paid_pence
  FROM package_cycles_v6 c LEFT JOIN package_cycle_occurrences_v6 x ON x.cycle_id=c.id GROUP BY c.id
 ),
 pkg AS (
  SELECT student_id,
   COALESCE(SUM(CASE WHEN completed_count>=package_size THEN MAX(0,package_price_pence-paid_pence) ELSE 0 END),0) due,
   COALESCE(SUM(CASE WHEN completed_count>=package_size AND package_price_pence>paid_pence THEN 1 ELSE 0 END),0) cnt,
   COALESCE(SUM(CASE WHEN completed_count<package_size THEN work_pence ELSE 0 END),0) work_not_due
  FROM cycle_stats GROUP BY student_id
 ),
 open_cycle AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY student_id ORDER BY cycle_no DESC) rn FROM cycle_stats WHERE completed_count<package_size),
 latest_cycle AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY student_id ORDER BY cycle_no DESC) rn FROM cycle_stats),
 receipts AS (SELECT student_id,COALESCE(SUM(amount_pence),0) total FROM student_receipts_v4 WHERE deleted_at IS NULL GROUP BY student_id),
 oa AS (SELECT rr.student_id,COALESCE(SUM(a.amount_pence),0) total FROM receipt_allocations_v4 a JOIN student_receipts_v4 rr ON rr.id=a.receipt_id WHERE rr.deleted_at IS NULL GROUP BY rr.student_id),
 pa AS (SELECT rr.student_id,COALESCE(SUM(a.amount_pence),0) total FROM package_receipt_allocations_v6 a JOIN student_receipts_v4 rr ON rr.id=a.receipt_id WHERE rr.deleted_at IS NULL GROUP BY rr.student_id),
 pay_events AS (
  SELECT student_id,amount_pence,received_at paid_at,id sort_id,1 k FROM student_receipts_v4 WHERE deleted_at IS NULL
  UNION ALL
  SELECT r.student_id,p.amount_pence,p.paid_at,p.id sort_id,0 k FROM payments_v3 p JOIN session_occurrences_v3 o ON o.id=p.occurrence_id JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE p.reversed_at IS NULL AND r.student_id IS NOT NULL
 ),
 latest_pay AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY student_id ORDER BY paid_at DESC,k DESC,sort_id DESC) rn FROM pay_events)
 SELECT s.*,COALESCE(b.billing_mode,'per_session') billing_mode,COALESCE(b.package_size,8) package_size,COALESCE(b.package_price_pence,0) package_price_pence,
  COALESCE(occ_due.due,0)+COALESCE(pkg.due,0) outstanding_pence,
  COALESCE(occ_due.due,0)+COALESCE(pkg.due,0) due_now_pence,
  COALESCE(occ_due.cnt,0)+COALESCE(pkg.cnt,0) outstanding_count,
  MAX(0,COALESCE(receipts.total,0)-COALESCE(oa.total,0)-COALESCE(pa.total,0)) credit_pence,
  COALESCE(latest_pay.amount_pence,0) last_payment_pence,latest_pay.paid_at last_payment_date,
  COALESCE(pkg.work_not_due,0) work_not_due_pence,
  COALESCE(open_cycle.completed_count,CASE WHEN COALESCE(pkg.due,0)>0 THEN COALESCE(b.package_size,8) ELSE 0 END,0) progress_completed,
  COALESCE(open_cycle.package_size,b.package_size,8) progress_size,
  CASE WHEN open_cycle.id IS NOT NULL THEN 'open' WHEN COALESCE(pkg.due,0)>0 THEN 'due' ELSE 'open' END progress_status,
  COALESCE(open_cycle.cycle_no,CASE WHEN latest_cycle.id IS NOT NULL THEN latest_cycle.cycle_no+1 ELSE 1 END) progress_cycle_no
 FROM students_v3 s
 LEFT JOIN student_billing_v6 b ON b.student_id=s.id
 LEFT JOIN occ_due ON occ_due.student_id=s.id LEFT JOIN pkg ON pkg.student_id=s.id
 LEFT JOIN open_cycle ON open_cycle.student_id=s.id AND open_cycle.rn=1
 LEFT JOIN latest_cycle ON latest_cycle.student_id=s.id AND latest_cycle.rn=1
 LEFT JOIN receipts ON receipts.student_id=s.id LEFT JOIN oa ON oa.student_id=s.id LEFT JOIN pa ON pa.student_id=s.id
 LEFT JOIN latest_pay ON latest_pay.student_id=s.id AND latest_pay.rn=1
 WHERE s.active=1 AND s.deleted_at IS NULL${filter}
 ORDER BY outstanding_pence DESC,s.name COLLATE NOCASE`);
 if(onlyId)stmt=stmt.bind(onlyId);const rows=await stmt.all();return(rows.results||[]).map(s=>({...s,package_progress:s.billing_mode==='package'?{cycle_no:Number(s.progress_cycle_no||1),completed:Number(s.progress_completed||0),size:Number(s.progress_size||s.package_size||8),status:s.progress_status,package_price_pence:Number(s.package_price_pence||0)}:null}));
}

async function canonicalAccount(db,studentId){
 const rows=await summaryRows(db,studentId),s=rows[0];if(!s)return json({error:'الطالب غير موجود'},404);
 const schedules=await db.prepare(`SELECT id,weekday,start_time,session_type,title,duration_minutes,travel_minutes,location FROM recurring_sessions_v3 WHERE active=1 AND student_id=?1 ORDER BY weekday,start_time,id`).bind(studentId).all();s.schedules=schedules.results||[];
 const cycles=await db.prepare(`SELECT c.*,COUNT(x.id) completed_count,COALESCE(SUM(x.earned_pence),0) work_pence,COALESCE((SELECT SUM(a.amount_pence) FROM package_receipt_allocations_v6 a WHERE a.cycle_id=c.id),0) paid_pence FROM package_cycles_v6 c LEFT JOIN package_cycle_occurrences_v6 x ON x.cycle_id=c.id WHERE c.student_id=?1 GROUP BY c.id ORDER BY c.cycle_no DESC LIMIT 20`).bind(studentId).all();
 const timeline=await db.prepare(`SELECT 'session' kind,COALESCE(o.rescheduled_to_date,o.session_date) date,o.id,o.status,o.earned_pence,r.title,CASE WHEN EXISTS(SELECT 1 FROM package_cycle_occurrences_v6 x WHERE x.occurrence_id=o.id) THEN 'package' ELSE 'per_session' END billing_mode FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE r.student_id=?1 UNION ALL SELECT 'receipt' kind,received_at date,id,CASE WHEN deleted_at IS NULL THEN 'active' ELSE 'deleted' END status,amount_pence earned_pence,'استلام' title,'receipt' billing_mode FROM student_receipts_v4 WHERE student_id=?1 ORDER BY date DESC LIMIT 50`).bind(studentId).all();
 return json({student:s,package_cycles:cycles.results||[],timeline:timeline.results||[]});
}

async function canonicalReport(url,db){
 const month=validMonth(url.searchParams.get('month'))||todayLondon().slice(0,7);
 const earned=await db.prepare(`SELECT COALESCE(SUM(earned_pence),0) total,COUNT(*) sessions FROM session_occurrences_v3 WHERE status='completed' AND substr(COALESCE(rescheduled_to_date,session_date),1,7)=?1`).bind(month).first();
 const receipts=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) v FROM student_receipts_v4 WHERE deleted_at IS NULL AND substr(received_at,1,7)=?1`).bind(month).first(),direct=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) v FROM payments_v3 WHERE reversed_at IS NULL AND substr(paid_at,1,7)=?1`).bind(month).first(),other=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) v FROM other_income_v3 WHERE deleted_at IS NULL AND substr(income_date,1,7)=?1`).bind(month).first(),exp=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) total,COALESCE(SUM(CASE WHEN scope='business' THEN amount_pence ELSE 0 END),0) business,COALESCE(SUM(CASE WHEN scope='personal' THEN amount_pence ELSE 0 END),0) personal FROM expenses_v3 WHERE deleted_at IS NULL AND substr(expense_date,1,7)=?1`).bind(month).first();
 const byType=await db.prepare(`SELECT r.session_type key,SUM(o.earned_pence) amount_pence,COUNT(*) count FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE o.status='completed' AND substr(COALESCE(o.rescheduled_to_date,o.session_date),1,7)=?1 GROUP BY r.session_type ORDER BY amount_pence DESC`).bind(month).all();
 const byBilling=await db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM package_cycle_occurrences_v6 x WHERE x.occurrence_id=o.id) THEN 'package' ELSE 'per_session' END key,SUM(o.earned_pence) amount_pence,COUNT(*) count FROM session_occurrences_v3 o WHERE o.status='completed' AND substr(COALESCE(o.rescheduled_to_date,o.session_date),1,7)=?1 GROUP BY key`).bind(month).all();
 const cats=await db.prepare(`SELECT category,SUM(amount_pence) amount_pence,COUNT(*) count FROM expenses_v3 WHERE deleted_at IS NULL AND substr(expense_date,1,7)=?1 GROUP BY category ORDER BY amount_pence DESC`).bind(month).all();
 const studentCash=Number(receipts?.v||0)+Number(direct?.v||0),otherCash=Number(other?.v||0),expenses=Number(exp?.total||0);
 return json({month,summary:{worked_pence:Number(earned?.total||0),completed_sessions:Number(earned?.sessions||0),student_cash_pence:studentCash,other_income_pence:otherCash,expenses_pence:expenses,business_expenses_pence:Number(exp?.business||0),personal_expenses_pence:Number(exp?.personal||0),cash_net_pence:studentCash+otherCash-expenses,due_now_pence:await canonicalTotalDue(db),work_not_due_pence:await totalOpenPackageWork(db)},by_type:byType.results||[],by_billing:byBilling.results||[],expenses_by_category:(cats.results||[]).map(x=>({...x,key:expenseLabel(x.category)}))});
}

async function canonicalReview(db){
 const items=[];
 const dup=await db.prepare(`SELECT expense_date,scope,category,amount_pence,COUNT(*) count,GROUP_CONCAT(id) ids FROM expenses_v3 WHERE deleted_at IS NULL GROUP BY expense_date,scope,category,amount_pence HAVING COUNT(*)>1 ORDER BY expense_date DESC LIMIT 8`).all();
 for(const x of dup.results||[])items.push({tone:'attention',title:'مصروف متكرر محتاج مراجعة',text:`${expenseLabel(x.category)} · ${moneyText(x.amount_pence)} اتسجل ${x.count} مرات في ${x.expense_date}.`,entity_type:'expense',entity_ids:String(x.ids).split(',').map(Number)});
 const pkg=await db.prepare(`SELECT * FROM (SELECT s.id student_id,s.name,c.package_price_pence,c.completed_on,MAX(0,c.package_price_pence-COALESCE((SELECT SUM(a.amount_pence) FROM package_receipt_allocations_v6 a WHERE a.cycle_id=c.id),0)) due FROM package_cycles_v6 c JOIN students_v3 s ON s.id=c.student_id WHERE (SELECT COUNT(*) FROM package_cycle_occurrences_v6 x WHERE x.cycle_id=c.id)>=c.package_size) WHERE due>0 ORDER BY completed_on LIMIT 8`).all();
 for(const x of pkg.results||[])items.push({tone:'attention',title:`${x.name}: الباقة اكتملت`,text:`جاهز للتحصيل ${moneyText(x.due)}`,student_id:x.student_id});
 const overdue=await db.prepare(`SELECT * FROM (SELECT r.student_id,s.name,COALESCE(o.rescheduled_to_date,o.session_date) d,MAX(0,o.earned_pence-COALESCE((SELECT SUM(p.amount_pence) FROM payments_v3 p WHERE p.occurrence_id=o.id AND p.reversed_at IS NULL),0)-COALESCE((SELECT SUM(a.amount_pence) FROM receipt_allocations_v4 a JOIN student_receipts_v4 rr ON rr.id=a.receipt_id WHERE a.occurrence_id=o.id AND rr.deleted_at IS NULL),0)) due FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id LEFT JOIN students_v3 s ON s.id=r.student_id WHERE o.status='completed' AND NOT EXISTS(SELECT 1 FROM package_cycle_occurrences_v6 x WHERE x.occurrence_id=o.id) AND date(COALESCE(o.rescheduled_to_date,o.session_date))<=date('now','-14 day')) WHERE due>0 ORDER BY d LIMIT 8`).all();
 for(const x of overdue.results||[])items.push({tone:'attention',title:`مستحق قديم على ${x.name||'طالب'}`,text:`${moneyText(x.due)} من ${x.d}.`,student_id:x.student_id});
 return json({items,all_good:items.length===0});
}

async function canonicalTotalDue(db){const rows=await summaryRows(db);return rows.reduce((n,x)=>n+Number(x.due_now_pence||0),0)}
async function totalOpenPackageWork(db){const r=await db.prepare(`SELECT COALESCE(SUM(x.earned_pence),0) v FROM package_cycle_occurrences_v6 x JOIN package_cycles_v6 c ON c.id=x.cycle_id WHERE (SELECT COUNT(*) FROM package_cycle_occurrences_v6 z WHERE z.cycle_id=c.id)<c.package_size`).first();return Number(r?.v||0)}
async function nextPackageState(db,studentId){if(!studentId)return null;const open=await db.prepare(`SELECT c.id cycle_id,c.cycle_no,c.package_size,c.package_price_pence,'open' status,COUNT(x.id) completed FROM package_cycles_v6 c LEFT JOIN package_cycle_occurrences_v6 x ON x.cycle_id=c.id WHERE c.student_id=?1 GROUP BY c.id HAVING COUNT(x.id)<c.package_size ORDER BY c.cycle_no DESC LIMIT 1`).bind(studentId).first();if(open)return open;const p=await db.prepare(`SELECT b.*,COALESCE((SELECT MAX(cycle_no) FROM package_cycles_v6 c WHERE c.student_id=b.student_id),0)+1 next_no FROM student_billing_v6 b WHERE b.student_id=?1`).bind(studentId).first();return p?{cycle_id:null,cycle_no:Number(p.next_no||1),package_size:Number(p.package_size||8),package_price_pence:Number(p.package_price_pence||0),status:'open',completed:0}:null}

async function rewriteReceiptResult(db,data,status,id){if(!id)return json(data,status);const r=await db.prepare(`SELECT amount_pence FROM student_receipts_v4 WHERE id=?1 AND deleted_at IS NULL`).bind(id).first();if(!r)return json(data,status);const o=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) v FROM receipt_allocations_v4 WHERE receipt_id=?1`).bind(id).first(),p=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) v FROM package_receipt_allocations_v6 WHERE receipt_id=?1`).bind(id).first(),allocated=Number(o?.v||0)+Number(p?.v||0);return json({...data,allocated_pence:allocated,credit_pence:Math.max(0,Number(r.amount_pence||0)-allocated)},status)}

function unitShare(total,size,position){total=Math.max(0,Number(total||0));size=Math.max(1,Number(size||1));const base=Math.floor(total/size),extra=total%size;return base+(position<=extra?1:0)}
function jsonRequest(request,body){const h=new Headers(request.headers);h.set('content-type','application/json');return new Request(request.url,{method:request.method,headers:h,body:JSON.stringify(body)})}
async function safeJson(request){try{return await request.clone().json()}catch{return null}}
function positiveInt(v){const n=Number(v);return Number.isFinite(n)&&n>0?Math.round(n):0}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v||''))?String(v):null}
function validMonth(v){return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v||''))?String(v):null}
function todayLondon(){const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),g=t=>p.find(x=>x.type===t)?.value;return`${g('year')}-${g('month')}-${g('day')}`}
function moneyText(p){return`${(Number(p||0)/100).toLocaleString('ar-EG',{maximumFractionDigits:2})} ج`}
function expenseLabel(c){return({work_transport:'مواصلات الشغل',books_printing:'كتب وطباعة',teaching_supplies:'أدوات تعليم',work_internet:'إنترنت الشغل',center_fees:'مصاريف السنتر',study_materials:'مواد دراسية',other_business:'مصروف شغل آخر',home:'البيت',food:'الأكل',personal_transport:'مواصلات شخصية',bills:'فواتير',children:'الأطفال',commitments:'التزامات',personal_shopping:'شراء شخصي',health:'الصحة',other_personal:'مصروف شخصي آخر'})[c]||'أخرى'}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:JSON_HEADERS})}
