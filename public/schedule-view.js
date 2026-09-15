const typeLabels={private_student_home:'خاص عند الطالب',private_sozan_home:'خاص عند سوزان',online:'أونلاين',center_group:'السنتر',own_group:'مجموعة خاصة'};
const dayNames=['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const typeClass={private_student_home:'type-home',private_sozan_home:'type-sozan',online:'type-online',center_group:'type-center',own_group:'type-group'};
let currentMode='week';
let monthCursor=new Date();
let plannerStart='09:00',plannerEnd='21:00';

const $q=s=>document.querySelector(s);
const escHtml=s=>String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
const localKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const fmtTime=t=>t?String(t).slice(0,5):'الوقت غير محدد';
const sortSessions=rows=>[...rows].sort((a,b)=>String(a.start_time||'99:99').localeCompare(String(b.start_time||'99:99'))||String(a.title).localeCompare(String(b.title),'ar'));
const orderedDays=()=>{const today=new Date().getDay();return Array.from({length:7},(_,i)=>(today+i)%7)};
const timeToMin=t=>{if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(t||'')))return null;const[h,m]=String(t).split(':').map(Number);return h*60+m};
const minToTime=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;

function injectStyles(){
 if(document.getElementById('scheduleEnhanceStyles'))return;
 const style=document.createElement('style');style.id='scheduleEnhanceStyles';style.textContent=`
 .schedule-view-switch{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;background:#f1edf4;border:1px solid var(--line);padding:4px;border-radius:14px;margin:10px 0 12px}.schedule-view-switch button{border:0;background:transparent;color:var(--muted);padding:9px 5px;border-radius:10px;font-size:10px;font-weight:900}.schedule-view-switch button.active{background:#fff;color:var(--accent2);box-shadow:0 3px 10px rgba(70,52,87,.07)}
 .schedule-mode-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:12px 1px 9px}.schedule-mode-head strong{font-size:13px}.schedule-mode-head small{display:block;color:var(--muted);font-size:10px;margin-top:2px}.schedule-nav{display:flex;gap:5px}.schedule-nav button{border:1px solid var(--line);background:#fff;color:var(--accent2);border-radius:10px;padding:7px 9px;font-size:10px;font-weight:900}
 .week-board,.free-board{display:grid;gap:11px}.week-day,.free-day{border:1px solid var(--line);border-radius:18px;overflow:hidden;background:#fff}.week-day.alt,.free-day.alt{background:#f7f5f8}.week-day.today,.free-day.today{border-color:#d7c4e7;box-shadow:0 7px 22px rgba(69,53,84,.05)}.week-day-head{display:flex;align-items:center;justify-content:space-between;padding:11px 12px;background:rgba(255,255,255,.62)}.week-day.alt .week-day-head,.free-day.alt .week-day-head{background:#f1eef3}.week-day.today .week-day-head,.free-day.today .week-day-head{background:var(--lav)}.week-day-head strong{font-size:13px}.week-day-head span{font-size:9px;color:var(--muted)}.week-day-body{display:grid}.week-session{display:flex;align-items:center;gap:9px;padding:10px 12px;border-top:1px solid #efebf1;text-align:right;background:transparent;color:inherit;width:100%;border-left:0;border-right:0;border-bottom:0}.week-session:first-child{border-top:0}.week-accent{width:4px;align-self:stretch;min-height:34px;border-radius:999px;background:#b9a6cb}.week-session.type-online .week-accent{background:#69a7c4}.week-session.type-center .week-accent{background:#d39a62}.week-session.type-group .week-accent{background:#8b78b6}.week-session.type-home .week-accent{background:#74a984}.week-session.type-sozan .week-accent{background:#b47b96}.week-session-main{flex:1;min-width:0}.week-session-main strong,.week-session-main small{display:block}.week-session-main strong{font-size:12px}.week-session-main small{font-size:9px;color:var(--muted);margin-top:3px}.week-session-time{font-size:10px;font-weight:900;color:var(--accent2);white-space:nowrap}.unknown-time{color:var(--warn)}.week-empty{padding:11px 12px;color:var(--muted);font-size:10px}
 .schedule-legend{display:flex;flex-wrap:wrap;gap:7px;margin:7px 1px 11px}.schedule-legend span{font-size:9px;color:var(--muted);display:flex;align-items:center;gap:4px}.schedule-legend i{width:7px;height:7px;border-radius:50%;display:inline-block}
 .month-weekdays,.month-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}.month-weekdays{margin:3px 0 5px}.month-weekdays span{text-align:center;color:var(--muted);font-size:9px;font-weight:800}.month-cell{min-height:72px;border:1px solid var(--line);background:#fff;border-radius:12px;padding:7px 6px;text-align:right;color:inherit;position:relative}.month-cell.outside{opacity:.35}.month-cell.today{border-color:#cbb6df;background:#faf6fd}.month-cell.selected{box-shadow:0 0 0 2px var(--lav2) inset}.month-number{font-size:11px;font-weight:900}.month-count{margin-top:12px;font-size:9px;color:var(--accent2);font-weight:900}.month-dots{display:flex;gap:3px;margin-top:5px;flex-wrap:wrap}.month-dot{width:5px;height:5px;border-radius:50%;background:#b9a6cb}.month-dot.type-online{background:#69a7c4}.month-dot.type-center{background:#d39a62}.month-dot.type-group{background:#8b78b6}.month-dot.type-home{background:#74a984}.month-dot.type-sozan{background:#b47b96}.month-detail{margin-top:10px}.month-detail-title{margin:0 1px 7px;font-size:12px;font-weight:900}.month-detail .week-session{border:1px solid var(--line);border-radius:13px;margin-bottom:6px}
 .planner-controls{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0 10px}.planner-controls label{font-size:10px}.planner-note{font-size:10px;color:var(--muted);line-height:1.6;margin:0 1px 10px}.free-list{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px}.free-slot{border:1px solid #cfe1d6;background:#edf6f0;color:#47745a;border-radius:999px;padding:7px 9px;font-size:10px;font-weight:900}.free-slot small{font-size:8px;font-weight:700;opacity:.8}.free-warning{padding:0 12px 10px;color:var(--warn);font-size:9px}.free-none{padding:10px 12px;color:var(--muted);font-size:10px}
 @media(max-width:480px){.month-cell{min-height:62px;padding:6px 4px}.month-count{margin-top:8px;font-size:8px}.month-weekdays span{font-size:8px}.schedule-view-switch button{font-size:9px;padding:8px 2px}}
 `;document.head.appendChild(style);
}

