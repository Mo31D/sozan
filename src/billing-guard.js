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
    const completed=studentId?await env.DB.prepare(`SELECT COUNT(*) count FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE r.student_id=?1 AND o.status='completed' AND substr(COALESCE(o.rescheduled_to_date,o.session_date),1,7)=?2`).bind(studentId,month).first():await env.DB.prepare(`SELECT COUNT(*) count FROM session_occurrences_v3 WHERE recurring_session_id=?1 AND status='completed' AND substr(COALESCE(rescheduled_to_date,session_date),1,7)=?2`).bind(id,month).first();
    if(Number(completed?.count||0)>0)return json({error:'طريقة الحساب تتغير مع بداية شهر جديد. الشهر الحالي فيه حصص تمت بالفعل، فخلي التغيير لأول الشهر الجاي علشان الحساب يفضل صحيح.'},409);
    const response=await billing.fetch(request,env,ctx);if(!response.ok)return response;
    if(before.price_type==='monthly'&&body.price_type==='per_session'){
      if(studentId){await env.DB.prepare(`DELETE FROM monthly_dues_v5 WHERE student_id=?1 AND month=?2`).bind(studentId,month).run();await rebalanceStudentAll(env.DB,studentId);}else await env.DB.prepare(`DELETE FROM monthly_dues_v5 WHERE source_session_id=?1 AND month=?2`).bind(id,month).run();
    }
    return response;
   }
  }
  return billing.fetch(request,env,ctx);
 }
};
async function safeBody(request){try{return await request.clone().json()}catch{return null}}
function londonMonth(){const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit'}).formatToParts(new Date()),g=t=>p.find(x=>x.type===t)?.value;return `${g('year')}-${g('month')}`}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:JSON_HEADERS})}
