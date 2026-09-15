const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const weekdays = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const typeNames = {
  private_student_home:'خاص عند الطالب',
  private_sozan_home:'خاص عندي',
  online:'أونلاين',
  center_group:'مجموعة السنتر',
  own_group:'مجموعة خاصة'
};
const expenseNames = {
  work_transport:'مواصلات الشغل',books_printing:'كتب وطباعة',teaching_supplies:'أدوات تعليم',
  work_internet:'إنترنت الشغل',center_fees:'مصاريف السنتر',study_materials:'مواد دراسية',other_business:'مصروف شغل آخر',
  home:'البيت',food:'الأكل',personal_transport:'مواصلات شخصية',bills:'فواتير',children:'الأطفال',
  commitments:'التزامات',personal_shopping:'شراء شخصي',health:'الصحة',other_personal:'مصروف شخصي آخر'
};
const expenseOptions = {
  personal:[
    ['home','البيت'],['food','الأكل'],['personal_transport','مواصلات شخصية'],['bills','فواتير'],
    ['children','الأطفال'],['commitments','التزامات'],['personal_shopping','شراء شخصي'],['health','الصحة'],['other_personal','أخرى']
  ],
  business:[
    ['work_transport','مواصلات الشغل'],['books_printing','كتب وطباعة'],['teaching_supplies','أدوات تعليم'],
    ['work_internet','إنترنت الشغل'],['center_fees','مصاريف السنتر'],['study_materials','مواد دراسية'],['other_business','أخرى']
  ]
};
let dashboardCache = null;
let scheduleCache = [];
let settingsCache = {};

const localDate = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
};
const monthNow = () => localDate().slice(0,7);
const money = p => `${(Number(p||0)/100).toLocaleString('ar-EG',{maximumFractionDigits:2})} ج`;
const esc = s => String(s ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function api(path, options={}) {
  const res = await fetch(path, {
    credentials:'same-origin',
    ...options,
    headers: options.body instanceof FormData ? (options.headers||{}) : {'content-type':'application/json', ...(options.headers||{})}
  });
  if (res.status === 401) { showLogin(); throw new Error('AUTH_REQUIRED'); }
  const data = res.status === 204 ? {} : await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function showLogin(){ $('#loginView').classList.remove('hidden'); $('#appView').classList.add('hidden'); }
function showApp(){ $('#loginView').classList.add('hidden'); $('#appView').classList.remove('hidden'); }

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#loginError').textContent = '';
  try {
    await api('/api/login',{method:'POST',body:JSON.stringify({passcode:$('#passcode').value})});
    showApp();
    await refreshAll();
  } catch(err) {
    if(err.message !== 'AUTH_REQUIRED') $('#loginError').textContent = err.message;
  }
});
$('#logoutBtn').addEventListener('click', async()=>{ try{await api('/api/logout',{method:'POST'});}catch{} showLogin(); });

$$('.nav-btn').forEach(btn=>btn.addEventListener('click',()=>switchView(btn.dataset.view)));
function switchView(name){
  $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  $$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));
  const titles={today:'اليوم',money:'فلوسي',schedule:'جدولي',me:'أنا'};
  $('#pageTitle').textContent=titles[name];
  if(name==='money') loadMoney();
  if(name==='schedule') loadSchedule();
  if(name==='me') loadMe();
}

async function refreshAll(){
  await Promise.all([loadDashboard(), loadSchedule(), loadSettings()]);
  await Promise.all([loadMoney(), loadMe()]);
}

async function loadDashboard(){
  const d = await api(`/api/v3/dashboard?date=${localDate()}`);
  dashboardCache = d;
  const s = d.summary;
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'صباح الخير' : 'مساء الخير';
  const displayName = settingsCache.sozan_display_name || 'سوزان';
  $('#greetingText').textContent = `${hello} يا ${displayName}`;
  $('#monthLeft').textContent = money(s.month_left_pence);
  $('#receivedValue').textContent = money(s.received_total_pence);
  $('#spentValue').textContent = money(s.expenses_pence);
  $('#outstandingValue').textContent = money(s.outstanding_pence);
  $('#outstandingCount').textContent = s.outstanding_pence > 0 ? 'اضغطي للمراجعة' : 'تمام';
  renderToday(d.sessions || []);
}