function ensureUi(){
 const list=$q('#scheduleList');if(!list||$q('#scheduleViewSwitch'))return;
 injectStyles();
 const switcher=document.createElement('div');switcher.id='scheduleViewSwitch';switcher.className='schedule-view-switch';switcher.innerHTML='<button data-smode="week" class="active">أسبوع</button><button data-smode="month">شهر</button><button data-smode="free">أوقات فاضية</button><button data-smode="manage">إدارة</button>';
 const host=document.createElement('div');host.id='scheduleVisualHost';
 list.parentNode.insertBefore(switcher,list);
 list.parentNode.insertBefore(host,list);
 switcher.addEventListener('click',e=>{const b=e.target.closest('[data-smode]');if(!b)return;setMode(b.dataset.smode)});
}

async function fetchSessions(){
 const res=await fetch('/api/v3/sessions',{credentials:'same-origin'});if(!res.ok)throw new Error('تعذر تحميل الجدول');const data=await res.json();return data.sessions||[];
}

async function setMode(mode){
 currentMode=mode;ensureUi();document.querySelectorAll('[data-smode]').forEach(b=>b.classList.toggle('active',b.dataset.smode===mode));
 const list=$q('#scheduleList'),host=$q('#scheduleVisualHost');
 if(mode==='manage'){host.innerHTML='';host.classList.add('hidden');list.classList.remove('hidden');return}
 list.classList.add('hidden');host.classList.remove('hidden');host.innerHTML='<div class="empty">جاري ترتيب الجدول...</div>';
 try{const rows=await fetchSessions();if(mode==='week')renderWeek(rows,host);else if(mode==='month')renderMonth(rows,host);else renderFree(rows,host)}catch(err){host.innerHTML=`<div class="empty">${escHtml(err.message)}</div>`}
}

function sessionRow(s){const cls=typeClass[s.session_type]||'';return `<button class="week-session ${cls}" data-open-session="${s.id}"><span class="week-accent"></span><span class="week-session-main"><strong>${escHtml(s.title)}</strong><small>${escHtml(typeLabels[s.session_type]||'حصة')}${Number(s.price_pence||0)>0?` · ${(Number(s.price_pence)/100).toLocaleString('ar-EG',{maximumFractionDigits:2})} ج`:''}</small></span><span class="week-session-time ${s.start_time?'':'unknown-time'}">${escHtml(fmtTime(s.start_time))}</span></button>`}

