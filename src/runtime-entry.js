import app from './final.js';

const PRE='<script src="/runtime-pre.js"></script>';
const POST='<script type="module" src="/v6-extra.js"></script><script src="/availability-v2.js"></script><script src="/package-progress-v7.js"></script><script src="/runtime-post.js"></script>';
const JSON_HEADERS={'content-type':'application/json; charset=utf-8'};
const OPENING_MARK='__opening_progress_v7__';
let fastCompatibilityCheck=null;
const dbProxyCache=new WeakMap();

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url),path=url.pathname,method=request.method;
    if(method==='GET'&&(path==='/'||path==='/index.html')){
      const response=await env.ASSETS.fetch(request);if(!response.ok)return response;
      let html=await response.text();
      const appMarker='<script type="module" src="/app.js"></script>';
      if(!html.includes('/runtime-pre.js'))html=html.includes(appMarker)?html.replace(appMarker,`${PRE}\n  ${appMarker}`):html.replace('</head>',`  ${PRE}\n</head>`);
      if(!html.includes('/v6-extra.js'))html=html.replace('</body>',`  ${POST}\n</body>`);
      else{
        if(!html.includes('/availability-v2.js'))html=html.replace('</body>',`  <script src="/availability-v2.js"></script>\n</body>`);
        if(!html.includes('/package-progress-v7.js'))html=html.replace('</body>',`  <script src="/package-progress-v7.js"></script>\n</body>`);
        if(!html.includes('/runtime-post.js'))html=html.replace('</body>',`  <script src="/runtime-post.js"></script>\n</body>`);
      }
      const headers=new Headers(response.headers);headers.set('content-type','text/html; charset=utf-8');headers.set('cache-control','no-cache');
      return new Response(html,{status:response.status,headers});
    }
    if(!path.startsWith('/api/')||path==='/api/health'||path==='/api/login'||path==='/api/logout')return app.fetch(request,env,ctx);

    const optimized=await canUseFastPath(env.DB),runEnv=optimized?{...env,DB:fastDb(env.DB)}:env;
    const quick=path.match(/^\/api\/v6\/sessions\/(\d+)\/quick-schedule$/);
    if(quick&&method==='POST'){
      const auth=await authProbe(request,runEnv,ctx);if(auth)return auth;
      return quickSchedule(request,runEnv.DB,Number(quick[1]));
    }
    if((path==='/api/v7/planner-week'||path==='/api/v6/schedule-range')&&method==='GET')return plannerWeek(request,runEnv,ctx);

    const studentState=path.match(/^\/api\/v7\/students\/(\d+)\/package-state$/);
    if(studentState&&method==='GET'){
      const auth=await authProbe(request,runEnv,ctx);if(auth)return auth;
      return json(await packageState(runEnv.DB,Number(studentState[1])));
    }
    const sessionState=path.match(/^\/api\/v7\/sessions\/(\d+)\/package-state$/);
    if(sessionState&&method==='GET'){
      const auth=await authProbe(request,runEnv,ctx);if(auth)return auth;
      const s=await runEnv.DB.prepare(`SELECT student_id FROM recurring_sessions_v3 WHERE id=?1 AND active=1`).bind(Number(sessionState[1])).first();
      if(!s?.student_id)return json({billing_mode:'per_session'});
      return json(await packageState(runEnv.DB,Number(s.student_id)));
    }

    const sessionCreate=path==='/api/v3/sessions'&&method==='POST';
    const normalEdit=path.match(/^\/api\/v3\/sessions\/(\d+)$/);
    const body=(sessionCreate||(normalEdit&&method==='PATCH'))?await safeJson(request.clone()):null;
    const account=path.match(/^\/api\/v4\/students\/(\d+)\/account$/);
    let response=await app.fetch(request,runEnv,ctx);

    if(response.ok&&sessionCreate&&body){
      const data=await response.json();
      if(data.student_id&&body.billing_mode==='package'){
        const applied=await applyOpeningProgress(runEnv.DB,Number(data.student_id),body.package_cycle_start,body.package_completed_before);
        if(applied.error)return json({error:applied.error},409);
      }
      return json(data,response.status);
    }
    if(response.ok&&normalEdit&&method==='PATCH'){
      if(body?.weekday!==undefined||body?.start_time!==undefined)await runEnv.DB.prepare(`UPDATE recurring_sessions_v3 SET schedule_status='confirmed' WHERE id=?1`).bind(Number(normalEdit[1])).run();
      if(body?.billing_mode==='package'&&body?.package_completed_before!==undefined){
        const s=await runEnv.DB.prepare(`SELECT student_id FROM recurring_sessions_v3 WHERE id=?1`).bind(Number(normalEdit[1])).first();
        if(s?.student_id){const applied=await applyOpeningProgress(runEnv.DB,Number(s.student_id),body.package_cycle_start,body.package_completed_before);if(applied.error)return json({error:applied.error},409)}
      }
    }
    if(response.ok&&account&&method==='GET'){
      const data=await response.json();
      data.timeline=(data.timeline||[]).filter(x=>x.title!==OPENING_MARK);
      data.student={...(data.student||{}),package_setup:await packageState(runEnv.DB,Number(account[1]))};
      return json(data,response.status);
    }
    return response;
  }
};

