const CACHE = 'doctorhouse-pwa-v4';
const OFFLINE = '/offline.html';
const ASSETS = [OFFLINE,'/assets/icon-192.png','/assets/icon-512.png','/assets/icon-maskable.png','/assets/apple-touch-icon.png'];
self.addEventListener('install',event => event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event => event.waitUntil((async()=>{
  for(const name of await caches.keys()) if(name.startsWith('doctorhouse-pwa-') && name!==CACHE) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{
  if(event.data?.type==='ACTIVATE_UPDATE') self.skipWaiting();
  if(event.data?.type==='CLEAR_NOTIFICATIONS') event.waitUntil(self.registration.getNotifications().then(items=>items.forEach(item=>item.close())));
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET' || url.origin!==self.location.origin || url.pathname.startsWith('/api/')) return;
  // Never cache authenticated responses, task data or HTML containing sessions.
  if(event.request.mode==='navigate') {
    event.respondWith(fetch(event.request).catch(()=>caches.match(OFFLINE)));
  } else if(ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then(hit=>hit || fetch(event.request)));
  }
});
self.addEventListener('push',event=>{
  let payload={};
  try { payload=event.data?.json() || {}; } catch {}
  let url=new URL('/',self.location.origin);
  try { url=new URL(payload.url || '/',self.location.origin); } catch {}
  const destination=url.origin===self.location.origin ? url.pathname+url.search : '/';
  event.waitUntil(self.registration.showNotification(payload.title || 'Doctor House',{
    body:payload.body || 'Há uma atualização nas suas tarefas.',icon:'/assets/icon-192.png',badge:'/assets/icon-192.png',
    tag:payload.tag || 'doctorhouse',data:{url:destination}
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const destination=new URL(event.notification.data?.url || '/',self.location.origin);
    if(destination.origin!==self.location.origin) return;
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const client=windows.find(item=>new URL(item.url).origin===self.location.origin);
    if(client) { await client.focus(); client.postMessage({type:'OPEN_TASK',url:destination.pathname+destination.search}); }
    else await self.clients.openWindow(destination.href);
  })());
});
