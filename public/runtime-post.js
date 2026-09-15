(()=>{
  const $=s=>document.querySelector(s);
  let sessionsCache=null,sessionsAt=0,opening=false;
  const validTime=t=>/^\d{2}:\d{2}$/.test(String(t||'').slice(0,5))?String(t).slice(0,5):'';
  const set=(f,name,value)=>{const el=f?.querySelector(`[name="${name}"]`);if(el)el.value=value??''};
  const toast=(message,bad=false)=>{const t=$('#toast'),text=$('#toastText');if(!t||!text)return;clearTimeout(window.__runtimeToastTimer);text.textContent=message;t.classList.toggle('bad',bad);t.classList.add('show');window.__runtimeToastTimer=setTimeout(()=>t.classList.remove('show'),3200)};

  async function sessions(){
    if(sessionsCache&&Date.now()-sessionsAt<5000)return sessionsCache;
    const r=await fetch('/api/v3/sessions',{credentials:'same-origin'}),d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||'تعذر تحميل بيانات الحصة');
    sessionsCache=d.sessions||[];sessionsAt=Date.now();return sessionsCache;
  }

  function closeOtherDialogs(except){
    document.querySelectorAll('dialog[open]').forEach(d=>{if(d!==except){try{d.close()}catch{d.removeAttribute('open')}}});
  }

  async function openEditor(id,button){
    if(opening)return;opening=true;if(button)button.disabled=true;
    try{
      const rows=await sessions(),s=rows.find(x=>String(x.id)===String(id));
      if(!s)throw new Error('تعذر العثور على الموعد. أعيدي تحميل الصفحة.');
      const dialog=$('#sessionDialog'),f=$('#sessionForm');if(!dialog||!f)throw new Error('تعذر فتح شاشة التعديل.');
      closeOtherDialogs(dialog);
      f.reset();
      set(f,'id',s.id);set(f,'student_id',s.student_id||'');set(f,'title',s.title||s.student_name||'');set(f,'session_type',s.session_type||'private_student_home');set(f,'weekday',Number(s.weekday||0));set(f,'start_time',validTime(s.start_time));set(f,'price',(Number(s.price_pence||0)/100).toFixed(2));set(f,'duration_minutes',Number(s.duration_minutes||60));set(f,'travel_minutes',Number(s.travel_minutes||0));set(f,'student_count',Number(s.student_count||1));set(f,'center_cut_percent',Number(s.center_cut_percent||0));set(f,'price_basis',s.price_basis||'total_session');set(f,'location',s.location||'');
      $('#sessionDialogTitle').textContent='تعديل الحصة';$('#stopSessionBtn')?.classList.remove('hidden');$('#sessionEditHint')?.classList.remove('hidden');

      const mode=$('#v6BillingMode');if(mode){mode.value=s.billing_mode||'per_session';const size=f.querySelector('[name="package_size"]'),pkg=f.querySelector('[name="package_price"]');if(size)size.value=s.package_size||8;if(pkg)pkg.value=s.package_price_pence?String(Number(s.package_price_pence)/100):'';mode.dispatchEvent(new Event('change',{bubbles:true}))}

      if(!dialog.open){try{dialog.showModal()}catch{dialog.setAttribute('open','')}}
      requestAnimationFrame(()=>{dialog.scrollTop=0;f.scrollTop=0});
    }catch(err){console.error(err);toast(err.message||'تعذر فتح شاشة التعديل',true)}finally{opening=false;if(button)button.disabled=false}
  }

  // Capture before the legacy button listener. This removes the iOS modal freeze
  // path while preserving the same form and submit logic already used by the app.
  document.addEventListener('click',e=>{
    const b=e.target.closest('#scheduleList [data-edit-session]');if(!b)return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    openEditor(b.dataset.editSession,b);
  },true);

  document.addEventListener('submit',e=>{if(e.target?.id==='sessionForm'){sessionsCache=null;sessionsAt=0;window.__sozanClearCoreCache?.()}},true);
})();
