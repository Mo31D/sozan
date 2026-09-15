const V6E={studentId:null,busy:false,sessions:null,loadOverlay:null};
const $e=s=>document.querySelector(s);
const eEsc=s=>String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
const eMoney=p=>`${(Number(p||0)/100).toLocaleString('ar-EG',{maximumFractionDigits:2})} ج`;
const eDate=d=>{try{return new Intl.DateTimeFormat('ar-EG',{day:'numeric',month:'short'}).format(new Date(`${String(d).slice(0,10)}T12:00:00`))}catch{return String(d||'')}};
async function eApi(path){const r=await fetch(path,{credentials:'same-origin'}),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'تعذر تحميل البيانات');return d}

document.addEventListener('click',e=>{const b=e.target.closest('[data-student],[data-schedule-student],[data-all-student]');if(b){const id=b.dataset.student||b.dataset.scheduleStudent||b.dataset.allStudent;if(id)V6E.studentId=Number(id)}},true);

function showLoginLoading(){
 let x=$e('#v6LoginLoading');if(x)return;
 x=document.createElement('div');x.id='v6LoginLoading';x.style.cssText='position:fixed;inset:0;z-index:1700;background:#f8f6fa;display:grid;place-items:center;padding:24px';
 x.innerHTML='<div class="v6-load-card"><div class="v6-load-logo">س</div><strong>بنجهز بياناتك…</strong><p>بنحمّل الجدول والحسابات.</p><div class="v6-lines"><i></i><i></i><i></i></div></div>';document.body.appendChild(x);V6E.loadOverlay=x;
 setTimeout(()=>{const p=x.querySelector('p');if(x.isConnected&&p)p.textContent='التحميل أخذ وقت أطول شوية، لكن البرنامج ما زال شغال.'},6000);
}
function hideLoginLoading(){const x=$e('#v6LoginLoading');if(x){x.style.opacity='0';x.style.pointerEvents='none';setTimeout(()=>x.remove(),220)}V6E.loadOverlay=null}
const originalFetch=window.fetch.bind(window);
window.fetch=async(...args)=>{const res=await originalFetch(...args);try{const raw=typeof args[0]==='string'?args[0]:args[0]?.url||'',u=new URL(raw,location.href);if(res.ok&&['/api/v4/dashboard','/api/v3/dashboard','/api/v3/today'].includes(u.pathname))hideLoginLoading()}catch{}return res};
$e('#loginForm')?.addEventListener('submit',()=>showLoginLoading(),true);

async function patchProfile(){
 const dialog=$e('#studentDialog');if(!dialog?.open||!V6E.studentId||V6E.busy)return;const body=$e('#studentProfileBody');if(!body)return;
 if(body.dataset.v6Patched===String(V6E.studentId)&&body.querySelector('.v6-package-profile'))return;
 V6E.busy=true;
 try{
  const d=await eApi(`/api/v4/students/${V6E.studentId}/account`),s=d.student;if(!s)return;body.dataset.v6Patched=String(V6E.studentId);
  if(s.billing_mode!=='package')return;
  const grid=body.querySelector('.student-summary-grid');if(grid){const cells=[...grid.children];if(cells[0]){cells[0].querySelector('span').textContent='جاهز للتحصيل';cells[0].querySelector('strong').textContent=eMoney(s.due_now_pence||s.outstanding_pence)}if(cells[1]){cells[1].querySelector('span').textContent='الدورة الحالية';const p=s.package_progress||{completed:0,size:s.package_size||8};cells[1].querySelector('strong').textContent=`${p.completed||0}/${p.size||8}`}}
  body.querySelector('.v6-package-profile')?.remove();const p=s.package_progress||{completed:0,size:s.package_size||8,status:'open'},left=Math.max(0,Number(p.size||8)-Number(p.completed||0)),box=document.createElement('div');box.className='v6-package-profile';box.style.cssText='margin:10px 0;padding:12px;border:1px solid #ebe6ee;border-radius:15px;background:#f8f5fa;font-size:10px;line-height:1.65';box.innerHTML=`<strong style="display:block;font-size:12px">باقة ${p.size||8} حصص · ${eMoney(s.package_price_pence)}</strong><div style="margin-top:4px;color:#837b8d">${Number(s.due_now_pence||0)>0?'في مبلغ وصل موعد تحصيله.':`تم ${p.completed||0} · باقي ${left} ${left===1?'حصة':'حصص'} على موعد الدفع.`}</div><div style="height:6px;background:#e9e2ee;border-radius:999px;margin-top:8px;overflow:hidden"><i style="display:block;height:100%;width:${Math.min(100,Math.round(Number(p.completed||0)/Math.max(1,Number(p.size||8))*100))}%;background:#b9a6cb;border-radius:999px"></i></div>`;grid?.after(box);
  const sched=body.querySelector('.schedule-mini');if(sched&&(s.schedules||[]).length)sched.innerHTML=(s.schedules||[]).map(x=>`<span>${['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'][x.weekday]} · ${eEsc(x.start_time||'الوقت غير محدد')} · ${eEsc({private_student_home:'خاص عند الطالب',private_sozan_home:'خاص عندي',online:'أونلاين',center_group:'السنتر',own_group:'مجموعة'}[x.session_type]||'حصة')}</span>`).join('');
  const section=[...body.querySelectorAll('.profile-section')].find(x=>x.querySelector('h4')?.textContent==='آخر الحركة'),timeline=section?.querySelector('.timeline-mini');if(timeline){timeline.innerHTML=(d.timeline||[]).slice(0,14).map(x=>x.kind==='receipt'?`<div class="timeline-row"><span class="dot income-dot"></span><div><strong>استلام ${eMoney(x.amount_pence??x.earned_pence)}</strong><small>${eDate(x.date)}</small></div></div>`:`<div class="timeline-row"><span class="dot session-dot"></span><div><strong>${x.status==='completed'?(x.billing_mode==='package'?'حصة تمت ضمن الباقة':'حصة تمت'):x.status==='cancelled'?'حصة ملغاة':'حصة مجدولة'}</strong><small>${eDate(x.date)}${x.status==='completed'?` · قيمة الشغل ${eMoney(x.earned_pence)}`:''}</small></div></div>`).join('')||'<div class="empty">لسه مفيش تاريخ كفاية.</div>'}
 }catch(e){console.error(e)}finally{V6E.busy=false}
}

