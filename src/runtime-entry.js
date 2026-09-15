import app from './final.js';

const PRE='<script src="/runtime-pre.js"></script>';
const POST='<script type="module" src="/v6-extra.js"></script><script src="/runtime-post.js"></script>';

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url),path=url.pathname;
    if(request.method==='GET'&&(path==='/'||path==='/index.html')){
      const response=await env.ASSETS.fetch(request);if(!response.ok)return response;
      let html=await response.text();
      const appMarker='<script type="module" src="/app.js"></script>';
      if(!html.includes('/runtime-pre.js'))html=html.includes(appMarker)?html.replace(appMarker,`${PRE}\n  ${appMarker}`):html.replace('</head>',`  ${PRE}\n</head>`);
      if(!html.includes('/v6-extra.js'))html=html.replace('</body>',`  ${POST}\n</body>`);
      else if(!html.includes('/runtime-post.js'))html=html.replace('</body>',`  <script src="/runtime-post.js"></script>\n</body>`);
      const headers=new Headers(response.headers);headers.set('content-type','text/html; charset=utf-8');headers.set('cache-control','no-cache');
      return new Response(html,{status:response.status,headers});
    }
    return app.fetch(request,env,ctx);
  }
};
