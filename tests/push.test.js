import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import webpush from 'web-push';
import { initPush, createPushService, validateSubscription } from '../src/push.js';

const sample = (suffix='a') => ({endpoint:'https://web.push.apple.com/'+suffix,keys:{p256dh:webpush.generateVAPIDKeys().publicKey,auth:Buffer.alloc(16,1).toString('base64url')}});

test('aceita provedores push, bloqueia destinos internos e inscrições malformadas',()=>{
  assert.equal(validateSubscription(sample()).endpoint,'https://web.push.apple.com/a');
  for(const endpoint of ['http://web.push.apple.com/a','https://localhost/','https://127.0.0.1/','https://web.push.apple.com.evil.test/','https://web.push.apple.com:8080/a','https://name:pass@web.push.apple.com/']) assert.throws(()=>validateSubscription({...sample(),endpoint}));
  assert.throws(()=>validateSubscription({...sample(),keys:{p256dh:'bad',auth:'bad'}}));
});

test('PostgreSQL: migração, chaves persistentes, eventos, isolamento, retries e remoção',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`CREATE TABLE usuarios(email TEXT PRIMARY KEY,perfil TEXT);CREATE TABLE tarefas(id TEXT PRIMARY KEY,atribuido_para TEXT,solicitado_por TEXT,status TEXT,obs_conclusao TEXT);
      INSERT INTO usuarios VALUES('a@test','Colaborador'),('b@test','Colaborador'),('admin@test','Admin');`);
    const query=async(sql,args)=>{
      if(!args && sql.includes('CREATE TABLE')) {await db.exec(sql);return {rows:[],rowCount:0};}
      const r=await db.query(sql,args);return {rows:r.rows,rowCount:r.affectedRows || r.rows.length};
    };
    await initPush(query);
    const first=(await query('SELECT keys FROM push_config')).rows[0].keys.publicKey;
    await initPush(query);
    assert.equal((await query('SELECT keys FROM push_config')).rows[0].keys.publicKey,first);
    const sent=[];
    let failure;
    const service=createPushService(query,{sendNotification:async(sub,payload,options)=>{if(failure)throw failure;sent.push({sub,payload:JSON.parse(payload),options});}});
    const a=sample('a'),b=sample('b'),admin=sample('admin');
    await service.subscribe('a@test',a);await service.subscribe('b@test',b);await service.subscribe('admin@test',admin);
    await query("INSERT INTO tarefas VALUES('task','a@test',NULL,'Pendente','')");
    await service.dispatch();
    assert.equal(sent.length,1);assert.equal(sent[0].sub.endpoint,a.endpoint);assert.equal(sent[0].payload.url,'/?task=task');
    assert.equal(sent[0].options.vapidDetails.publicKey,first);
    assert.equal(sent[0].options.urgency,'high');
    assert.equal(sent[0].payload.tag,'task-task');
    await service.dispatch();assert.equal(sent.length,1);
    await query("UPDATE tarefas SET atribuido_para='b@test' WHERE id='task'");
    await service.dispatch();assert.equal(sent.at(-1).sub.endpoint,b.endpoint);
    await query("UPDATE tarefas SET obs_conclusao='Finalizado' WHERE id='task'");
    await service.dispatch();assert.equal(sent.at(-1).sub.endpoint,admin.endpoint);
    await query("INSERT INTO tarefas VALUES('request','admin@test','a@test','Pendente','')");
    await service.dispatch();
    await query("UPDATE tarefas SET status='Em Andamento' WHERE id='request'");
    await service.dispatch();assert.equal(sent.at(-1).sub.endpoint,a.endpoint);
    await assert.rejects(service.test('b@test',a.endpoint));
    await service.unsubscribe('b@test',a.endpoint);
    assert.equal((await query('SELECT * FROM push_subscriptions WHERE endpoint=$1',[a.endpoint])).rowCount,1);
    await service.test('a@test',a.endpoint);failure={statusCode:503};await service.dispatch();
    assert.equal((await query('SELECT * FROM push_outbox')).rows[0].attempts,1);
    failure={statusCode:410};await query("UPDATE push_outbox SET available_at=NOW()");await service.dispatch();
    assert.equal((await query('SELECT * FROM push_subscriptions WHERE endpoint=$1',[a.endpoint])).rowCount,0);
    assert.equal((await query('SELECT * FROM push_outbox')).rowCount,0);
    await service.test('b@test',b.endpoint);await service.subscribe('a@test',b);
    assert.equal((await query('SELECT * FROM push_outbox')).rowCount,0);
    await service.unsubscribe('a@test',b.endpoint);
    assert.equal((await query('SELECT * FROM push_subscriptions WHERE endpoint=$1',[b.endpoint])).rowCount,0);
  } finally {await db.close();}
});
