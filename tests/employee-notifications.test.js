import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const sounds = fs.readFileSync(new URL('../public/notification-sounds.js',import.meta.url),'utf8');

test('primeira tarefa após lista vazia avisa uma vez; login não avisa tarefas existentes', () => {
  let played=0;
  const context=vm.createContext({document:{title:'',addEventListener(){}}});
  vm.runInContext(app,context);
  Object.assign(context,{startTitleAlert(){},showTaskAlert(){},playNotificationSound(){played++;},showBrowserNotification(){}});
  vm.runInContext(`notifyNewEmployeeTasks([],true); notifyNewEmployeeTasks([{id:'nova'}],false); notifyNewEmployeeTasks([{id:'nova'}],false)`,context);
  assert.equal(played,1);
  vm.runInContext(`notifyNewEmployeeTasks([],false); notifyNewEmployeeTasks([{id:'segunda'}],false)`,context);
  assert.equal(played,2);
  vm.runInContext(`notifyNewEmployeeTasks([{id:'existente'}],true)`,context);
  assert.equal(played,2);
});

test('som escolhido agenda mesmo quando resume aguarda interação do colaborador', async () => {
  const starts=[];
  let resumes=0;
  class AudioContext {
    constructor(){this.state='suspended';this.currentTime=10;this.destination={};}
    resume(){resumes++;return new Promise(()=>{});}
    createBufferSource(){return {connect(){},addEventListener(){},start(time){starts.push(time);},stop(){},disconnect(){}};}
    createGain(){return {gain:{value:0},connect(){},disconnect(){}};}
  }
  const context=vm.createContext({window:{AudioContext},document:{title:'',addEventListener(){}}});
  vm.runInContext(app+'\n'+sounds,context);
  vm.runInContext(`soundBuffers.set('alert-3',{duration:0.5}); notificationSettings={sound:'alert-3',volume:80,repeat:2}`,context);
  await vm.runInContext('playNotificationSound()',context);
  assert.equal(resumes,1);
  assert.deepEqual(starts,[10,10.8]);
});

test('colaborador recebe escolha do admin e prepara o áudio antes da nova tarefa', async () => {
  let decoded=0,fetches=0;
  const source={duration:0.4};
  const nodes={'#soundVolume':{},'#soundVolumeValue':{},'#soundRepeat':{}};
  const context=vm.createContext({AbortSignal,document:{querySelector:key=>nodes[key],querySelectorAll:()=>[]},audioContext:{decodeAudioData:async()=>{decoded++;return source;}},callServer:async()=>({sound:'notification-3',volume:65,repeat:2}),fetch:async url=>{fetches++;return {ok:true,json:async()=>({'notification-3':'data:audio/mp4;base64,AAAA'}),arrayBuffer:async()=>new ArrayBuffer(4)};}});
  vm.runInContext(sounds,context);
  await vm.runInContext('refreshNotificationSettings()',context);
  await vm.runInContext("getNotificationBuffer('notification-3')",context);
  assert.equal(vm.runInContext('notificationSettings.sound',context),'notification-3');
  assert.equal(nodes['#soundVolume'].value,65);
  assert.equal(decoded,1);
  assert.equal(fetches,2);
});
