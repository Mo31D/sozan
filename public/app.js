const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const money = (pence=0) => `${(Number(pence)/100).toLocaleString('ar-EG',{maximumFractionDigits:2})} جنيه`;
const weekdays = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const typeNames = {private_home:'برايفت في البيت',private_out:'برايفت خارج البيت',online:'أونلاين',center_group:'مجموعة السنتر',own_group:'مجموعة خاصة'};
let transactionsCache = [];
let scheduleCache = [];

async function api(path, options={}) {
  const res = await fetch(path, { credentials:'same-origin', ...options, headers: options.body instanceof FormData ? (options.headers||{}) : {'content-type':'application/json', ...(options.headers||{})} });
  if (res.status === 401) { showLogin(); throw new Error('AUTH_REQUIRED'); }
  const data = res.status === 204 ? {} : await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function showLogin(){ $('#loginView').classList.remove('hidden'); $('#appView').classList.add('hidden'); }
function showApp(){ $('#loginView').classList.add('hidden'); $('#appView').classList.remove('hidden'); }

$('#loginForm').addEventListener('submit', async (e)=>{
  e.preventDefault(); $('#loginError').textContent='';
  try { await api('/api/login',{method:'POST',body:JSON.stringify({passcode:$('#passcode').value})}); showApp(); await refreshAll(); }
  catch(err){ if(err.message!=='AUTH_REQUIRED') $('#loginError').textContent=err.message; }
});
$('#logoutBtn').addEventListener('click', async()=>{ try{await api('/api/logout',{method:'POST'});}catch{} showLogin(); });

$$('.nav-btn').forEach(btn=>btn.addEventListener('click',()=>switchView(btn.dataset.view)));
function switchView(name){
  $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  $$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));
  const titles={today:'اليوم',money:'الفلوس',schedule:'الجدول',ai:'التحليل'}; $('#pageTitle').textContent=titles[name];
  if(name==='money') loadTransactions(); if(name==='schedule') loadSchedule();
}

async function refreshAll(){ await Promise.all([loadDashboard(),loadTransactions(),loadSchedule()]); }

async function loadDashboard(){
  const d=await api('/api/dashboard');
  $('#todayDate').textContent=d.date;
  const s=d.summary;
  $('#summaryCards').innerHTML=`
    ${summary('دخل الشهر',money(s.income),'good')}
    ${summary('مصروف الشغل',money(s.business_expenses),'bad')}
    ${summary('مصروف شخصي',money(s.personal_expenses),'bad')}
    ${summary('المتبقي فعليًا',money(s.cash_left),s.cash_left>=0?'good':'bad')}
    ${summary('مستحقات لم تُحصّل',money(s.pending),'')}
    ${summary('العائد/ساعة حقيقية',money(s.true_hourly_pence),'wide good')}`;
  renderToday(d.sessions);
}
function summary(label,value,classes=''){return `<div class="summary-card ${classes.includes('wide')?'wide':''}"><div class="summary-label">${esc(label)}</div><div class="summary-value ${classes}">${esc(value)}</div></div>`}

function renderToday(rows){
  const el=$('#todaySessions');
  if(!rows.length){el.innerHTML='<div class="empty">لا توجد حصص مسجلة لليوم. أضيفي الجدول الأسبوعي أولًا.</div>';return;}
  el.innerHTML=rows.map(r=>`<div class="session-card">
    <div class="session-top"><div><div class="session-title">${esc(r.title)}</div><div class="session-meta">${r.start_time} · ${typeNames[r.session_type]||r.session_type} · ${r.duration_minutes}د${r.travel_minutes?` + ${r.travel_minutes}د انتقال`:''}</div></div><span class="badge">${money(r.net_amount_pence)}</span></div>
    <div class="session-meta">${statusText(r)}${r.student_count>1?` · ${r.student_count} أطفال`:''}</div>
    <div class="session-actions">
      <button class="done" data-action="complete" data-id="${r.id}">✓ تمت</button>
      <button class="paid" data-action="paid" data-id="${r.id}">${r.paid?'↺ إلغاء الدفع':'£ تم الدفع'}</button>
      <button class="cancel" data-action="cancel" data-id="${r.id}">× ألغيت</button>
    </div></div>`).join('');
  el.querySelectorAll('button[data-action]').forEach(b=>b.addEventListener('click',()=>occAction(b.dataset.id,b.dataset.action,rows.find(x=>String(x.id)===b.dataset.id))));
}
function statusText(r){if(r.status==='completed')return r.paid?'تمت ومدفوعة':'تمت ولم تُدفع';if(r.status==='cancelled')return'ملغاة';return'مجدولة';}
async function occAction(id,action,row){
  const body=action==='complete'?{status:'completed'}:action==='cancel'?{status:'cancelled',paid:false}:{paid:!row.paid,status:row.status==='scheduled'?'completed':row.status};
  await api(`/api/occurrences/${id}`,{method:'PATCH',body:JSON.stringify(body)}); toast('تم التحديث'); await Promise.all([loadDashboard(),loadTransactions()]);
}

