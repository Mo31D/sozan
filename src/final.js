import app from './v6.js';

const EXTRA='<script type="module" src="/v6-extra.js"></script>';

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html')){
      const response=await env.ASSETS.fetch(request);
      if(!response.ok)return response;
      let html=await response.text();
      if(!html.includes('/v6-extra.js'))html=html.replace('</body>',`  ${EXTRA}\n</body>`);
      const headers=new Headers(response.headers);
      headers.set('content-type','text/html; charset=utf-8');
      headers.set('cache-control','no-cache');
      return new Response(html,{status:response.status,headers});
    }

    if(request.method==='POST'&&url.pathname==='/api/v3/sessions'){
      const guarded=await inheritExistingStudentPlan(request,env).catch(()=>null);
      if(guarded)return app.fetch(guarded,env,ctx);
    }
    return app.fetch(request,env,ctx);
  }
};

async function inheritExistingStudentPlan(request,env){
  const body=await request.clone().json();
  let studentId=Number(body.student_id||0);
  if(!studentId){
    const name=String(body.student_name||body.title||'').trim();
    if(name){const s=await env.DB.prepare(`SELECT id FROM students_v3 WHERE active=1 AND deleted_at IS NULL AND lower(trim(name))=lower(trim(?1)) ORDER BY id LIMIT 1`).bind(name).first();studentId=Number(s?.id||0)}
  }
  if(!studentId)return null;
  const plan=await env.DB.prepare(`SELECT billing_mode,package_size,package_price_pence FROM student_billing_v6 WHERE student_id=?1`).bind(studentId).first();
  if(!plan)return null;
  body.student_id=studentId;
  body.billing_mode=plan.billing_mode||'per_session';
  body.package_size=Number(plan.package_size||8);
  body.package_price=Number(plan.package_price_pence||0)/100;
  const headers=new Headers(request.headers);headers.set('content-type','application/json');
  return new Request(request.url,{method:'POST',headers,body:JSON.stringify(body)});
}