async function authProbe(request,env,ctx){
  const probe=new Request(new URL('/api/v3/settings',request.url),{method:'GET',headers:request.headers});
  const r=await app.fetch(probe,env,ctx);return r.ok?null:r;
}

async function plannerWeek(request,env,ctx){
  const url=new URL(request.url),target=new URL('/api/v6/schedule-range',request.url);target.search=url.search;
  const probe=new Request(target,{method:'GET',headers:request.headers});
  const response=await app.fetch(probe,env,ctx);if(!response.ok)return response;
  const data=await response.json(),rows=await env.DB.prepare(`SELECT id,schedule_status FROM recurring_sessions_v3 WHERE active=1`).all(),state=new Map((rows.results||[]).map(x=>[Number(x.id),x.schedule_status||'confirmed']));
  data.items=(data.items||[]).filter(x=>x.title!==OPENING_MARK).map(x=>({...x,schedule_status:state.get(Number(x.recurring_session_id))==='pending'&&!x.occurrence_id?'pending':'confirmed'}));
  return json(data);
}

async function quickSchedule(request,db,id){
  const row=await db.prepare(`SELECT id,title,weekday,start_time,schedule_status FROM recurring_sessions_v3 WHERE id=?1 AND active=1`).bind(id).first();
  if(!row)return json({error:'الحصة غير موجودة'},404);
  const body=await safeJson(request)||{},today=todayLondon();
  if(body.status==='pending'){
    if(row.schedule_status==='pending')return json({ok:true,unchanged:true,status:'pending'});
    await db.batch([
      db.prepare(`UPDATE recurring_sessions_v3 SET schedule_status='pending',updated_at=CURRENT_TIMESTAMP WHERE id=?1`).bind(id),
      db.prepare(`DELETE FROM session_occurrences_v3 WHERE recurring_session_id=?1 AND session_date>=?2 AND status='scheduled' AND rescheduled_to_date IS NULL`).bind(id,today)
    ]);
    await scheduleLog(db,id,`ميعاد ${row.title} محتاج ترتيب`,'اتحفظ مؤقتًا لحد ما يتحدد اليوم والوقت');
    return json({ok:true,status:'pending'});
  }
  const weekday=Number(body.weekday),start=validTime(body.start_time);
  if(!Number.isInteger(weekday)||weekday<0||weekday>6||!start)return json({error:'اختاري اليوم والوقت الجديد'},400);
  if(row.schedule_status!=='pending'&&Number(row.weekday)===weekday&&row.start_time===start)return json({ok:true,unchanged:true,status:'confirmed'});
  await db.batch([
    db.prepare(`UPDATE recurring_sessions_v3 SET weekday=?1,start_time=?2,schedule_status='confirmed',updated_at=CURRENT_TIMESTAMP WHERE id=?3`).bind(weekday,start,id),
    db.prepare(`DELETE FROM session_occurrences_v3 WHERE recurring_session_id=?1 AND session_date>=?2 AND status='scheduled' AND rescheduled_to_date IS NULL`).bind(id,today)
  ]);
  await scheduleLog(db,id,`اتظبط ميعاد ${row.title}`,`${weekdayLabel(weekday)} · ${start}`);
  return json({ok:true,status:'confirmed',weekday,start_time:start});
}

