(()=>{
  const nativeFetch=window.fetch.bind(window);
  const nativeSetInterval=window.setInterval.bind(window);
  const cache=new Map();
  const TTL=6000;
  const activeViews=new Set(['today']);
  const maintenance=[];
  let settingsPrimed=false;

  const corePath=p=>p==='/api/v3/settings'||p==='/api/v3/sessions'||p==='/api/v4/students/summary'||p==='/api/v4/dashboard'||p==='/api/v3/dashboard'||p==='/api/v3/today'||p==='/api/v6/schedule-range';
  const snap=async response=>({status:response.status,statusText:response.statusText,headers:[...response.headers.entries()],body:await response.text()});
  const revive=s=>new Response(s.body,{status:s.status,statusText:s.statusText,headers:s.headers});
  const jsonResponse=data=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json; charset=utf-8','x-sozan-deferred':'1'}});
  const clear=()=>cache.clear();

  function deferred(url){
    const p=url.pathname;
    if(!activeViews.has('schedule')){
      if(p==='/api/v3/sessions')return {sessions:[]};
      if(p==='/api/v6/schedule-range')return {start:url.searchParams.get('start'),end:url.searchParams.get('end'),items:[]};
    }
    if(!activeViews.has('money')){
      if(p==='/api/v3/outstanding')return {items:[],total_outstanding_pence:0};
      if(p==='/api/v4/activity'&&url.searchParams.get('limit')==='5')return {events:[]};
    }
    if(!activeViews.has('me')){
      if(p==='/api/v3/insights')return {insights:[],deferred:true};
      if(p==='/api/v3/cash-check')return {expected_balance_pence:0,last_check:null,deferred:true};
      if(p==='/api/v4/review')return {items:[],all_good:true,deferred:true};
    }
    return null;
  }

  window.fetch=async(input,init={})=>{
    const method=String(init?.method||(typeof input!=='string'&&input?.method)||'GET').toUpperCase();
    let url;try{url=new URL(typeof input==='string'?input:input?.url||'',location.href)}catch{return nativeFetch(input,init)}
    if(url.origin!==location.origin)return nativeFetch(input,init);

    if(method!=='GET'&&method!=='HEAD'){
      clear();
      return nativeFetch(input,init);
    }

    const lazy=deferred(url);
    if(lazy!==null)return jsonResponse(lazy);
    if(!corePath(url.pathname))return nativeFetch(input,init);

    if(!settingsPrimed&&['/api/v4/dashboard','/api/v3/dashboard','/api/v3/today'].includes(url.pathname)){
      settingsPrimed=true;
      queueMicrotask(()=>window.fetch('/api/v3/settings',{credentials:'same-origin'}).catch(()=>{}));
    }

    const key=`${method}:${url.pathname}${url.search}`;
    const now=Date.now(),existing=cache.get(key);
    if(existing&&now-existing.at<TTL){
      try{return revive(await existing.promise)}catch{cache.delete(key)}
    }

    const promise=(async()=>{
      const response=await nativeFetch(input,init);
      const snapshot=await snap(response);
      if(!response.ok)cache.delete(key);
      return snapshot;
    })();
    cache.set(key,{at:now,promise});
    try{return revive(await promise)}catch(err){cache.delete(key);throw err}
  };
  window.__sozanClearCoreCache=clear;

  // V6-extra used a permanent 1.3s maintenance interval. Keep the same callback,
  // but run it only after relevant user actions / dialog changes instead of forever.
  window.setInterval=(fn,delay,...args)=>{
    if(Number(delay)===1300&&typeof fn==='function'){
      maintenance.push(()=>fn(...args));
      return -1300;
    }
    return nativeSetInterval(fn,delay,...args);
  };
  const runMaintenance=()=>{for(const fn of maintenance){try{fn()}catch(e){console.error(e)}}};
  const queueMaintenance=()=>{setTimeout(runMaintenance,120);setTimeout(runMaintenance,900)};

  document.addEventListener('click',e=>{
    const nav=e.target.closest('.nav-btn[data-view]');
    if(nav){activeViews.add(nav.dataset.view);clear();queueMaintenance()}
    if(e.target.closest('[data-student],[data-schedule-student],[data-all-student],#v6OpenReports,#activityBtn,#showActivityBtn,#openActivityFromReview'))queueMaintenance();
  },true);
  document.addEventListener('change',e=>{if(e.target?.id==='v6ReportMonth')queueMaintenance()},true);

  // Broad body observers caused feedback loops on iOS. Keep only dialog open/close
  // observation; user-driven maintenance above handles profile/review/report refreshes.
  const NativeObserver=window.MutationObserver;
  window.MutationObserver=class SozanMutationObserver extends NativeObserver{
    observe(target,options={}){
      if(target===document.body&&options?.subtree&&options?.attributes&&Array.isArray(options.attributeFilter)&&options.attributeFilter.includes('open')&&options.attributeFilter.includes('class')){
        return super.observe(target,{...options,childList:false,attributeFilter:['open']});
      }
      return super.observe(target,options);
    }
  };
})();