function bindSessionOpen(root){root.querySelectorAll('[data-open-session]').forEach(b=>b.addEventListener('click',()=>{const id=b.dataset.openSession;setMode('manage');setTimeout(()=>{const edit=document.querySelector(`[data-edit-session="${id}"]`);edit?.click()},30)}))}

function renderWeek(rows,host){
 const today=new Date().getDay(),days=orderedDays();let html='<div class="schedule-mode-head"><div><strong>الأسبوع من النهارده</strong><small>الجدول يبدأ بيومك الحالي ثم الأيام اللي بعده</small></div></div><div class="schedule-legend"><span><i style="background:#74a984"></i>عند الطالب</span><span><i style="background:#b47b96"></i>عند سوزان</span><span><i style="background:#69a7c4"></i>أونلاين</span><span><i style="background:#d39a62"></i>السنتر</span><span><i style="background:#8b78b6"></i>مجموعة</span></div><div class="week-board">';
 days.forEach((day,index)=>{const items=sortSessions(rows.filter(s=>Number(s.weekday)===day));html+=`<section class="week-day ${index%2?'alt':''} ${day===today?'today':''}"><div class="week-day-head"><strong>${dayNames[day]}${day===today?' · النهارده':''}</strong><span>${items.length?`${items.length} ${items.length===1?'حصة':'حصص'}`:'فاضي'}</span></div><div class="week-day-body">${items.length?items.map(sessionRow).join(''):'<div class="week-empty">مفيش حصص</div>'}</div></section>`});
 host.innerHTML=html+'</div>';bindSessionOpen(host);
}

function monthSessionsForDate(rows,date){return sortSessions(rows.filter(s=>Number(s.weekday)===date.getDay()))}
function renderMonth(rows,host,selectedKey=null){
 const y=monthCursor.getFullYear(),m=monthCursor.getMonth(),first=new Date(y,m,1),gridStart=new Date(y,m,1-first.getDay()),todayKey=localKey(new Date()),selected=selectedKey||((new Date().getMonth()===m&&new Date().getFullYear()===y)?todayKey:localKey(first));
 const monthLabel=new Intl.DateTimeFormat('ar-EG',{month:'long',year:'numeric'}).format(first);
 let html=`<div class="schedule-mode-head"><div><strong>${monthLabel}</strong><small>العدد داخل كل يوم هو عدد الحصص المتوقعة</small></div><div class="schedule-nav"><button id="monthPrev">‹</button><button id="monthToday">الشهر الحالي</button><button id="monthNext">›</button></div></div><div class="month-weekdays">${dayNames.map(x=>`<span>${x.slice(0,3)}</span>`).join('')}</div><div class="month-grid">`;
 for(let i=0;i<42;i++){const d=new Date(gridStart);d.setDate(gridStart.getDate()+i);const key=localKey(d),items=monthSessionsForDate(rows,d),outside=d.getMonth()!==m;html+=`<button class="month-cell ${outside?'outside':''} ${key===todayKey?'today':''} ${key===selected?'selected':''}" data-month-day="${key}"><span class="month-number">${d.getDate()}</span>${items.length?`<div class="month-count">${items.length} ${items.length===1?'حصة':'حصص'}</div><div class="month-dots">${items.slice(0,5).map(s=>`<i class="month-dot ${typeClass[s.session_type]||''}"></i>`).join('')}</div>`:''}</button>`}
 html+='</div><div id="monthDetail" class="month-detail"></div>';host.innerHTML=html;
 const showDetail=key=>{const parts=key.split('-').map(Number),d=new Date(parts[0],parts[1]-1,parts[2]),items=monthSessionsForDate(rows,d),detail=$q('#monthDetail');const label=new Intl.DateTimeFormat('ar-EG',{weekday:'long',day:'numeric',month:'long'}).format(d);detail.innerHTML=`<div class="month-detail-title">${label}</div>${items.length?items.map(sessionRow).join(''):'<div class="empty">مفيش حصص في اليوم ده.</div>'}`;bindSessionOpen(detail);host.querySelectorAll('[data-month-day]').forEach(b=>b.classList.toggle('selected',b.dataset.monthDay===key))};
 showDetail(selected);
 host.querySelectorAll('[data-month-day]').forEach(b=>b.addEventListener('click',()=>showDetail(b.dataset.monthDay)));
 $q('#monthPrev').onclick=()=>{monthCursor=new Date(y,m-1,1);renderMonth(rows,host)};
 $q('#monthNext').onclick=()=>{monthCursor=new Date(y,m+1,1);renderMonth(rows,host)};
 $q('#monthToday').onclick=()=>{monthCursor=new Date();renderMonth(rows,host,todayKey)};
}

