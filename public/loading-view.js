(()=>{
 const style=document.createElement('style');style.textContent=`
 #initialLoading{position:fixed;inset:0;z-index:1000;background:#f8f6fa;display:grid;place-items:center;padding:24px;transition:opacity .2s ease}.initial-loading-card{width:min(360px,100%);background:#fff;border:1px solid #ebe6ee;border-radius:24px;padding:22px;text-align:center;box-shadow:0 12px 32px rgba(69,53,84,.07)}.initial-loading-logo{width:48px;height:48px;border-radius:16px;background:#eee7f6;color:#624486;display:grid;place-items:center;margin:0 auto 13px;font-size:22px;font-weight:900}.initial-loading-card strong{display:block;font-size:16px}.initial-loading-card p{margin:6px 0 14px;color:#837b8d;font-size:11px;line-height:1.6}.loading-lines{display:grid;gap:7px}.loading-lines i{display:block;height:9px;border-radius:999px;background:linear-gradient(90deg,#f1edf4,#e6dced,#f1edf4);background-size:200% 100%;animation:sozanLoad 1.15s linear infinite}.loading-lines i:nth-child(2){width:78%}.loading-lines i:nth-child(3){width:56%}@keyframes sozanLoad{to{background-position:-200% 0}}#initialLoading.loading-slow p:after{content:' الاتصال أبطأ من المعتاد، لكن البرنامج ما زال يحاول.'}#initialLoading.loading-done{opacity:0;pointer-events:none}
 `;document.head.appendChild(style);
 const overlay=document.createElement('div');overlay.id='initialLoading';overlay.setAttribute('role','status');overlay.setAttribute('aria-live','polite');overlay.innerHTML='<div class="initial-loading-card"><div class="initial-loading-logo">س</div><strong>بنجهز بياناتك…</strong><p>بنحمّل الجدول والحسابات وآخر الحركات.</p><div class="loading-lines"><i></i><i></i><i></i></div></div>';document.body.appendChild(overlay);
 let hidden=false;
 const visible=el=>el&&!el.classList.contains('hidden');
 const hasContent=id=>{const el=document.getElementById(id);return !!el&&el.children.length>0};
 const finish=()=>{if(hidden)return;hidden=true;overlay.classList.add('loading-done');setTimeout(()=>overlay.remove(),230)};
 const check=()=>{if(hidden)return;const login=document.getElementById('loginView'),app=document.getElementById('appView');if(visible(login)){finish();return}if(visible(app)&&hasContent('todaySessions')&&hasContent('scheduleList')&&hasContent('studentCollectionList')&&hasContent('reviewList'))finish()};
 new MutationObserver(check).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
 setTimeout(check,50);setTimeout(()=>overlay.classList.add('loading-slow'),6500);setTimeout(()=>{if(!hidden&&visible(document.getElementById('appView')))finish()},15000);
})();
