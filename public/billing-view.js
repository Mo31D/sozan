const bq=s=>document.querySelector(s);
let billingSessions=[],billingTimer=null;
const bMoney=p=>`${(Number(p||0)/100).toLocaleString('ar-EG',{maximumFractionDigits:2})} ج`;
const bLocalDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

function injectBillingStyles(){if(document.getElementById('billingViewStyles'))return;const s=document.createElement('style');s.id='billingViewStyles';s.textContent=`
.billing-method{background:#f8f5fa;border:1px solid var(--line);border-radius:14px;padding:10px}.billing-method select{margin-top:5px}.billing-hint{font-size:10px;color:var(--muted);line-height:1.6;margin-top:5px}.billing-hint.monthly{color:var(--accent2)}.monthly-session{box-shadow:inset -3px 0 0 #b9a6cb}.monthly-badge{display:inline-block;background:var(--lav);color:var(--accent2);border-radius:999px;padding:2px 6px;font-size:9px;font-weight:900;margin-right:4px}
`;document.head.appendChild(s)}

function ensureBillingControl(){
 const form=bq('#sessionForm');if(!form||bq('#billingMethod'))return;injectBillingStyles();
 const priceInput=form.querySelector('[name="price"]'),priceLabel=priceInput?.closest('label');if(!priceInput||!priceLabel)return;
 const box=document.createElement('label');box.className='billing-method';box.innerHTML=`طريقة الحساب<select name="price_type" id="billingMethod"><option value="per_session">بالحصة</option><option value="monthly">بالشهر</option></select><input type="hidden" name="billing_day" value="1"><span id="billingHint" class="billing-hint">كل حصة مكتملة تتحسب لوحدها.</span>`;
 priceLabel.parentNode.insertBefore(box,priceLabel);
 const label=document.createElement('span');label.id='billingPriceLabel';label.textContent='سعر الحصة';const text=[...priceLabel.childNodes].find(n=>n.nodeType===Node.TEXT_NODE);if(text)text.nodeValue='';priceLabel.insertBefore(label,priceInput);
 bq('#billingMethod').addEventListener('change',syncBillingPriceUi);syncBillingPriceUi();
}
function syncBillingPriceUi(){const monthly=bq('#billingMethod')?.value==='monthly',label=bq('#billingPriceLabel'),hint=bq('#billingHint');if(label)label.textContent=monthly?'قيمة الشهر':'سعر الحصة';if(hint){hint.textContent=monthly?'المبلغ يتحسب مرة واحدة للشهر كله، والحصص تسجل حضور فقط.':'كل حصة مكتملة تتحسب لوحدها.';hint.classList.toggle('monthly',monthly)}}

async function loadBillingSessions(){try{const r=await fetch('/api/v3/sessions',{credentials:'same-origin'});if(r.ok){const d=await r.json();billingSessions=d.sessions||[];decorateScheduleLists()}}catch{}}
function scheduleById(id){return billingSessions.find(x=>String(x.id)===String(id))}

function bindSessionForm(){
 ensureBillingControl();
 document.addEventListener('click',e=>{
  const add=e.target.closest('#addSessionBtn');if(add)setTimeout(()=>{ensureBillingControl();if(bq('#billingMethod'))bq('#billingMethod').value='per_session';syncBillingPriceUi()},20);
  const edit=e.target.closest('[data-edit-session],[data-open-session]');if(edit){const id=edit.dataset.editSession||edit.dataset.openSession;setTimeout(async()=>{ensureBillingControl();if(!billingSessions.length)await loadBillingSessions();const s=scheduleById(id);if(s&&bq('#billingMethod')){bq('#billingMethod').value=s.price_type||'per_session';syncBillingPriceUi()}},40)}
 });
 bq('#sessionForm')?.addEventListener('submit',()=>setTimeout(loadBillingSessions,900));
}

async function decorateToday(){
 const root=bq('#todaySessions');if(!root||!root.children.length)return;
 try{const r=await fetch(`/api/v4/dashboard?date=${bLocalDate()}`,{credentials:'same-origin'});if(!r.ok)return;const d=await r.json(),map=new Map((d.sessions||[]).map(x=>[String(x.id),x]));
 root.querySelectorAll('.session-card').forEach(card=>{const id=card.querySelector('[data-more-session]')?.dataset.moreSession||card.querySelector('[data-action]')?.dataset.id,row=map.get(String(id));if(!row||row.price_type!=='monthly')return;card.classList.add('monthly-session');const amount=card.querySelector('.amount-pill');if(amount)amount.textContent='اشتراك شهري';const meta=card.querySelector('.session-meta');if(meta&&!meta.querySelector('.monthly-badge'))meta.insertAdjacentHTML('beforeend',' <span class="monthly-badge">شهري</span>');const primary=card.querySelector('[data-action="complete-paid"]');if(primary)primary.textContent='✓ تمت';const status=card.querySelector('.session-status-row>span');if(status&&row.status==='completed')status.textContent=Number(row.monthly_outstanding_pence||0)>0?`تمت · باقي من الشهر ${bMoney(row.monthly_outstanding_pence)}`:'تمت · اشتراك الشهر مسدد';});
 }catch{}
}

function decorateScheduleLists(){
 document.querySelectorAll('[data-edit-session]').forEach(btn=>{const s=scheduleById(btn.dataset.editSession),card=btn.closest('.schedule-card');if(!s||!card)return;const pill=card.querySelector('.amount-pill'),meta=card.querySelector('.schedule-meta');if(s.price_type==='monthly'){if(pill)pill.textContent=`شهري ${bMoney(s.price_pence)}`;if(meta&&!meta.textContent.includes('شهري'))meta.textContent+=` · شهري`;}});
 document.querySelectorAll('[data-open-session]').forEach(btn=>{const s=scheduleById(btn.dataset.openSession);if(!s||s.price_type!=='monthly')return;const small=btn.querySelector('.week-session-main small');if(small&&!small.textContent.includes('شهري'))small.textContent+=' · شهري';});
}

function observeBillingUi(){const today=bq('#todaySessions'),schedule=bq('#scheduleList'),visual=bq('#scheduleVisualHost');const run=()=>{clearTimeout(billingTimer);billingTimer=setTimeout(()=>{decorateToday();decorateScheduleLists()},120)};const o=new MutationObserver(run);if(today)o.observe(today,{childList:true,subtree:true});if(schedule)o.observe(schedule,{childList:true,subtree:true});if(visual)o.observe(visual,{childList:true,subtree:true});}

function bootBilling(){injectBillingStyles();ensureBillingControl();bindSessionForm();loadBillingSessions();observeBillingUi();setTimeout(decorateToday,300)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootBilling);else bootBilling();