function renderToday(rows){
  const el = $('#todaySessions');
  if(!rows.length){
    el.innerHTML='<div class="empty">مفيش حصص مسجلة لليوم.<br>من «جدولي» أضيفي الطالب مرة واحدة فقط.</div>';
    return;
  }
  el.innerHTML = rows.map(r=>{
    const net = Math.max(0, Number(r.gross_pence||0)-Number(r.center_cut_pence||0));
    const done = r.status==='completed';
    const cancelled = r.status==='cancelled';
    const status = cancelled ? 'اتلغت' : done ? (r.outstanding_pence>0 ? `تمت · باقي ${money(r.outstanding_pence)}` : 'تمت واتدفعت') : 'مجدولة';
    return `<div class="session-card">
      <div class="session-head">
        <div>
          <div class="session-title">${esc(r.title)}</div>
          <div class="session-meta">${esc(r.start_time)} · ${esc(typeNames[r.session_type]||r.session_type)}${r.travel_minutes?` · انتقال ${r.travel_minutes}د`:''}</div>
        </div>
        <span class="amount-pill">${money(net)}</span>
      </div>
      <div class="status-line">${status}</div>
      ${cancelled ? '' : `<div class="session-actions">
        <button class="action-paid" data-action="complete-paid" data-id="${r.id}">✓ تمت واتدفعت</button>
        <button class="action-unpaid" data-action="${done&&r.outstanding_pence>0?'collect':'complete-unpaid'}" data-id="${r.id}">${done&&r.outstanding_pence>0?'تم التحصيل':'تمت ولسه'}</button>
        <button class="action-cancel" data-action="cancel" data-id="${r.id}">اتلغت</button>
      </div>`}
    </div>`;
  }).join('');
  el.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>runOccurrenceAction(b.dataset.id,b.dataset.action)));
}

async function runOccurrenceAction(id, action){
  try{
    await api(`/api/v3/occurrences/${id}/${action}`,{
      method:'POST',
      body:JSON.stringify({paid_at:localDate()})
    });
    toast(action==='cancel'?'تم إلغاء الحصة':'تم التحديث');
    await Promise.all([loadDashboard(),loadMoney(),loadMe()]);
  }catch(err){toast(err.message,true)}
}

async function loadMoney(){
  try{
    const [outstanding] = await Promise.all([
      api('/api/v3/outstanding'),
      api(`/api/v3/expenses?month=${monthNow()}`)
    ]);
    const s = dashboardCache?.summary;
    if(s){
      $('#earnedValue').textContent=money(s.earned_pence);
      $('#moneyReceivedValue').textContent=money(s.received_total_pence);
      $('#moneySpentValue').textContent=money(s.expenses_pence);
      $('#moneyOutstandingValue').textContent=money(s.outstanding_pence);
    }
    renderBreakdown(dashboardCache?.expense_categories || []);
    renderOutstanding(outstanding.items || []);
  }catch(err){if(err.message!=='AUTH_REQUIRED')console.error(err)}
}

function renderBreakdown(rows){
  const el=$('#expenseBreakdown');
  if(!rows.length){el.innerHTML='<div class="empty">لسه مفيش مصروفات مسجلة هذا الشهر.</div>';return;}
  const max=Math.max(...rows.map(r=>Number(r.amount_pence||0)),1);
  el.innerHTML=rows.slice(0,7).map(r=>`<div class="breakdown-row">
    <div class="breakdown-top"><span>${esc(expenseNames[r.category]||r.category)}</span><strong>${money(r.amount_pence)}</strong></div>
    <div class="bar-track"><div class="bar-fill" style="width:${Math.max(5,Math.round(Number(r.amount_pence||0)/max*100))}%"></div></div>
  </div>`).join('');
}

function renderOutstanding(items){
  const el=$('#outstandingList');
  if(!items.length){el.innerHTML='<div class="empty">مفيش فلوس معلقة. كل الحصص المكتملة متحصلة.</div>';return;}
  el.innerHTML=items.map(i=>`<div class="simple-item">
    <div><strong>${esc(i.title)}</strong><small>${esc(i.session_date)} · باقي ${money(i.outstanding_pence)}</small></div>
    <button class="collect-btn" data-collect="${i.occurrence_id}">تم التحصيل</button>
  </div>`).join('');
  el.querySelectorAll('[data-collect]').forEach(b=>b.addEventListener('click',async()=>{
    try{
      await api(`/api/v3/occurrences/${b.dataset.collect}/collect`,{method:'POST',body:JSON.stringify({paid_at:localDate()})});
      toast('تم تسجيل التحصيل');
      await Promise.all([loadDashboard(),loadMoney(),loadMe()]);
    }catch(err){toast(err.message,true)}
  }));
}