function resetTransactionForm(){
  const f=$('#transactionForm'); f.reset(); f.id.value=''; f.date.value=new Date().toISOString().slice(0,10);
  $('#transactionFormTitle').textContent='إضافة حركة مالية'; $('#transactionSaveBtn').textContent='حفظ'; $('#transactionCancelEdit').classList.add('hidden');
}
$('#transactionCancelEdit').addEventListener('click',resetTransactionForm);
$('#transactionForm').addEventListener('submit',async e=>{
  e.preventDefault(); const fd=new FormData(e.target); const b=Object.fromEntries(fd.entries()); const id=b.id; delete b.id;
  try{
    if(id) await api(`/api/transactions/${id}`,{method:'PATCH',body:JSON.stringify(b)});
    else await api('/api/transactions',{method:'POST',body:JSON.stringify(b)});
    resetTransactionForm(); toast(id?'تم حفظ التعديل':'تم الحفظ'); await Promise.all([loadTransactions(),loadDashboard()]);
  }catch(err){toast(err.message,true)}
});
async function loadTransactions(){
  try{
    const d=await api('/api/transactions'); transactionsCache=d.transactions||[]; const el=$('#transactionsList');
    el.innerHTML=transactionsCache.length?transactionsCache.map(t=>`<div class="transaction-card">
      <div class="row-between"><div><strong>${esc(categoryName(t.category))}</strong><div class="small muted">${esc(t.date)} · ${t.scope==='personal'?'شخصي':'شغل'}${t.note?` · ${esc(t.note)}`:''}</div></div><div class="amount ${t.kind}">${t.kind==='income'?'+':'-'}${money(t.amount_pence)}</div></div>
      <div class="item-actions">${t.source==='manual'?`<button class="edit-btn" data-edit-tx="${t.id}">تعديل</button><button class="delete-btn" data-delete-tx="${t.id}">حذف</button>`:'<span class="small muted">مرتبطة بحصة — عدّلي حالة الدفع من صفحة اليوم</span>'}</div>
    </div>`).join(''):'<div class="empty">لا توجد حركات مسجلة بعد.</div>';
    el.querySelectorAll('[data-edit-tx]').forEach(b=>b.addEventListener('click',()=>editTransaction(b.dataset.editTx)));
    el.querySelectorAll('[data-delete-tx]').forEach(b=>b.addEventListener('click',()=>deleteTransaction(b.dataset.deleteTx)));
  }catch(err){if(err.message!=='AUTH_REQUIRED')console.error(err)}
}
function editTransaction(id){
  const t=transactionsCache.find(x=>String(x.id)===String(id)); if(!t)return;
  const f=$('#transactionForm'); f.id.value=t.id; f.date.value=t.date; f.kind.value=t.kind; f.scope.value=t.scope; f.amount.value=(Number(t.amount_pence)/100).toFixed(2); f.category.value=t.category; f.note.value=t.note||'';
  $('#transactionFormTitle').textContent='تعديل الحركة'; $('#transactionSaveBtn').textContent='حفظ التعديل'; $('#transactionCancelEdit').classList.remove('hidden'); f.scrollIntoView({behavior:'smooth',block:'start'});
}
async function deleteTransaction(id){
  if(!confirm('حذف هذه الحركة نهائيًا؟'))return;
  try{await api(`/api/transactions/${id}`,{method:'DELETE'}); toast('تم الحذف'); resetTransactionForm(); await Promise.all([loadTransactions(),loadDashboard()]);}catch(err){toast(err.message,true)}
}
function categoryName(c){return({transport:'مواصلات',books:'كتب',food:'أكل',supplies:'مستلزمات',lesson:'حصة',center:'سنتر',other:'أخرى'})[c]||c}