async function packageState(db,studentId){
  const plan=await db.prepare(`SELECT * FROM student_billing_v6 WHERE student_id=?1`).bind(studentId).first();
  if(!plan||plan.billing_mode!=='package')return{billing_mode:'per_session'};
  const cycle=await db.prepare(`SELECT c.*,COUNT(x.id) completed FROM package_cycles_v6 c LEFT JOIN package_cycle_occurrences_v6 x ON x.cycle_id=c.id WHERE c.student_id=?1 AND c.status IN ('open','due') GROUP BY c.id ORDER BY CASE c.status WHEN 'open' THEN 0 ELSE 1 END,c.cycle_no DESC LIMIT 1`).bind(studentId).first();
  const opening=await db.prepare(`SELECT * FROM package_opening_progress_v7 WHERE student_id=?1`).bind(studentId).first();
  let completed=0,start=plan.cycle_anchor_date||todayLondon(),cycleNo=1,status='open',openingCompleted=0;
  if(cycle){completed=Number(cycle.completed||0);start=cycle.started_on||start;cycleNo=Number(cycle.cycle_no||1);status=cycle.status||'open';if(opening&&Number(opening.cycle_id)===Number(cycle.id)){start=opening.cycle_start_date||start;openingCompleted=Number(opening.opening_completed||0)}}
  else{const n=await db.prepare(`SELECT COALESCE(MAX(cycle_no),0)+1 n FROM package_cycles_v6 WHERE student_id=?1`).bind(studentId).first();cycleNo=Number(n?.n||1);start=todayLondon()}
  const size=Number(plan.package_size||8),remaining=Math.max(0,size-completed);
  return{billing_mode:'package',package_size:size,package_price_pence:Number(plan.package_price_pence||0),cycle_no:cycleNo,cycle_start_date:start,opening_completed:openingCompleted,completed,remaining,next_position:remaining?Math.min(size,completed+1):size,status};
}