async function patchReview(){const list=$e('#reviewList'),panel=list?.closest('.panel');if(!list||!panel||panel.dataset.v6Review==='1')return;try{const d=await eApi('/api/v4/review'),items=d.items||[];panel.dataset.v6Review='1';if(!items.length){panel.style.display='none';return}panel.style.display='';const h=panel.querySelector('h3'),k=panel.querySelector('.kicker');if(h)h.textContent='تنبيهات تحتاج مراجعة';if(k)k.textContent='بس الحاجات اللي محتاجة بصّة';list.innerHTML=items.map(x=>`<div class="review-item ${eEsc(x.tone||x.severity||'info')}"><strong>${eEsc(x.title)}</strong><span>${eEsc(x.text||x.detail||'')}</span></div>`).join('')}catch(e){console.error(e)}}

async function inheritPackageInForm(){
 const f=$e('#sessionForm');if(!f||!f.closest('dialog')?.open||Number(f.querySelector('[name="id"]')?.value||0))return;
 const name=String(f.querySelector('[name="title"]')?.value||'').trim().toLowerCase();if(!name)return;
 try{if(!V6E.sessions)V6E.sessions=(await eApi('/api/v3/sessions')).sessions||[];const s=V6E.sessions.find(x=>String(x.student_name||x.title||'').trim().toLowerCase()===name&&x.billing_mode==='package');if(!s)return;const mode=$e('#v6BillingMode'),size=f.querySelector('[name="package_size"]'),price=f.querySelector('[name="package_price"]');if(mode){mode.value='package';mode.dispatchEvent(new Event('change',{bubbles:true}))}if(size)size.value=s.package_size||8;if(price)price.value=(Number(s.package_price_pence||0)/100).toFixed(2)}catch(e){console.error(e)}
}
let inheritTimer=null;document.addEventListener('input',e=>{if(e.target?.matches('#sessionForm [name="title"]')){clearTimeout(inheritTimer);inheritTimer=setTimeout(inheritPackageInForm,220)}},true);

async function patchReportExtras(){
 const d=$e('#v6Reports');if(!d?.open)return;const month=$e('#v6ReportMonth')?.value,grid=$e('#v6ReportBody .v6-report-grid');if(!month||!grid||grid.dataset.v6Extra===month)return;
 try{const r=await eApi(`/api/v6/reports?month=${month}`),s=r.summary||{};grid.dataset.v6Extra=month;const income=document.createElement('div');income.className='v6-metric v6-extra-income';income.innerHTML=`<span>دخل آخر</span><strong>${eMoney(s.other_income_pence||0)}</strong><small>غير مرتبط بالحصص</small>`;grid.appendChild(income);const metrics=[...grid.querySelectorAll('.v6-metric')];for(const m of metrics){const label=m.querySelector('span');if(label?.textContent==='مطلوب تحصيله الآن')label.textContent='مطلوب حاليًا · إجمالي';if(label?.textContent==='شغل لم يحن دفعه')label.textContent='داخل باقات مفتوحة الآن'}
 }catch(e){console.error(e)}
}

function dedupeActivity(){for(const root of document.querySelectorAll('.activity-list')){let prev='';for(const row of root.querySelectorAll('.activity-row')){const key=row.textContent.replace(/\s+/g,' ').trim();if(key&&key===prev)row.style.display='none';else{row.style.display='';prev=key}}}}

const ob=new MutationObserver(()=>{patchProfile();patchReview();patchReportExtras();dedupeActivity()});ob.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open','class']});
document.addEventListener('change',e=>{if(e.target?.id==='v6ReportMonth')setTimeout(patchReportExtras,80)});
setInterval(()=>{patchProfile();patchReview();patchReportExtras();dedupeActivity()},1300);
