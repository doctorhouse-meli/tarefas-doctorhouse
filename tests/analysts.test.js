import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {initTaskOwnership} from '../src/task-ownership.js';
import {initAnalysts,saveAnalystRecipients} from '../src/analysts.js';

test('PostgreSQL: migra Analistas, preserva tarefas e aplica destinatários individuais no servidor',async()=>{
 const db=new PGlite();
 try {
  const query=async(sql,args)=>{if(!args){const results=await db.exec(sql);const r=results.at(-1);return {rows:r?.rows||[],rowCount:r?.affectedRows||r?.rows?.length||0};}const r=await db.query(sql,args);return {rows:r.rows,rowCount:r.affectedRows||r.rows.length};};
  const context=vm.createContext({query,crypto,Buffer,process,saveAnalystRecipients,pool:{connect:async()=>({query,release(){}})}});
  const dbSource=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  vm.runInContext(dbSource.slice(dbSource.indexOf('export async function initDb')).replaceAll('export ',''),context);
  await context.initDb();
  await db.exec(`ALTER TABLE usuarios DROP CONSTRAINT usuarios_perfil_check;
   ALTER TABLE usuarios ADD CONSTRAINT usuarios_perfil_check CHECK(perfil IN ('Admin','Colaborador','Solicitante'));
   INSERT INTO usuarios VALUES('ana','Ana Silva','ana@test','pw','Solicitante','Principal'),('col','Carla','carla@test','pw','Colaborador','Principal'),('other','Outra Analista','other@test','pw','Solicitante','Principal');`);
  await context.initDb();await initTaskOwnership(query);
  await db.exec(`INSERT INTO tarefas(id,workspace,titulo,descricao,prioridade,data_prazo,status,atribuido_para,solicitado_por,criado_por)
   VALUES('legacy','Principal','Pedido: Revisar','Pedido feito por: Ana Silva (ana@test)'||chr(10)||'Descrição preservada','Alta','2026-09-15','Em Andamento','carla@test','ana@test','ana@test');`);
  await initAnalysts(query);await initAnalysts(query);
  assert.equal((await query("SELECT perfil FROM usuarios WHERE id='ana'")).rows[0].perfil,'Analista');
  const legacy=(await query("SELECT * FROM tarefas WHERE id='legacy'")).rows[0];
  assert.equal(legacy.titulo,'Revisar');assert.equal(legacy.descricao,'Descrição preservada');assert.equal(legacy.status,'Em Andamento');assert.equal(legacy.criado_por_nome,'Ana Silva');
  const source=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  vm.runInContext(source.slice(source.indexOf('const TZ ='),source.lastIndexOf('if (process.argv[1]')).replaceAll('export ',''),context);
  vm.runInContext('generateDailyTasks=async()=>({created:0});',context);
  const admin=(await query("SELECT id FROM usuarios WHERE perfil='Admin'")).rows[0].id;
  assert.equal((await context.getAllowedTaskRecipients('ana@test')).length,0);
  await saveAnalystRecipients(query,'ana','Analista',['col',admin,'col']);
  assert.equal((await context.getAllowedTaskRecipients('ana@test')).length,2);
  assert.equal((await context.getAllowedTaskRecipients('other@test')).length,0);
  for(const ids of [['other'],['missing'],['ana'],'all',[null]]) await assert.rejects(saveAnalystRecipients(query,'ana','Analista',ids));
  assert.equal((await context.getAllowedTaskRecipients('ana@test')).length,2);
  const data={recipientId:'col',titulo:'Conferir estoque',descricao:'Instruções',prioridade:'Alta',dataPrazo:'2026-09-20',horarioPrazo:'14:30',status:'Concluida',autorEmail:'spoof@test',criadoPor:'spoof@test',workspace:'Spoof',atribuidoPara:'spoof@test'};
  const made=await context.createAssignedTask(data,'ana@test');
  assert.equal(made.titulo,data.titulo);assert.equal(made.descricao,data.descricao);assert.equal(made.criadoPor,'ana@test');assert.equal(made.criadoPorNome,'Ana Silva');assert.equal(made.atribuidoPara,'carla@test');assert.equal(made.workspace,'Principal');assert.equal(made.status,'Pendente');
  assert.equal((await context.createAssignedTask({...data,recipientId:admin},'ana@test')).atribuidoPara,'admin@empresa.com');
  await assert.rejects(context.createAssignedTask(data,'other@test'),/permissão/);
  await assert.rejects(context.createAssignedTask({...data,recipientId:'other'},'ana@test'),/permissão/);
  await saveAnalystRecipients(query,'ana','Analista',undefined);
  assert.equal((await context.getAllowedTaskRecipients('ana@test')).length,2);
  await context.updateUser('ana',{nome:'Ana Souza',email:'ana.nova@test',senha:'',perfil:'Analista',workspace:'Principal',destinatariosPermitidos:['col']});
  assert.equal((await context.getAllowedTaskRecipients('ana.nova@test')).length,1);
  assert.equal((await context.getSentTasks('ana.nova@test')).length,3);
  const visible=(await context.getEmployeeTasks('carla@test')).find(t=>t.id===made.id);assert.equal(visible.criadoPorNome,'Ana Souza');
  await assert.rejects(context.updateUser('ana',{nome:'Errado',email:'broken@test',perfil:'Analista',workspace:'Principal',destinatariosPermitidos:['other']}));
  assert.equal((await query("SELECT nome FROM usuarios WHERE id='ana'")).rows[0].nome,'Ana Souza');
  await assert.rejects(context.createAssignedTask({...data,recipientId:admin},'ana.nova@test'),/permissão/);
  await query("UPDATE usuarios SET perfil='Analista' WHERE id='col'");
  assert.equal((await context.getAllowedTaskRecipients('ana.nova@test')).length,0);
  await assert.rejects(context.createAssignedTask(data,'ana.nova@test'),/permissão/);
  await query("UPDATE usuarios SET perfil='Colaborador' WHERE id='col'");
  await saveAnalystRecipients(query,'ana','Analista',[]);
  await assert.rejects(context.createAssignedTask(data,'ana.nova@test'),/permissão/);
  vm.runInContext("getBearerUser=()=>({email:'ana.nova@test',perfil:'Analista'});",context);
  assert.throws(()=>context.authorizeRpc('createAssignedTask',[data,'other@test'],{}),/proprio usuario/);
  assert.throws(()=>context.authorizeRpc('updateUser',['col',{}],{}),/Admin/);
  assert.equal(vm.runInContext("rpc.createAdminRequest",context),undefined);
 } finally {await db.close();}
});

test('editor de usuário recupera permissões existentes ao abrir o cadastro da Analista',()=>{
 const form={elements:Object.fromEntries(['id','emailOriginal','nome','email','senha','perfil','workspace'].map(name=>[name,{}]))};
 const title={};let selected;
 const c=vm.createContext({document:{title:'',addEventListener(){},querySelector:selector=>selector==='#userForm'?form:title},form,title,capture:ids=>{selected=Array.from(ids)}});
 vm.runInContext(fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),c);
 vm.runInContext("openModal=()=>{};renderAnalystPermissions=capture;adminData={usuarios:[{id:'ana',nome:'Ana',email:'ana@test',perfil:'Analista',workspace:'Principal',destinatariosPermitidos:['adm','col']}]};",c);
 c.openEditUser('ana');assert.equal(form.elements.perfil.value,'Analista');assert.deepEqual(selected,['adm','col']);
});