async function applyOpeningProgress(db,studentId,startValue,doneValue){
  const plan=await db.prepare(`SELECT * FROM student_billing_v6 WHERE student_id=?1`).bind(studentId).first();
  if(!plan||plan.billing_mode!=='package')return{ok:true,ignored:true};
  const size=Math.max(1,Number(plan.package_size||8)),done=Math.max(0,Math.min(size,Math.round(Number(doneValue)||0))),start=validDate(startValue)||todayLondon();
  let cycle=await db.prepare(`SELECT * FROM package_cycles_v6 WHERE student_id=?1 AND status IN ('open','due') ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END,cycle_no DESC LIMIT 1`).bind(studentId).first();
  let opening=await db.prepare(`SELECT * FROM package_opening_progress_v7 WHERE student_id=?1`).bind(studentId).first();
  if(!cycle){
    const last=await db.prepare(`SELECT COALESCE(MAX(cycle_no),0)+1 n FROM package_cycles_v6 WHERE student_id=?1`).bind(studentId).first();
    const r=await db.prepare(`INSERT INTO package_cycles_v6(student_id,cycle_no,package_size,package_price_pence,status,started_on) VALUES(?1,?2,?3,?4,'open',?5)`).bind(studentId,Number(last?.n||1),size,Number(plan.package_price_pence||0),start).run();
    cycle=await db.prepare(`SELECT * FROM package_cycles_v6 WHERE id=?1`).bind(Number(r.meta?.last_row_id||0)).first();
    opening=null;
  }
  const sameOpening=opening&&Number(opening.cycle_id)===Number(cycle.id)?opening:null;
  const shadowId=sameOpening?Number(sameOpening.shadow_session_id):0;
  const real=await db.prepare(`SELECT COUNT(*) c FROM package_cycle_occurrences_v6 x JOIN session_occurrences_v3 o ON o.id=x.occurrence_id JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE x.cycle_id=?1 AND r.title<>?2`).bind(cycle.id,OPENING_MARK).first(),realCount=Number(real?.c||0);
  if(realCount>0&&sameOpening&&done!==Number(sameOpening.opening_completed||0))return{error:'بعد ما بدأ تسجيل حصص جديدة في الدورة، رقم البداية يفضل ثابت. الحصص المسجلة داخل البرنامج محفوظة بالفعل.'};
  if(realCount>0&&!sameOpening&&done>0)return{error:'الدورة دي بدأ تسجيلها داخل البرنامج بالفعل؛ رقم البداية الإضافي غير مطلوب.'};

  if(done===0&&!sameOpening){
    const total=realCount,due=total>=size||cycle.status==='due';
    await db.batch([
      db.prepare(`UPDATE student_billing_v6 SET cycle_anchor_date=?1,updated_at=CURRENT_TIMESTAMP WHERE student_id=?2`).bind(start,studentId),
      db.prepare(`UPDATE package_cycles_v6 SET started_on=?1,status=?2,completed_on=CASE WHEN ?2='due' THEN COALESCE(completed_on,?1) ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?3`).bind(start,due?'due':'open',cycle.id)
    ]);
    return{ok:true,completed:total,size};
  }

  let hidden=shadowId;
  if(!hidden){
    const r=await db.prepare(`INSERT INTO recurring_sessions_v3(student_id,title,session_type,weekday,start_time,duration_minutes,price_type,price_basis,price_pence,student_count,center_cut_percent,travel_minutes,location,active) VALUES(?1,?2,'online',0,'00:00',15,'per_session','total_session',0,1,0,0,?2,0)`).bind(studentId,OPENING_MARK).run();
    hidden=Number(r.meta?.last_row_id||0);
  }
  if(realCount===0){
    await db.prepare(`DELETE FROM package_cycle_occurrences_v6 WHERE cycle_id=?1 AND occurrence_id IN (SELECT id FROM session_occurrences_v3 WHERE recurring_session_id=?2)`).bind(cycle.id,hidden).run();
    await db.prepare(`DELETE FROM session_occurrences_v3 WHERE recurring_session_id=?1`).bind(hidden).run();
    for(let i=1;i<=done;i++){
      const d=openingSyntheticDate(i),o=await db.prepare(`INSERT INTO session_occurrences_v3(recurring_session_id,session_date,scheduled_start,status,gross_pence,center_cut_pence,earned_pence,note) VALUES(?1,?2,'00:00','cancelled',0,0,0,?3)`).bind(hidden,d,OPENING_MARK).run();
      await db.prepare(`INSERT INTO package_cycle_occurrences_v6(cycle_id,occurrence_id,position,earned_pence) VALUES(?1,?2,?3,0)`).bind(cycle.id,Number(o.meta?.last_row_id||0),i).run();
    }
  }
  const totalCompleted=Math.min(size,done+realCount),due=totalCompleted>=size||cycle.status==='due';
  await db.batch([
    db.prepare(`UPDATE student_billing_v6 SET cycle_anchor_date=?1,updated_at=CURRENT_TIMESTAMP WHERE student_id=?2`).bind(start,studentId),
    db.prepare(`UPDATE package_cycles_v6 SET started_on=?1,status=?2,completed_on=CASE WHEN ?2='due' THEN COALESCE(completed_on,?1) ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?3`).bind(start,due?'due':'open',cycle.id),
    db.prepare(`INSERT INTO package_opening_progress_v7(student_id,cycle_id,shadow_session_id,cycle_start_date,opening_completed) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(student_id) DO UPDATE SET cycle_id=excluded.cycle_id,shadow_session_id=excluded.shadow_session_id,cycle_start_date=excluded.cycle_start_date,opening_completed=excluded.opening_completed,updated_at=CURRENT_TIMESTAMP`).bind(studentId,cycle.id,hidden,start,done)
  ]);
  if(due)await allocateExistingCredit(db,studentId,cycle.id,Number(cycle.package_price_pence||plan.package_price_pence||0));
  await packageLog(db,studentId,`بداية الباقة ${done}/${size}`,`تاريخ بداية الدورة ${start}`);
  return{ok:true,completed:totalCompleted,size};
}

async function allocateExistingCredit(db,studentId,cycleId,price){
  let paid=await db.prepare(`SELECT COALESCE(SUM(amount_pence),0) v FROM package_receipt_allocations_v6 WHERE cycle_id=?1`).bind(cycleId).first(),need=Math.max(0,price-Number(paid?.v||0));
  if(!need){await db.prepare(`UPDATE package_cycles_v6 SET status='paid',paid_on=COALESCE(paid_on,CURRENT_TIMESTAMP) WHERE id=?1`).bind(cycleId).run();return}
  const receipts=await db.prepare(`SELECT id,amount_pence FROM student_receipts_v4 WHERE student_id=?1 AND deleted_at IS NULL ORDER BY received_at,id`).bind(studentId).all();
  for(const r of receipts.results||[]){if(need<=0)break;const used=await db.prepare(`SELECT COALESCE((SELECT SUM(amount_pence) FROM receipt_allocations_v4 WHERE receipt_id=?1),0)+COALESCE((SELECT SUM(amount_pence) FROM package_receipt_allocations_v6 WHERE receipt_id=?1),0) v`).bind(r.id).first(),free=Math.max(0,Number(r.amount_pence||0)-Number(used?.v||0)),take=Math.min(free,need);if(take>0){await db.prepare(`INSERT INTO package_receipt_allocations_v6(receipt_id,cycle_id,amount_pence) VALUES(?1,?2,?3)`).bind(r.id,cycleId,take).run();need-=take}}
  if(need<=0)await db.prepare(`UPDATE package_cycles_v6 SET status='paid',paid_on=COALESCE(paid_on,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=?1`).bind(cycleId).run();
}