$('#outstandingCard').addEventListener('click',()=>switchView('money'));
$('#quickExpenseBtn').addEventListener('click',openExpense);
$('#moneyExpenseBtn').addEventListener('click',openExpense);
$('#otherIncomeBtn').addEventListener('click',()=>openDialog('incomeDialog'));
$('#addSessionBtn').addEventListener('click',()=>openSessionDialog());
$('#cashCheckBtn').addEventListener('click',()=>openDialog('cashDialog'));

function openExpense(){
  $('#expenseForm').reset();
  $('#expenseForm [name=date]').value=localDate();
  setExpenseScope('personal');
  openDialog('expenseDialog');
}
function setExpenseScope(scope){
  $('#expenseForm [name=scope]').value=scope;
  $$('#expenseScope button').forEach(b=>b.classList.toggle('active',b.dataset.scope===scope));
  const select=$('#expenseForm [name=category]');
  select.innerHTML=expenseOptions[scope].map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
}
$$('#expenseScope button').forEach(b=>b.addEventListener('click',()=>setExpenseScope(b.dataset.scope)));

$('#expenseForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const fd=new FormData(e.target);
  const body=Object.fromEntries(fd.entries());
  try{
    await api('/api/v3/expenses',{method:'POST',body:JSON.stringify(body)});
    closeDialog('expenseDialog'); toast('اتسجل المصروف');
    await Promise.all([loadDashboard(),loadMoney(),loadMe()]);
  }catch(err){toast(err.message,true)}
});

$('#incomeForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const fd=new FormData(e.target); const body=Object.fromEntries(fd.entries());
  body.date=localDate();
  try{
    await api('/api/v3/other-income',{method:'POST',body:JSON.stringify(body)});
    closeDialog('incomeDialog'); e.target.reset(); toast('اتسجل الدخل');
    await Promise.all([loadDashboard(),loadMoney(),loadMe()]);
  }catch(err){toast(err.message,true)}
});

async function loadSchedule(){
  try{
    const d=await api('/api/v3/sessions');
    scheduleCache=d.sessions||[];
    const el=$('#scheduleList');
    if(!scheduleCache.length){el.innerHTML='<div class="empty">الجدول فاضي.<br>أضيفي أول طالب أو مجموعة.</div>';return;}
    el.innerHTML=scheduleCache.map(s=>`<div class="schedule-card">
      <div class="schedule-main">
        <div><strong>${esc(s.title)}</strong><div class="schedule-meta">${weekdays[s.weekday]} · ${esc(s.start_time)} · ${esc(typeNames[s.session_type]||s.session_type)}</div></div>
        <span class="amount-pill">${money(s.price_pence)}</span>
      </div>
      <div class="schedule-actions"><button class="edit-btn" data-edit-session="${s.id}">تعديل</button></div>
    </div>`).join('');
    el.querySelectorAll('[data-edit-session]').forEach(b=>b.addEventListener('click',()=>openSessionDialog(b.dataset.editSession)));
  }catch(err){if(err.message!=='AUTH_REQUIRED')console.error(err)}
}

function openSessionDialog(id=null){
  const f=$('#sessionForm'); f.reset(); f.id.value=''; f.duration_minutes.value=60; f.travel_minutes.value=0; f.student_count.value=1; f.center_cut_percent.value=0; f.price_basis.value='total_session';
  $('#stopSessionBtn').classList.add('hidden'); $('#sessionDialogTitle').textContent='طالب / مجموعة جديدة';
  if(id){
    const s=scheduleCache.find(x=>String(x.id)===String(id)); if(!s)return;
    f.id.value=s.id; f.title.value=s.title; f.session_type.value=s.session_type; f.weekday.value=s.weekday; f.start_time.value=s.start_time;
    f.price.value=(Number(s.price_pence||0)/100).toFixed(2); f.duration_minutes.value=s.duration_minutes; f.travel_minutes.value=s.travel_minutes;
    f.student_count.value=s.student_count; f.center_cut_percent.value=s.center_cut_percent; f.price_basis.value=s.price_basis||'total_session'; f.location.value=s.location||'';
    $('#sessionDialogTitle').textContent='تعديل الحصة'; $('#stopSessionBtn').classList.remove('hidden');
  }
  openDialog('sessionDialog');
}

