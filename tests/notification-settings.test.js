import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { validateNotificationSettings, DEFAULT_NOTIFICATION_SETTINGS } from '../src/notification-settings.js';

test('configuração aceita catálogo e limites, rejeita valores inválidos', () => {
  assert.deepEqual(validateNotificationSettings({sound:'alert-3',volume:100,repeat:3}), {sound:'alert-3',volume:100,repeat:3});
  assert.deepEqual(validateNotificationSettings({sound:'none',volume:0,repeat:1}), {sound:'none',volume:0,repeat:1});
  for (const value of [{sound:'url-externa',volume:70,repeat:1}, {sound:'original',volume:101,repeat:1}, {sound:'original',volume:70,repeat:10}, null]) {
    assert.throws(() => validateNotificationSettings(value));
  }
});

test('som é compartilhado no banco e apenas Admin pode salvar', async () => {
  let stored;
  const context = vm.createContext({ crypto, Buffer, process, DEFAULT_NOTIFICATION_SETTINGS, validateNotificationSettings,
    query: async (sql, args) => {
      assert.equal(args[0], 'notification_sound');
      if (sql.startsWith('INSERT')) stored = JSON.parse(args[1]);
      return {rows: stored ? [{value:stored}] : []};
    }
  });
  let source = fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  source = source.slice(source.indexOf("const TZ ="), source.lastIndexOf('if (process.argv[1]'));
  vm.runInContext(source.replaceAll('export ',''),context);
  assert.equal((await vm.runInContext('getNotificationSettings()',context)).sound,'original');
  await vm.runInContext("saveNotificationSettings({sound:'alert-5',volume:85,repeat:2})",context);
  assert.equal((await vm.runInContext('getNotificationSettings()',context)).sound,'alert-5');
  for (const perfil of ['Colaborador','Solicitante','Admin']) {
    const run = () => vm.runInContext(`authorizeRpc('saveNotificationSettings', [], {headers:{authorization:'Bearer '+signToken({email:'teste@example.test',perfil:'${perfil}'})}})`,context);
    if(perfil === 'Admin') assert.doesNotThrow(run); else assert.throws(run,/Admin/);
    assert.doesNotThrow(() => vm.runInContext(`authorizeRpc('getNotificationSettings', [], {headers:{authorization:'Bearer '+signToken({email:'teste@example.test',perfil:'${perfil}'})}})`,context));
  }
});

test('preferências em edição sobrevivem ao polling; volume zero não toca áudio', async () => {
  const nodes = {'#soundVolume':{value:85},'#soundVolumeValue':{},'#soundRepeat':{value:2}};
  const context = vm.createContext({document:{querySelector:key=>nodes[key],querySelectorAll:()=>[]},callServer:async()=>({sound:'alert-1',volume:40,repeat:1})});
  vm.runInContext(fs.readFileSync(new URL('../public/notification-sounds.js',import.meta.url),'utf8'),context);
  vm.runInContext('soundSettingsDirty=true',context);
  await vm.runInContext('refreshNotificationSettings()',context);
  assert.equal(nodes['#soundVolume'].value,85);
  assert.equal(vm.runInContext('notificationSettings.volume',context),40);
  assert.equal(await vm.runInContext("playNotificationSound({sound:'alert-1',volume:0,repeat:3})",context),true);
  assert.equal(await vm.runInContext("playNotificationSound({sound:'none',volume:100,repeat:3})",context),true);
});

test('memes respeitam volume, repetição, interrupção e fallback quando indisponíveis', async () => {
  const clips = [];
  let fallback = 0;
  class Audio {
    constructor(url) { this.url=url; this.plays=0; clips.push(this); }
    play() { this.plays++; return Promise.resolve(); }
    pause() { this.paused=true; }
  }
  const status={textContent:''};
  const context=vm.createContext({Audio,document:{querySelector:()=>status},audioContext:{state:'running'},unlockNotificationSound(){},playLegacyNotificationSound(){fallback++;}});
  vm.runInContext(fs.readFileSync(new URL('../public/notification-sounds.js',import.meta.url),'utf8'),context);
  for(const id of ['meme-faaah','meme-aura','meme-pix','meme-magnata','meme-bruh']) {
    assert.equal(validateNotificationSettings({sound:id,volume:30,repeat:2}).sound,id);
    await vm.runInContext(`playNotificationSound({sound:'${id}',volume:30,repeat:2})`,context);
    const clip=clips.at(-1);
    assert.equal(clip.volume,0.3);
    clip.onended();
    assert.equal(clip.plays,2);
    clip.onended();
    assert.equal(clip.onended,null);
  }
  await vm.runInContext("playNotificationSound({sound:'meme-bruh',volume:30,repeat:3})",context);
  const interrupted=clips.at(-1);
  vm.runInContext('stopNotificationSound()',context);
  assert.equal(interrupted.paused,true);
  assert.equal(interrupted.onended,null);
  await vm.runInContext("playNotificationSound({sound:'meme-bruh',volume:30,repeat:1})",context);
  clips.at(-1).onerror();
  assert.equal(fallback,1);
});