async function scheduleLog(db,id,title,detail){await db.prepare(`INSERT INTO activity_events_v4(entity_type,entity_id,action,title,detail,undoable) VALUES('session',?1,'updated',?2,?3,0)`).bind(id,title,detail).run()}
async function packageLog(db,studentId,title,detail){await db.prepare(`INSERT INTO activity_events_v4(entity_type,entity_id,action,title,detail,undoable) VALUES('student',?1,'updated',?2,?3,0)`).bind(studentId,title,detail).run()}

async function canUseFastPath(db){
  if(fastCompatibilityCheck)return fastCompatibilityCheck;
  fastCompatibilityCheck=(async()=>{try{const legacy=await db.prepare(`SELECT 1 found FROM recurring_sessions_v3 WHERE price_type='monthly' LIMIT 1`).first();return !legacy}catch(e){console.warn('Sozan fast path disabled; using compatibility mode.',e);return false}})();
  return fastCompatibilityCheck;
}

function fastDb(db){
  if(dbProxyCache.has(db))return dbProxyCache.get(db);
  const proxy=new Proxy(db,{get(target,prop){if(prop==='prepare')return sql=>skipCompatibilitySql(sql)?new NoopStatement():target.prepare(sql);if(prop==='batch')return statements=>{if(Array.isArray(statements)&&statements.length&&statements.every(s=>s?.__sozanNoop))return Promise.resolve(statements.map(()=>noopResult()));return target.batch(statements)};const value=target[prop];return typeof value==='function'?value.bind(target):value}});
  dbProxyCache.set(db,proxy);return proxy;
}

function skipCompatibilitySql(sql){
  const s=String(sql||'').replace(/\s+/g,' ').trim().toLowerCase();
  if(/^create table if not exists (student_billing_v6|package_cycles_v6|package_cycle_occurrences_v6|package_receipt_allocations_v6|mutation_dedupe_v1)\b/.test(s))return true;
  if(/^create index if not exists idx_package_/.test(s))return true;
  if(s.startsWith('insert into student_billing_v6')&&(s.includes("select r.student_id,'package'")||s.includes("select s.id,'per_session'")))return true;
  if(s.startsWith('select r.id,r.student_id,b.package_size')&&s.includes('from recurring_sessions_v3 r join student_billing_v6 b')&&s.includes("r.price_type='monthly'"))return true;
  if(s.startsWith('select b.student_id,b.package_size')&&s.includes('from student_billing_v6 b')&&s.includes("price_type='monthly'"))return true;
  return false;
}

class NoopStatement{constructor(){this.__sozanNoop=true}bind(){return this}run(){return Promise.resolve(noopResult())}all(){return Promise.resolve({...noopResult(),results:[]})}first(){return Promise.resolve(null)}raw(){return Promise.resolve([])}}
function noopResult(){return{success:true,meta:{duration:0,changes:0,last_row_id:0,rows_read:0,rows_written:0}}}
function validTime(v){return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v||''))?String(v):null}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v||''))?String(v):null}
function weekdayLabel(n){return['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'][Number(n)]||''}
function openingSyntheticDate(i){const d=new Date(Date.UTC(1900,0,1));d.setUTCDate(d.getUTCDate()+Math.max(0,Number(i||1)-1));return d.toISOString().slice(0,10)}
function todayLondon(){const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),g=t=>p.find(x=>x.type===t)?.value;return`${g('year')}-${g('month')}-${g('day')}`}
async function safeJson(r){try{return await r.json()}catch{return null}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:JSON_HEADERS})}
