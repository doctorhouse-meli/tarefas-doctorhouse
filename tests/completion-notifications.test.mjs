import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('unread completions survive first load and open the task independently of filters', async () => {
  const elements = new Map();
  const handlers = new Map();
  const element = (key) => {
    if (!elements.has(key)) elements.set(key, {classList: {remove() {}, add() {}}, textContent: '', innerHTML: ''});
    return elements.get(key);
  };
  let items = [{id:'event1',task_id:'task1',autor:'Ana',titulo:'Entrega',data_hora:'2026-10-14T12:00:00Z',lida:false}];
  const calls = [];
  let sounds = 0;
  const context = vm.createContext({
    document:{addEventListener(){}}, currentUser:{email:'admin@test',perfil:'Admin'},
    $:element, $$:selector => [{dataset:{completionOpen:'event1',completionRead:'event1'}, addEventListener:(_,handler)=>handlers.set(selector,handler)}],
    escapeHtml:String, console, setInterval(){}, startTitleAlert(){}, showTaskAlert(){},
    playNotificationSound(){sounds++;}, showBrowserStatusNotification(){},
    openTaskDetails:async task=>calls.push(task.id),
    callServer:async (method,...args)=>{
      if(method==='getCompletionNotifications') return items;
      if(method==='getAdminDashboardData') return {tasks:[{id:'task1'}]};
      if(method==='markCompletionRead'){calls.push(args);items=items.map(item=>({...item,lida:true}));}
    }
  });
  vm.runInContext(fs.readFileSync(new URL('../public/completion-notifications.js',import.meta.url),'utf8'),context);
  await vm.runInContext('refreshCompletionNotifications()',context);
  assert.equal(element('#completionNotificationsCount').textContent,1);
  assert.match(element('#completionNotificationsList').innerHTML,/Ana concluiu: Entrega/);
  assert.equal(sounds,0);
  await handlers.get('[data-completion-open]')();
  assert.equal(calls[0],'task1');
  assert.deepEqual(Array.from(calls[1]),['event1','admin@test']);
  assert.equal(element('#completionNotificationsCount').textContent,0);
  items.push({id:'event2',task_id:'task2',autor:'Bia',titulo:'Outra',data_hora:'2026-10-14T13:00:00Z',lida:false});
  await vm.runInContext('refreshCompletionNotifications()',context);
  await vm.runInContext('refreshCompletionNotifications()',context);
  assert.equal(sounds,1);
});

