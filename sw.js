// Holdout service worker: content-hashed assets (?v=hash) are immutable -> cache-first from disk on repeat visits.
// The page itself is network-first so a new deploy is picked up immediately, with the cached copy as an offline fallback.
const CACHE='holdout-assets-v1';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
async function pruneOld(cache,url){for(const k of await cache.keys()){const u=new URL(k.url);if(u.pathname===url.pathname&&u.search!==url.search)cache.delete(k)}}
self.addEventListener('fetch',e=>{
  const req=e.request;if(req.method!=='GET')return;const url=new URL(req.url);if(url.origin!==location.origin)return;
  if(url.pathname.startsWith('/assets/')&&url.searchParams.has('v')){
    e.respondWith(caches.open(CACHE).then(async c=>{const hit=await c.match(req);if(hit)return hit;
      const res=await fetch(req);if(res.ok){await c.put(req,res.clone());pruneOld(c,url)}return res}));return}
  if(url.pathname==='/'||url.pathname.endsWith('.html')){
    e.respondWith(fetch(req).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy));return res}).catch(()=>caches.match(req)))}
});
