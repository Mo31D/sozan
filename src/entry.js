import app,{ensureMonthlyDuesThroughMonth,rebalanceStudentsWithMonthly} from './billing.js';

const JSON_HEADERS={'content-type':'application/json; charset=utf-8'};
const UI_SCRIPTS='<script src="/loading-view.js"></script><script type="module" src="/schedule-view.js"></script><script type="module" src="/billing-view.js"></script><script src="/billing-dialog-sync.js"></script><script type="module" src="/reports-view.js"></script>';

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==='/api/health')return json({ok:true,app:env.APP_NAME||'Sozan Tutor OS',version:'5.0',mutation_dedupe:true,receipt_rebalance:true,schedule_views:true,reports:true,monthly_billing:true,loading_state:true});
    if(url.pathname==='/api/v4/reports'&&request.method==='GET'){const auth=await checkAuth(request,env,ctx);if(!auth.ok)return auth.response;return buildReport(url,env)}
    if((url.pathname==='/'||url.pathname==='/index.html')&&request.method==='GET'){const response=await env.ASSETS.fetch(request);if(!response.ok)return response;let html=await response.text();if(!html.includes('/billing-view.js')){const marker='<script type="module" src="/app.js"></script>';html=html.includes(marker)?html.replace(marker,`${marker}\n  ${UI_SCRIPTS}`):html.replace('</body>',`  ${UI_SCRIPTS}\n</body>`)}const headers=new Headers(response.headers);headers.set('content-type','text/html; charset=utf-8');headers.set('cache-control','no-cache');return new Response(html,{status:response.status,headers})}
    return app.fetch(request,env,ctx);
  }
};

async function checkAuth(request,env,ctx){const probeUrl=new URL('/api/v3/settings',request.url),probe=new Request(probeUrl,{method:'GET',headers:request.headers}),response=await app.fetch(probe,env,ctx);return{ok:response.ok,response}}

async function buildReport(url,env){
  const month=validMonth(url.searchParams.get('month'));if(!month)return json({error:'اختاري شهر صحيح'},400);
  await ensureMonthlyDuesThroughMonth(env.DB,month);await rebalanceStudentsWithMonthly(env.DB);
  const [sessionSummary,directCash,receiptCash,otherIncome,expenseSummary,occOutstanding,monthlySummary,sessionsByType,expensesByCategory,otherIncomeByCategory]=await Promise.all([
    env.DB.prepare(`SELECT COALESCE(SUM(o.earned_pence),0) earned_pence,COUNT(*) completed_sessions FROM session_occurrences_v3 o WHERE o.status='completed' AND substr(COALESCE(o.rescheduled_to_date,o.session_date),1,7)=?1`).bind(month).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(amount_pence),0) value FROM payments_v3 WHERE reversed_at IS NULL AND substr(paid_at,1,7)=?1`).bind(month).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(amount_pence),0) value FROM student_receipts_v4 WHERE deleted_at IS NULL AND substr(received_at,1,7)=?1`).bind(month).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(amount_pence),0) value FROM other_income_v3 WHERE deleted_at IS NULL AND substr(income_date,1,7)=?1`).bind(month).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(amount_pence),0) total,COALESCE(SUM(CASE WHEN scope='business' THEN amount_pence ELSE 0 END),0) business,COALESCE(SUM(CASE WHEN scope='personal' THEN amount_pence ELSE 0 END),0) personal FROM expenses_v3 WHERE deleted_at IS NULL AND substr(expense_date,1,7)=?1`).bind(month).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN due>0 THEN due ELSE 0 END),0) value FROM (SELECT o.earned_pence-COALESCE((SELECT SUM(p.amount_pence) FROM payments_v3 p WHERE p.occurrence_id=o.id AND p.reversed_at IS NULL),0)-COALESCE((SELECT SUM(a.amount_pence) FROM receipt_allocations_v4 a JOIN student_receipts_v4 rr ON rr.id=a.receipt_id WHERE a.occurrence_id=o.id AND rr.deleted_at IS NULL),0) due FROM session_occurrences_v3 o WHERE o.status='completed' AND substr(COALESCE(o.rescheduled_to_date,o.session_date),1,7)=?1)`).bind(month).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(MAX(0,amount_pence+adjustment_pence)),0) earned_pence,COALESCE(SUM(MAX(0,(amount_pence+adjustment_pence)-COALESCE((SELECT SUM(a.amount_pence) FROM monthly_due_allocations_v5 a WHERE a.monthly_due_id=monthly_dues_v5.id),0))),0) outstanding_pence FROM monthly_dues_v5 WHERE month=?1`).bind(month).first(),
    env.DB.prepare(`SELECT key,SUM(amount_pence) amount_pence,SUM(count) count FROM (SELECT r.session_type key,COALESCE(SUM(o.earned_pence),0) amount_pence,COUNT(*) count FROM session_occurrences_v3 o JOIN recurring_sessions_v3 r ON r.id=o.recurring_session_id WHERE o.status='completed' AND substr(COALESCE(o.rescheduled_to_date,o.session_date),1,7)=?1 GROUP BY r.session_type UNION ALL SELECT COALESCE(session_type,'monthly') key,COALESCE(SUM(MAX(0,amount_pence+adjustment_pence)),0) amount_pence,0 count FROM monthly_dues_v5 WHERE month=?1 GROUP BY session_type) GROUP BY key ORDER BY amount_pence DESC`).bind(month).all(),
    env.DB.prepare(`SELECT category key,COALESCE(SUM(amount_pence),0) amount_pence,COUNT(*) count FROM expenses_v3 WHERE deleted_at IS NULL AND substr(expense_date,1,7)=?1 GROUP BY category ORDER BY amount_pence DESC`).bind(month).all(),
    env.DB.prepare(`SELECT category key,COALESCE(SUM(amount_pence),0) amount_pence,COUNT(*) count FROM other_income_v3 WHERE deleted_at IS NULL AND substr(income_date,1,7)=?1 GROUP BY category ORDER BY amount_pence DESC`).bind(month).all()
  ]);
  const studentCash=Number(directCash?.value||0)+Number(receiptCash?.value||0),other=Number(otherIncome?.value||0),expenses=Number(expenseSummary?.total||0),earned=Number(sessionSummary?.earned_pence||0)+Number(monthlySummary?.earned_pence||0),outstanding=Number(occOutstanding?.value||0)+Number(monthlySummary?.outstanding_pence||0);
  return json({month,summary:{session_earned_pence:earned,per_session_earned_pence:Number(sessionSummary?.earned_pence||0),monthly_earned_pence:Number(monthlySummary?.earned_pence||0),completed_sessions:Number(sessionSummary?.completed_sessions||0),student_cash_pence:studentCash,other_income_pence:other,expenses_pence:expenses,business_expenses_pence:Number(expenseSummary?.business||0),personal_expenses_pence:Number(expenseSummary?.personal||0),cash_net_pence:studentCash+other-expenses,month_outstanding_pence:outstanding},sessions_by_type:sessionsByType.results||[],expenses_by_category:expensesByCategory.results||[],other_income_by_category:otherIncomeByCategory.results||[]});
}
function validMonth(v){return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v||''))?String(v):null}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:JSON_HEADERS})}