function resetScheduleForm(){
  const f=$('#scheduleForm'); f.reset(); f.id.value=''; f.duration_minutes.value=60; f.center_cut_percent.value=0; f.travel_minutes.value=0; f.student_count.value=1;
  $('#scheduleFormTitle').textContent='إضافة حصة متكررة'; $('#scheduleSaveBtn').textContent='حفظ الحصة'; $('#scheduleCancelEdit').classList.add('hidden');
}
$('#scheduleCancelEdit').addEventListener('click',resetScheduleForm);
$('#scheduleForm').addEventListener('submit',async e=>{
  e.preventDefault(); const fd=new FormData(e.target); const b=Object.fromEntries(fd.entries()); const id=b.id; delete b.id;
  ['weekday','duration_minutes','gross_amount','center_cut_percent','travel_minutes','student_count'].forEach(k=>b[k]=Number(b[k]||0));
  try{
    if(id) await api(`/api/schedule/${id}`,{method:'PATCH',body:JSON.stringify(b)});
    else await api('/api/schedule',{method:'POST',body:JSON.stringify(b)});
    resetScheduleForm(); toast(id?'تم حفظ تعديل الحصة':'تمت إضافة الحصة'); await Promise.all([loadSchedule(),loadDashboard()]);
  }catch(err){toast(err.message,true)}
});
async function loadSchedule(){
  try{
    const d=await api('/api/schedule'); scheduleCache=d.sessions||[]; const el=$('#scheduleList');
    el.innerHTML=scheduleCache.length?scheduleCache.map(s=>`<div class="schedule-card"><div class="row-between"><div><strong>${esc(s.title)}</strong><div class="small muted">${weekdays[s.weekday]} ${s.start_time} · ${typeNames[s.session_type]||s.session_type}</div><div class="small muted">${money(s.gross_amount_pence)} · ${s.duration_minutes}د${s.center_cut_percent?` · السنتر ${s.center_cut_percent}%`:''}${s.travel_minutes?` · انتقال ${s.travel_minutes}د`:''}</div></div></div><div class="item-actions"><button class="edit-btn" data-edit-schedule="${s.id}">تعديل</button><button class="delete-btn" data-delete="${s.id}">إيقاف</button></div></div>`).join(''):'<div class="empty">الجدول فارغ.</div>';
    el.querySelectorAll('[data-edit-schedule]').forEach(b=>b.addEventListener('click',()=>editSchedule(b.dataset.editSchedule)));
    el.querySelectorAll('[data-delete]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('إيقاف هذه الحصة من الجدول؟'))return;await api(`/api/schedule/${b.dataset.delete}`,{method:'DELETE'});resetScheduleForm();await Promise.all([loadSchedule(),loadDashboard()]);toast('تم الإيقاف');}));
  }catch(err){if(err.message!=='AUTH_REQUIRED')console.error(err)}
}
function editSchedule(id){
  const s=scheduleCache.find(x=>String(x.id)===String(id)); if(!s)return;
  const f=$('#scheduleForm');
  f.id.value=s.id; f.title.value=s.title; f.session_type.value=s.session_type; f.weekday.value=s.weekday; f.start_time.value=s.start_time; f.duration_minutes.value=s.duration_minutes; f.gross_amount.value=(Number(s.gross_amount_pence)/100).toFixed(2); f.center_cut_percent.value=s.center_cut_percent; f.travel_minutes.value=s.travel_minutes; f.student_count.value=s.student_count; f.age_band.value=s.age_band||''; f.level.value=s.level||''; f.location.value=s.location||'';
  $('#scheduleFormTitle').textContent='تعديل الحصة'; $('#scheduleSaveBtn').textContent='حفظ التعديل'; $('#scheduleCancelEdit').classList.remove('hidden'); f.scrollIntoView({behavior:'smooth',block:'start'});
}

$('#adviceBtn').addEventListener('click',async()=>{
  const btn=$('#adviceBtn');btn.disabled=true;btn.textContent='جاري التحليل…';$('#adviceBox').textContent='';
  try{const d=await api('/api/advice',{method:'POST',body:'{}'});$('#adviceBox').textContent=d.advice;}catch(err){$('#adviceBox').textContent=err.message;}finally{btn.disabled=false;btn.textContent='حلّل آخر 28 يومًا';}
});

function toast(msg,bad=false){const t=$('#toast');t.textContent=msg;t.style.background=bad?'#991b1b':'#111827';t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2200)}
function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
resetTransactionForm();
(async()=>{try{await api('/api/dashboard');showApp();await refreshAll();}catch(err){if(err.message!=='AUTH_REQUIRED')showLogin();}})();
