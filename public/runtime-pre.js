(()=>{
  const nativeFetch=window.fetch.bind(window);
  const cache=new Map();
  const TTL=6000;
  let settingsPrimed=false;

  const corePath=p=>p==='/api/v3/settings'||p==='/api/v3/sessions'||p==='/api/v4/students/summary'||p==='/api/v4/dashboard'||p==='/api/v3/dashboard'||p==='/api/v3/today';
  const snap=async response=>({status:response.status,statusText:response.statusText,headers:[...response.headers.entries()],body:await response.text()});
  const revive=s=>new Response(s.body,{status:s.status,statusText:s.statusText,headers:s.headers});
  const clear=()=>cache.clear();

  window.fetch=async(input,init={})=>{
    const method=String(init?.method||(typeof input!=='string'&&input?.method)||'GET').toUpperCase();
    let url;try{url=new URL(typeof input==='string'?input:input?.url||'',location.href)}catch{return nativeFetch(input,init)}
    if(url.origin!==location.origin)return nativeFetch(input,init);

    if(method!=='GET'&&method!=='HEAD'){
      clear();
      return nativeFetch(input,init);
    }
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

  // The V6 UI modules used broad body observers. On iOS a dialog open could cause
  // a feedback loop: callback changes text/classes -> observer fires again -> repeat.
  // Keep those observers useful for dialog open/close, but prevent self-triggering
  // class/child mutations across the whole document.
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
