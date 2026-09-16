import app from './final.js';

const PRE='<script src="/runtime-pre.js"></script>';
const POST='<script type="module" src="/v6-extra.js"></script><script src="/availability-v2.js"></script><script src="/runtime-post.js"></script>';
const JSON_HEADERS={'content-type':'application/json; charset=utf-8'};
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

    const normalEdit=path.match(/^\/api\/v3\/sessions\/(\d+)$/),body=normalEdit&&method==='PATCH'?await safeJson(request.clone()):null;
    const response=await app.fetch(request,runEnv,ctx);
    if(response.ok&&normalEdit&&method==='PATCH'&&(body?.weekday!==undefined||body?.start_time!==undefined)){
      await runEnv.DB.prepare(`UPDATE recurring_sessions_v3 SET schedule_status='confirmed' WHERE id=?1`).bind(Number(normalEdit[1])).run();
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
  data.items=(data.items||[]).map(x=>({...x,schedule_status:state.get(Number(x.recurring_session_id))==='pending'&&!x.occurrence_id?'pending':'confirmed'}));
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

async function scheduleLog(db,id,title,detail){
  await db.prepare(`INSERT INTO activity_events_v4(entity_type,entity_id,action,title,detail,undoable) VALUES('session',?1,'updated',?2,?3,0)`).bind(id,title,detail).run();
}

async function canUseFastPath(db){
  if(fastCompatibilityCheck)return fastCompatibilityCheck;
  fastCompatibilityCheck=(async()=>{
    try{
      const legacy=await db.prepare(`SELECT 1 found FROM recurring_sessions_v3 WHERE price_type='monthly' LIMIT 1`).first();
      return !legacy;
    }catch(e){
      console.warn('Sozan fast path disabled; using compatibility mode.',e);
      return false;
    }
  })();
  return fastCompatibilityCheck;
}

function fastDb(db){
  if(dbProxyCache.has(db))return dbProxyCache.get(db);
  const proxy=new Proxy(db,{
    get(target,prop){
      if(prop==='prepare')return sql=>skipCompatibilitySql(sql)?new NoopStatement():target.prepare(sql);
      if(prop==='batch')return statements=>{
        if(Array.isArray(statements)&&statements.length&&statements.every(s=>s?.__sozanNoop))return Promise.resolve(statements.map(()=>noopResult()));
        return target.batch(statements);
      };
      const value=target[prop];return typeof value==='function'?value.bind(target):value;
    }
  });
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

class NoopStatement{
  constructor(){this.__sozanNoop=true}
  bind(){return this}
  run(){return Promise.resolve(noopResult())}
  all(){return Promise.resolve({...noopResult(),results:[]})}
  first(){return Promise.resolve(null)}
  raw(){return Promise.resolve([])}
}
function noopResult(){return{success:true,meta:{duration:0,changes:0,last_row_id:0,rows_read:0,rows_written:0}}}
function validTime(v){return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v||''))?String(v):null}
function weekdayLabel(n){return['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'][Number(n)]||''}
function todayLondon(){const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),g=t=>p.find(x=>x.type===t)?.value;return`${g('year')}-${g('month')}-${g('day')}`}
async function safeJson(r){try{return await r.json()}catch{return null}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:JSON_HEADERS})}
