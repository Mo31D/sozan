import app from './v6.js';

const EXTRA='<script type="module" src="/v6-extra.js"></script>';

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html')){
      const response=await env.ASSETS.fetch(request);
      if(!response.ok)return response;
      let html=await response.text();
      if(!html.includes('/v6-extra.js'))html=html.replace('</body>',`  ${EXTRA}\n</body>`);
      const headers=new Headers(response.headers);
      headers.set('content-type','text/html; charset=utf-8');
      headers.set('cache-control','no-cache');
      return new Response(html,{status:response.status,headers});
    }
    return app.fetch(request,env,ctx);
  }
};
