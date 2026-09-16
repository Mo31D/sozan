const CACHE='sozan-v6-4-package-progress';
const STATIC=['/','/index.html','/styles.css','/app.js','/schedule-view.js','/v6-extra.js','/availability-v2.js','/package-progress-v7.js','/runtime-pre.js','/runtime-post.js','/manifest.webmanifest','/icon.svg'];

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(STATIC)));
});

self.addEventListener('activate',event=>{
  event.waitUntil(Promise.all([
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),
    self.clients.claim()
  ]));
});

self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(url.origin!==self.location.origin||url.pathname.startsWith('/api/')||request.method!=='GET')return;

  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const cached=await cache.match(request,{ignoreSearch:false});
    const refresh=fetch(request,{cache:'no-store'}).then(response=>{
      if(response&&response.ok)event.waitUntil(cache.put(request,response.clone()));
      return response;
    });

    if(cached){
      event.waitUntil(refresh.catch(()=>{}));
      return cached;
    }

    try{return await refresh}catch{
      if(request.mode==='navigate')return (await cache.match('/index.html'))||(await cache.match('/'));
      return Response.error();
    }
  })());
});
