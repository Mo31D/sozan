(()=>{
 const esc=s=>String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
 const money=p=>`${(Number(p||0)/100).toLocaleString('ar-EG',{maximumFractionDigits:2})} ج`;
 const localMonth=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`};
 const fmtDate=d=>{if(!d)return'';try{return new Intl.DateTimeFormat('ar-EG',{day:'numeric',month:'short'}).format(new Date(`${String(d).slice(0,10)}T12:00:00`))}catch{return String(d)}};
 const fmtMonth=m=>{if(!/^\d{4}-\d{2}$/.test(String(m||'')))return String(m||'');const[y,mo]=m.split('-').map(Number);return new Intl.DateTimeFormat('ar-EG',{month:'long',year:'numeric'}).format(new Date(y,mo-1,1))};

 // One-use boot replay: app.js asks for today's dashboard twice during initialisation.
 // Re-use the first successful response once, then immediately return to live requests.
 const rawFetch=window.fetch.bind(window);
 let dashboardReplay=null, accountCache=new Map(), lastAccountId=null, inheritedMonthly=false;
 window.fetch=async(input,init={})=>{
  const reqUrl=typeof input==='string'?input:input?.url||'';
  const method=String(init?.method||(typeof input!=='string'&&input?.method)||'GET').toUpperCase();
  let url;try{url=new URL(reqUrl,location.href)}catch{return rawFetch(input,init)}
  const key=url.pathname+url.search;
  if(method==='GET'&&url.pathname==='/api/v4/dashboard'&&dashboardReplay&&dashboardReplay.key===key&&!dashboardReplay.used&&Date.now()-dashboardReplay.at<10000){dashboardReplay.used=true;return dashboardReplay.response.clone()}
  const response=await rawFetch(input,init);
  if(method==='GET'&&url.pathname==='/api/v4/dashboard'&&response.ok&&!dashboardReplay){dashboardReplay={key,response:response.clone(),used:false,at:Date.now()}}
  const account=url.pathname.match(/^\/api\/v4\/students\/(\d+)\/account$/);
  if(account&&method==='GET'&&response.ok){try{const data=await response.clone().json();lastAccountId=Number(account[1]);accountCache.set(lastAccountId,data)}catch{}}
  if(url.pathname==='/api/v3/sessions'&&method==='POST'&&response.ok){try{const data=await response.clone().json();if(data.inherited_monthly)inheritedMonthly=true}catch{}}
  return response;
 };

 function setBusy(form){if(!form||form.id==='loginForm'||form.id==='resetDataForm')return;const b=form.querySelector('button[type="submit"]');if(!b||b.disabled)return;b.dataset.oldText=b.textContent;b.disabled=true;b.textContent='جاري الحفظ…';b.dataset.auditBusy='1';setTimeout(()=>restoreButton(b),12000)}
 function restoreButton(b){if(!b||!b.dataset.auditBusy)return;b.disabled=false;b.textContent=b.dataset.oldText||'حفظ';delete b.dataset.oldText;delete b.dataset.auditBusy}
 function restoreBusy(){document.querySelectorAll('[data-audit-busy]').forEach(restoreButton)}
 document.addEventListener('submit',e=>setBusy(e.target),true);
 document.addEventListener('click',e=>{const b=e.target.closest('[data-action],[data-session-menu],[data-past-action]');if(!b)return;if(b.dataset.auditClickBusy){e.preventDefault();e.stopImmediatePropagation();return}b.dataset.auditClickBusy='1';setTimeout(()=>{if(b.isConnected)b.disabled=true},0);setTimeout(()=>{if(b.isConnected){b.disabled=false;delete b.dataset.auditClickBusy}},8000)},true);

 function cleanReceiptHint(){const el=document.getElementById('receiptStudentHint');if(!el)return;let h=el.innerHTML;h=h.replace('أقدم الحصص المستحقة','أقدم المستحقات').replace(/ من (\d+) حصة/g,' في $1 مستحق').replace('للحصص القادمة','للمستحقات القادمة');if(h!==el.innerHTML)el.innerHTML=h}
 function cleanScheduleTimes(){document.querySelectorAll('#scheduleList .schedule-meta').forEach(el=>{if(/·\s*·/.test(el.textContent))el.textContent=el.textContent.replace(/·\s*·/,'· الوقت غير محدد ·')})}
 function cleanActionWords(){document.querySelectorAll('#sessionActionList button').forEach(b=>{if(b.textContent.includes('رجوع لمجدولة')&&b.firstChild)b.firstChild.nodeValue='التراجع عن تسجيل الحصة';if(b.textContent.includes('إرجاع الحصة')&&b.firstChild)b.firstChild.nodeValue='إعادة الحصة للجدول'});const t=document.getElementById('toastText');if(t?.textContent==='رجعت لمجدولة')t.textContent='تم التراجع عن تسجيل الحصة'}

 function reviewVisibility(){const list=document.getElementById('reviewList'),panel=list?.closest('.panel');if(!list||!panel)return;const allGood=!!list.querySelector('.all-good');panel.style.display=allGood?'none':'';if(!allGood){const h=panel.querySelector('h3'),k=panel.querySelector('.kicker');if(h)h.textContent='تنبيهات تحتاج مراجعة';if(k)k.textContent='لو في حاجة محتاجة بصّة'}}

 function decorateBillingHint(){const select=document.getElementById('billingMethod'),hint=document.getElementById('billingHint');if(!select||!hint||select.dataset.auditHintBound)return;select.dataset.auditHintBound='1';const sync=()=>{if(select.value==='monthly')hint.textContent='المبلغ يتحسب مرة واحدة للشهر كله، والحصص تسجل حضور فقط. لو للطالب أكتر من موعد أسبوعي، الاشتراك الشهري بيغطي مواعيده كلها.'};select.addEventListener('change',()=>setTimeout(sync,0));sync()}

 function renderStudentAccount(){const body=document.getElementById('studentProfileBody'),data=accountCache.get(lastAccountId);if(!body||!data?.student||!body.querySelector('.student-summary-grid'))return;if(body.querySelector('.audit-billing-summary')&&body.dataset.auditAccount===String(lastAccountId))return;const s=data.student;body.dataset.auditAccount=String(lastAccountId);
  body.querySelectorAll('.audit-billing-summary,.audit-monthly-section').forEach(x=>x.remove());
  const grid=body.querySelector('.student-summary-grid');
  const billing=document.createElement('div');billing.className='audit-billing-summary';billing.style.cssText='margin-top:9px;padding:10px 12px;border:1px solid #ebe6ee;border-radius:14px;background:#f8f5fa;font-size:11px;line-height:1.6';
  billing.innerHTML=s.billing_type==='monthly'?`<strong>طريقة الحساب: شهري</strong><div style="color:#837b8d">${money(s.monthly_price_pence)} للشهر · يشمل مواعيد الطالب الأسبوعية</div>`:'<strong>طريقة الحساب: بالحصة</strong>';
  grid.insertAdjacentElement('afterend',billing);

  const dues=(data.monthly_dues||[]).slice(0,6);
  if(dues.length){const section=document.createElement('div');section.className='profile-section audit-monthly-section';section.innerHTML=`<h4>الاشتراكات الشهرية</h4><div class="timeline-mini">${dues.map(d=>{const total=Math.max(0,Number(d.amount_pence||0)+Number(d.adjustment_pence||0)),paid=Number(d.paid_pence||0),left=Math.max(0,total-paid);return `<div class="timeline-row"><span class="dot income-dot"></span><div><strong>اشتراك ${esc(fmtMonth(d.month))} · ${left>0?`باقي ${money(left)}`:'مسدد'}</strong><small>المستحق ${money(total)}${paid?` · المدفوع ${money(paid)}`:''}</small></div></div>`}).join('')}</div>`;billing.insertAdjacentElement('afterend',section)}

  const timelineSection=[...body.querySelectorAll('.profile-section')].find(x=>x.querySelector('h4')?.textContent==='آخر الحركة');const target=timelineSection?.querySelector('.timeline-mini');
  if(target){const items=(data.timeline||[]).slice(0,12);target.innerHTML=items.length?items.map(x=>{if(x.kind==='receipt')return `<div class="timeline-row"><span class="dot income-dot"></span><div><strong>استلام ${money(x.amount_pence)}</strong><small>${fmtDate(x.date)}${x.deleted_at?' · محذوف':''}</small></div></div>`;if(x.billing_type==='monthly'){const st=x.status==='completed'?'تمت':x.status==='cancelled'?'ملغاة':'مجدولة';return `<div class="timeline-row"><span class="dot session-dot"></span><div><strong>حصة شهرية · ${st}</strong><small>${fmtDate(x.date)} · ضمن الاشتراك الشهري</small></div></div>`}const state=x.status==='completed'?(Number(x.outstanding_pence||0)>0?'لسه عليها':'مدفوعة'):x.status==='cancelled'?'ملغاة':'مجدولة';return `<div class="timeline-row"><span class="dot session-dot"></span><div><strong>حصة · ${state}</strong><small>${fmtDate(x.date)} · ${money(x.earned_pence)}</small></div></div>`}).join(''):'<div class="empty">لسه مفيش تاريخ كفاية.</div>'}
 }

 function setupReports(){const input=document.getElementById('reportMonth'),next=document.getElementById('reportNext');if(!input||input.dataset.auditMax)return;input.dataset.auditMax='1';input.max=localMonth();const sync=()=>{input.max=localMonth();if(next)next.disabled=!!input.value&&input.value>=localMonth()};input.addEventListener('change',sync);document.getElementById('reportPrev')?.addEventListener('click',()=>setTimeout(sync,0));document.getElementById('reportCurrent')?.addEventListener('click',()=>setTimeout(sync,0));next?.addEventListener('click',()=>setTimeout(sync,0));sync()}

 function styleAuditUi(){if(document.getElementById('auditUiStyles'))return;const s=document.createElement('style');s.id='auditUiStyles';s.textContent='button[disabled]{opacity:.58;cursor:default}.audit-billing-summary strong{font-size:11px}.audit-monthly-section{margin-top:12px}';document.head.appendChild(s)}
 function run(){styleAuditUi();cleanReceiptHint();cleanScheduleTimes();cleanActionWords();reviewVisibility();decorateBillingHint();renderStudentAccount();setupReports();if(inheritedMonthly){const t=document.getElementById('toastText');if(t?.textContent==='اتضافت الحصة'){t.textContent='اتضاف الموعد ضمن الاشتراك الشهري';inheritedMonthly=false}}const toast=document.getElementById('toast');if(toast?.classList.contains('show'))restoreBusy()}
 let timer=null;const schedule=()=>{clearTimeout(timer);timer=setTimeout(run,20)};
 new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','open']});
 document.addEventListener('change',schedule);document.addEventListener('click',()=>setTimeout(schedule,30));
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
})();
