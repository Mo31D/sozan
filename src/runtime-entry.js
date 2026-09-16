import app from './final.js';

const PRE='<script src="/runtime-pre.js"></script>';
const POST='<script type="module" src="/v6-extra.js"></script><script src="/runtime-post.js"></script>';
let fastCompatibilityCheck=null;
const dbProxyCache=new WeakMap();

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url),path=url.pathname;
    if(request.method==='GET'&&(path==='/'||path==='/index.html')){
      const response=await env.ASSETS.fetch(request);if(!response.ok)return response;
      let html=await response.text();
      const appMarker='<script type="module" src="/app.js"></script>';
      if(!html.includes('/runtime-pre.js'))html=html.includes(appMarker)?html.replace(appMarker,`${PRE}\n  ${appMarker}`):html.replace('</head>',`  ${PRE}\n</head>`);
      if(!html.includes('/v6-extra.js'))html=html.replace('</body>',`  ${POST}\n</body>`);
      else if(!html.includes('/runtime-post.js'))html=html.replace('</body>',`  <script src="/runtime-post.js"></script>\n</body>`);
      const headers=new Headers(response.headers);headers.set('content-type','text/html; charset=utf-8');headers.set('cache-control','no-cache');
      return new Response(html,{status:response.status,headers});
    }
    if(!path.startsWith('/api/')||path==='/api/health'||path==='/api/login'||path==='/api/logout')return app.fetch(request,env,ctx);
    const optimized=await canUseFastPath(env.DB);
    return app.fetch(request,optimized?{...env,DB:fastDb(env.DB)}:env,ctx);
  }
};

async function canUseFastPath(db){
  if(fastCompatibilityCheck)return fastCompatibilityCheck;
  fastCompatibilityCheck=(async()=>{
    try{
      // If any legacy monthly row remains, keep the original compatibility path.
      // Once migration/conversion is complete, cold starts skip runtime DDL/backfill.
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