$('#sessionForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const fd=new FormData(e.target); const body=Object.fromEntries(fd.entries()); const id=body.id; delete body.id;
  ['weekday','duration_minutes','travel_minutes','student_count','center_cut_percent'].forEach(k=>body[k]=Number(body[k]||0));
  body.student_name=body.title;
  try{
    if(id) await api(`/api/v3/sessions/${id}`,{method:'PATCH',body:JSON.stringify(body)});
    else await api('/api/v3/sessions',{method:'POST',body:JSON.stringify(body)});
    closeDialog('sessionDialog'); toast(id?'اتحفظ التعديل':'اتضافت الحصة');
    await Promise.all([loadSchedule(),loadDashboard()]);
  }catch(err){toast(err.message,true)}
});

$('#stopSessionBtn').addEventListener('click',async()=>{
  const id=$('#sessionForm [name=id]').value;
  if(!id||!confirm('إيقاف الحصة من الجدول؟ الحصص القديمة تفضل محفوظة.'))return;
  try{
    await api(`/api/v3/sessions/${id}`,{method:'DELETE'});
    closeDialog('sessionDialog'); toast('تم إيقاف الحصة'); await Promise.all([loadSchedule(),loadDashboard()]);
  }catch(err){toast(err.message,true)}
});

async function loadSettings(){
  try{
    const d=await api('/api/v3/settings'); settingsCache=d.settings||{};
    const f=$('#settingsForm');
    f.opening_balance.value=(Number(settingsCache.opening_balance_pence||0)/100).toFixed(2);
    f.sozan_display_name.value=settingsCache.sozan_display_name||'سوزان';
  }catch(err){if(err.message!=='AUTH_REQUIRED')console.error(err)}
}

$('#settingsForm').addEventListener('submit',async e=>{
  e.preventDefault(); const fd=new FormData(e.target); const body=Object.fromEntries(fd.entries());
  try{
    await api('/api/v3/settings',{method:'PATCH',body:JSON.stringify(body)});
    toast('اتحفظت الإعدادات'); await loadSettings(); await Promise.all([loadDashboard(),loadMe()]);
  }catch(err){toast(err.message,true)}
});

async function loadMe(){
  try{
    const [insights,cash]=await Promise.all([
      api(`/api/v3/insights?date=${localDate()}`),
      api('/api/v3/cash-check')
    ]);
    $('#expectedBalanceValue').textContent=money(cash.expected_balance_pence);
    renderInsights(insights.insights||[]);
    renderLastCash(cash.last_check);
  }catch(err){if(err.message!=='AUTH_REQUIRED')console.error(err)}
}
function renderInsights(items){
  $('#insightsList').innerHTML=items.map(i=>`<div class="insight ${esc(i.tone||'info')}"><strong>${esc(i.title)}</strong><p>${esc(i.text)}</p></div>`).join('');
}
function renderLastCash(last){
  const el=$('#lastCashCheck');
  if(!last){el.textContent='';return;}
  const diff=Number(last.difference_pence||0);
  if(diff<0) el.textContent=`آخر مراجعة: فيه حوالي ${money(Math.abs(diff))} صرف غير مسجل.`;
  else if(diff>0) el.textContent=`آخر مراجعة: الموجود كان أعلى من المسجل بحوالي ${money(diff)}.`;
  else el.textContent='آخر مراجعة كانت متطابقة تمامًا.';
}

$('#cashForm').addEventListener('submit',async e=>{
  e.preventDefault(); const fd=new FormData(e.target); const body=Object.fromEntries(fd.entries()); body.date=localDate();
  try{
    const d=await api('/api/v3/cash-check',{method:'POST',body:JSON.stringify(body)});
    closeDialog('cashDialog');
    if(d.unrecorded_spending_pence>0) toast(`فيه ${money(d.unrecorded_spending_pence)} صرف غير مسجل`,true);
    else if(d.unrecorded_income_pence>0) toast(`فيه ${money(d.unrecorded_income_pence)} زيادة عن المسجل`);
    else toast('الحساب متطابق');
    await loadMe();
  }catch(err){toast(err.message,true)}
});

function openDialog(id){
  const d=$(`#${id}`);
  if(d.showModal) d.showModal(); else d.setAttribute('open','');
}
function closeDialog(id){
  const d=$(`#${id}`);
  if(d.close) d.close(); else d.removeAttribute('open');
}
$$('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));

function toast(msg,bad=false){
  const t=$('#toast'); t.textContent=msg; t.style.background=bad?'#9f4f5a':'#302837';
  t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2400);
}

if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});

(async()=>{
  try{
    await api(`/api/v3/dashboard?date=${localDate()}`);
    showApp();
    await refreshAll();
  }catch(err){
    if(err.message==='AUTH_REQUIRED') showLogin();
    else { showLogin(); $('#loginError').textContent=err.message; }
  }
})();