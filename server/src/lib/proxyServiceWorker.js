/**
 * Minimal service worker (Ultraviolet-inspired) for root-absolute paths (/s/, /yt/) that bypass HTML rewrite.
 * Registered from injected runtime; session id passed in query string.
 */

/**
 * @param {{ gatewayOrigin: string; sessionId: string; pageOrigin: string }} cfg
 */
function buildServiceWorkerSource(cfg) {
  const { gatewayOrigin, sessionId, pageOrigin } = cfg;
  const G = JSON.stringify((gatewayOrigin || "").replace(/\/$/, ""));
  const S = JSON.stringify(sessionId);
  const O = JSON.stringify(pageOrigin || "https://www.youtube.com");
  const SITE = JSON.stringify(`/api/proxy/site/${sessionId}`);

  return `/* openrelay proxy sw */
const G=${G},S=${S},O=${O},SITE=${SITE},RES="/api/proxy/resource?session="+encodeURIComponent(S)+"&url=";
const ROOT_PATHS=/^(\\/s\\/|\\/yt\\/|\\/embed\\/|\\/iframe_api|\\/sw\\.js|\\/s\\?)/i;
const SKIP=/^(\\/api\\/unblock|\\/_next\\/|\\/favicon\\.ico|\\/$)/i;

function absFromPath(path,search){try{return new URL(path+(search||""),O).href}catch(e){return null}}

function toProxy(url){try{const u=new URL(url,G||self.location.origin);if(u.pathname.startsWith(SITE))return url;if(u.pathname.startsWith("/api/proxy/resource"))return url;if(ROOT_PATHS.test(u.pathname)){const t=absFromPath(u.pathname,u.search);if(t)return G+SITE+u.pathname+u.search}if(u.origin===(G?new URL(G).origin:self.location.origin)&&!SKIP.test(u.pathname)&&!u.pathname.startsWith("/api/")){const t=absFromPath(u.pathname,u.search);if(t)return G+SITE+u.pathname+u.search}if(/^https?:/i.test(url))return G+RES+encodeURIComponent(url);return url}catch(e){return url}}

self.addEventListener("install",(e)=>{self.skipWaiting()});
self.addEventListener("activate",(e)=>{e.waitUntil(self.clients.claim())});
self.addEventListener("fetch",(e)=>{
  const req=e.request;
  if(req.method!=="GET"&&req.method!=="HEAD")return;
  const url=req.url;
  if(!ROOT_PATHS.test(new URL(url).pathname)&&!url.includes(self.location.host))return;
  const proxied=toProxy(url);
  if(proxied===url)return;
  e.respondWith(fetch(proxied,{method:req.method,headers:req.headers,credentials:"include",mode:"cors",redirect:"follow"}));
});
`;
}

module.exports = { buildServiceWorkerSource };
