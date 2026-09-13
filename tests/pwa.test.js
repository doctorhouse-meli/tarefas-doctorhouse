import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function worker() {
  const handlers={}, shown=[], opened=[], cached=[];
  const self={location:{origin:'https://tasks.example'},addEventListener:(name,fn)=>handlers[name]=fn,
    registration:{showNotification:async(...args)=>shown.push(args)},
    clients:{claim:async()=>{},matchAll:async()=>[],openWindow:async url=>opened.push(url)}};
  const caches={open:async()=>({addAll:async urls=>cached.push(...urls)}),keys:async()=>[],match:async()=>({offline:true})};
  vm.runInNewContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),{self,caches,URL,fetch:async()=>{throw Error('offline');}});
  const run=async(name,fields={})=>{let pending;handlers[name]({...fields,waitUntil:p=>pending=p,respondWith:p=>pending=p});return await pending;};
  return {run,self,shown,opened,cached};
}

test('service worker provides offline navigation without caching APIs or task data',async()=>{
  const w=worker();await w.run('install');
  assert.ok(w.cached.includes('/offline.html'));
  assert.ok(w.cached.every(url=>url==='/offline.html'||url.startsWith('/assets/')));
  assert.equal((await w.run('fetch',{request:{url:'https://tasks.example/',method:'GET',mode:'navigate'}})).offline,true);
  for(const [url,method] of [['https://tasks.example/api/pwa/session','GET'],['https://tasks.example/api/rpc/createTask','POST'],['https://other.example/','GET']]) {
    assert.equal(await w.run('fetch',{request:{url,method,mode:'navigate'}}),undefined);
  }
});

test('push displays a notification and constrains destinations to this app',async()=>{
  const w=worker();
  for(const url of ['/?task=42','https://evil.example/','http://[invalid']) {
    await w.run('push',{data:{json:()=>({title:'Nova tarefa',url})}});
  }
  assert.equal(w.shown.length,3);
  assert.equal(w.shown[0][1].data.url,'/?task=42');
  assert.equal(w.shown[1][1].data.url,'/');
  assert.equal(w.shown[2][1].data.url,'/');
  await w.run('notificationclick',{notification:{close(){},data:{url:'/?task=42'}}});
  assert.deepEqual(w.opened,['https://tasks.example/?task=42']);
  await w.run('notificationclick',{notification:{close(){},data:{url:'https://evil.example/'}}});
  assert.equal(w.opened.length,1);
});

test('notification click focuses an existing app without discarding its forms',async()=>{
  const w=worker();let focused=false,message;
  w.self.clients.matchAll=async()=>[{url:'https://tasks.example/',focus:async()=>{focused=true;},postMessage:value=>message=value}];
  await w.run('notificationclick',{notification:{close(){},data:{url:'/?task=8'}}});
  assert.equal(focused,true);assert.equal(message.type,'OPEN_TASK');assert.equal(message.url,'/?task=8');assert.equal(w.opened.length,0);
});

test('installed session validates its token, removes expired tokens and keeps transient failures recoverable',async()=>{
  const saved=new Map();let cleared=0,entered=0,status=200;
  const context=vm.createContext({URL,location:{href:'https://tasks.example/'},navigator:{},matchMedia:()=>({matches:true}),
    document:{addEventListener(){}},localStorage:{setItem:(k,v)=>saved.set(k,v),getItem:k=>saved.get(k),removeItem:k=>saved.delete(k)},
    clearSessionLogin:()=>cleared++,authToken:'',currentUser:null,enterDashboard:async()=>entered++,
    fetch:async()=>({ok:status===200,status,json:async()=>status===200?{email:'demo@example.test'}:{error:'Falha'}})});
  vm.runInContext(readFileSync(new URL('../public/pwa.js',import.meta.url),'utf8'),context);
  context.pwaSaveSession('signed-token');assert.equal(cleared,1);assert.equal(saved.size,1);
  assert.equal(await context.pwaRestoreSession(),true);assert.equal(entered,1);assert.equal(context.currentUser.email,'demo@example.test');
  status=503;assert.equal(await context.pwaRestoreSession(),false);assert.equal(saved.size,1);assert.equal(context.currentUser,null);
  status=401;assert.equal(await context.pwaRestoreSession(),false);assert.equal(saved.size,0);assert.equal(context.authToken,'');
});

test('new task still requests a system notification with push enabled',()=>{
  const calls=[];
  const context=vm.createContext({pwaPushActive:true,Notification:{permission:'granted'},window:{Notification:{}},
    formatTaskSchedule:()=> 'Hoje',pwaNotify:(...args)=>calls.push(args)});
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  vm.runInContext(source.slice(source.indexOf('  function showBrowserNotification('),source.indexOf('  function showBrowserStatusNotification(')),context);
  context.showBrowserNotification({id:'TSK-123',titulo:'Teste'});
  assert.equal(calls.length,1);
  assert.equal(calls[0][1].tag,'task-TSK-123');
  assert.equal(calls[0][1].data.url,'/?task=TSK-123');
});

test('foreground fallback uses the worker and avoids a second alert when push is already displayed',async()=>{
  let shown=[],existing=[];
  const registration={getNotifications:async({tag})=>existing.filter(n=>n.tag===tag),showNotification:async(...args)=>shown.push(args)};
  const context=vm.createContext({URL,location:{href:'https://tasks.example/'},navigator:{serviceWorker:{getRegistration:async()=>registration}},
    document:{addEventListener(){},querySelector:()=>({})}});
  vm.runInContext(readFileSync(new URL('../public/pwa.js',import.meta.url),'utf8'),context);
  await context.pwaNotify('Nova tarefa recebida',{tag:'task-1'});
  assert.equal(shown.length,1);assert.equal(shown[0][1].renotify,false);
  existing=[{tag:'task-2'}];
  await context.pwaNotify('Nova tarefa recebida',{tag:'task-2'});
  assert.equal(shown.length,1);
});

test('convite de instalação aparece só em dispositivos móveis e não reaparece no PC',()=>{
 for(const [userAgent,standalone,visible] of [['Mozilla Windows NT 10.0',false,false],['Mozilla iPhone',false,true],['Mozilla Android',false,true],['Mozilla iPhone',true,false]]) {
  const nodes=new Map(),events={};let ready;
  const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,addEventListener(){}});return nodes.get(id);};
  const c=vm.createContext({URL,location:{href:'https://tasks.example/'},navigator:{userAgent,platform:'',maxTouchPoints:0,onLine:true},matchMedia:()=>({matches:standalone}),window:{addEventListener:(type,fn)=>events[type]=fn},document:{addEventListener:(_,fn)=>ready=fn,querySelector:node}});
  vm.runInContext(readFileSync(new URL('../public/pwa.js',import.meta.url),'utf8'),c);
  ready();assert.equal(node('#pwaInstallButton').hidden,!visible);
  events.beforeinstallprompt({preventDefault(){}});assert.equal(node('#pwaInstallButton').hidden,!visible);
 }
});