function computeFreeSlots(rows,day,startMin,endMin){
 const dayRows=rows.filter(s=>Number(s.weekday)===day),unknown=dayRows.filter(s=>timeToMin(s.start_time)===null),busy=dayRows.map(s=>{const start=timeToMin(s.start_time);if(start===null)return null;const duration=Math.max(15,Number(s.duration_minutes||60));return{start,end:start+duration}}).filter(Boolean).sort((a,b)=>a.start-b.start);
 const merged=[];for(const b of busy){const start=Math.max(startMin,b.start),end=Math.min(endMin,b.end);if(end<=startMin||start>=endMin)continue;const last=merged[merged.length-1];if(last&&start<=last.end)last.end=Math.max(last.end,end);else merged.push({start,end})}
 const free=[];let cursor=startMin;for(const b of merged){if(b.start-cursor>=30)free.push({start:cursor,end:b.start});cursor=Math.max(cursor,b.end)}if(endMin-cursor>=30)free.push({start:cursor,end:endMin});return{free,unknown:unknown.length};
}

function openAddAt(day,start){
 $q('#addSessionBtn')?.click();setTimeout(()=>{const form=$q('#sessionForm');if(!form)return;const dayField=form.querySelector('[name="weekday"]'),timeField=form.querySelector('[name="start_time"]');if(dayField)dayField.value=String(day);if(timeField)timeField.value=minToTime(start)},20);
}

function renderFree(rows,host){
 const startMin=timeToMin(plannerStart)??540,endMin=timeToMin(plannerEnd)??1260,today=new Date().getDay(),days=orderedDays();
 if(endMin<=startMin){host.innerHTML='<div class="empty">وقت النهاية لازم يكون بعد وقت البداية.</div>';return}
 let html=`<div class="schedule-mode-head"><div><strong>الأوقات الفاضية</strong><small>اضغطي على أي فترة لبدء إضافة حصة في نفس اليوم والوقت</small></div></div><div class="planner-controls"><label>بداية اليوم<input id="plannerStart" type="time" value="${plannerStart}"></label><label>نهاية اليوم<input id="plannerEnd" type="time" value="${plannerEnd}"></label></div><p class="planner-note">الحساب هنا بين مواعيد الحصص فقط. لو في حصة عند الطالب ولها وقت انتقال، راعي وقت المشوار قبل اختيار الفترة.</p><div class="free-board">`;
 days.forEach((day,index)=>{const x=computeFreeSlots(rows,day,startMin,endMin);html+=`<section class="free-day ${index%2?'alt':''} ${day===today?'today':''}"><div class="week-day-head"><strong>${dayNames[day]}${day===today?' · النهارده':''}</strong><span>${x.free.length?`${x.free.length} فترات متاحة`:'مزدحم'}</span></div>${x.free.length?`<div class="free-list">${x.free.map(slot=>{const duration=slot.end-slot.start;return `<button class="free-slot" data-free-day="${day}" data-free-start="${slot.start}">${minToTime(slot.start)}–${minToTime(slot.end)} <small>${duration} د</small></button>`}).join('')}</div>`:'<div class="free-none">مفيش فترة 30 دقيقة أو أكثر داخل النطاق ده.</div>'}${x.unknown?`<div class="free-warning">في ${x.unknown} ${x.unknown===1?'حصة وقتها':'حصص وقتها'} غير محدد، لذلك مش محسوبة داخل الفراغات.</div>`:''}</section>`});
 host.innerHTML=html+'</div>';
 $q('#plannerStart').onchange=e=>{plannerStart=e.target.value;renderFree(rows,host)};$q('#plannerEnd').onchange=e=>{plannerEnd=e.target.value;renderFree(rows,host)};
 host.querySelectorAll('[data-free-day]').forEach(b=>b.addEventListener('click',()=>openAddAt(Number(b.dataset.freeDay),Number(b.dataset.freeStart))));
}

function refreshIfScheduleVisible(){if(currentMode!=='manage'&&$q('#view-schedule')?.classList.contains('active'))setMode(currentMode)}
function boot(){ensureUi();setTimeout(()=>setMode('week'),50);const scheduleBtn=document.querySelector('.nav-btn[data-view="schedule"]');scheduleBtn?.addEventListener('click',()=>setTimeout(()=>{ensureUi();setMode(currentMode)},100));document.addEventListener('click',e=>{if(e.target.closest('#sessionForm button[type="submit"],#stopSessionBtn'))setTimeout(refreshIfScheduleVisible,900)});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
