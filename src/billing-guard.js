import billing,{ensureMonthlyDuesThroughMonth,rebalanceStudentsWithMonthly,rebalanceStudentAll} from './billing.js';
export{ensureMonthlyDuesThroughMonth,rebalanceStudentsWithMonthly};

const JSON_HEADERS={'content-type':'application/json; charset=utf-8'};
export default{
 async fetch(request,env,ctx){
  const url=new URL(request.url),m=url.pathname.match(/^\/api\/v3\/sessions\/(\d+)$/);
  if(m&&request.method==='PATCH'){
   const body=await safeBody(request),id=Number(m[1]),before=await env.DB.prepare(`SELECT * FROM recurring_sessions_v3 WHERE id=?1`).bind(id).first();
   if(before&&body?.price_type&&body.price_type!==before.price_type){
    const month=londonMonth(),studentId=Number(before.student_id||0);
    const completed=await completedThisMonth(env.DB,id,studentId,month);
    if(Number(completed?.count||0)>0)return json({error:'طريقة الحساب تتغير مع بداية شهر جديد. الشهر الحالي فيه حصص تمت بالفعل، فخلي التغيير لأول الشهر الجاي علشان الحساب يفضل صحيح.'},409);
    const response=await billing.fetch(request,env,ctx);if(!response.ok)return response;
    if(before.price_type==='monthly'&&body.price_type==='per_session'){
      if(studentId){await env.DB.prepare(`DELETE FROM monthly_dues_v5 WHERE student_id=?1 AND month=?2`).bind(studentId,month).run();await rebalanceStudentAll(env.DB,studentId);}else await env.DB.prepare(`DELETE FROM monthly_dues_v5 WHERE source_session_id=?1 AND month=?2`).bind(id,month).run();
    }
    return response;
   }

   // A monthly amount can be corrected before the month has financial/activity
   // history. Once attendance or payment exists, keep the current month immutable.
   if(before&&before.price_type==='monthly'&&(body?.price_type??'monthly')==='monthly'){
    const targetNet=monthlyNet({...before,...body,price_pence:body?.price!==undefined?moneyToPence(body.price):before.price_pence});
    const oldNet=monthlyNet(before);
    if(targetNet!==oldNet){
      const month=londonMonth(),studentId=Number(before.student_id||0),due=await currentDue(env.DB,id,studentId,month);
      if(due){
        const completed=await completedThisMonth(env.DB,id,studentId,month);
        if(Number(completed?.count||0)>0||Number(due.paid_pence||0)>0)return json({error:'قيمة اشتراك الشهر الحالي اتثبتت لأن فيه حضور أو دفع اتسجل. خلي السعر الجديد يبدأ من الشهر الجاي علشان الحساب يفضل واضح.'},409);
      }
      const response=await billing.fetch(request,env,ctx);if(!response.ok)return response;
      if(due){
        const amount=await currentMonthlyNet(env.DB,id,studentId);
        await env.DB.prepare(`UPDATE monthly_dues_v5 SET amount_pence=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2`).bind(amount,due.id).run();
        if(studentId)await rebalanceStudentAll(env.DB,studentId);
      }
      return response;
    }
   }
  }
  return billing.fetch(request,env,ctx);
 }
};
async function completedThisMonth(db,id,studentId,month){return studentId?db.prepare(`SELECT COUNT(*) count FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE r.student_id=?1 AND o.status='completed' AND substr(COALESCE(o.rescheduled_to_date,o.session_date),1,7)=?2`).bind(studentId,month).first():db.prepare(`SELECT COUNT(*) count FROM session_occurrences_v3 WHERE recurring_session_id=?1 AND status='completed' AND substr(COALESCE(rescheduled_to_date,session_date),1,7)=?2`).bind(id,month).first()}
async function currentDue(db,id,studentId,month){return studentId?db.prepare(`SELECT d.id,COALESCE((SELECT SUM(a.amount_pence) FROM monthly_due_allocations_v5 a WHERE a.monthly_due_id=d.id),0) paid_pence FROM monthly_dues_v5 d WHERE d.student_id=?1 AND d.month=?2 ORDER BY d.id LIMIT 1`).bind(studentId,month).first():db.prepare(`SELECT d.id,COALESCE((SELECT SUM(a.amount_pence) FROM monthly_due_allocations_v5 a WHERE a.monthly_due_id=d.id),0) paid_pence FROM monthly_dues_v5 d WHERE d.source_session_id=?1 AND d.month=?2 ORDER BY d.id LIMIT 1`).bind(id,month).first()}
async function currentMonthlyNet(db,id,studentId){if(studentId){const rows=await db.prepare(`SELECT * FROM recurring_sessions_v3 WHERE active=1 AND student_id=?1 AND price_type='monthly'`).bind(studentId).all();return Math.max(0,...(rows.results||[]).map(monthlyNet))}const r=await db.prepare(`SELECT * FROM recurring_sessions_v3 WHERE id=?1`).bind(id).first();return monthlyNet(r||{})}
function monthlyNet(r){const price=Number(r.price_pence||0),count=Math.max(1,Number(r.student_count||1)),gross=r.price_basis==='per_student'?price*count:price,cut=Math.round(gross*Number(r.center_cut_percent||0)/100);return Math.max(0,gross-cut)}
async function safeBody(request){try{return await request.clone().json()}catch{return null}}
function moneyToPence(v){const n=Number(String(v??'').replace(',','.'));return Number.isFinite(n)?Math.max(0,Math.round(n*100)):0}
function londonMonth(){const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit'}).formatToParts(new Date()),g=t=>p.find(x=>x.type===t)?.value;return `${g('year')}-${g('month')}`}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:JSON_HEADERS})}
