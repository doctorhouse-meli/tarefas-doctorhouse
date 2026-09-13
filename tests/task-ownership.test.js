import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {initTaskOwnership} from '../src/task-ownership.js';

function server(query) {
  const context=vm.createContext({query,crypto,Buffer,process,makeId:prefix=>prefix+'-'+crypto.randomUUID()});
  const source=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  vm.runInContext(source.slice(source.indexOf('const TZ ='),source.lastIndexOf('if (process.argv[1]')).replaceAll('export ',''),context);
  return context;
}

test('PostgreSQL: creator provenance, legacy backfill and guarded full editing',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`CREATE TABLE usuarios(email TEXT PRIMARY KEY);
      CREATE TABLE tarefas(id TEXT PRIMARY KEY,workspace TEXT,titulo TEXT,descricao TEXT,prioridade TEXT,data_prazo DATE,
        horario_prazo TIME,status TEXT,atribuido_para TEXT,solicitado_por TEXT,tarefa_origem_id TEXT,tipo TEXT,
        data_conclusao TIMESTAMPTZ,obs_conclusao TEXT,origem_template_id TEXT,data_criacao TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE historico(id TEXT PRIMARY KEY,task_id TEXT,autor_email TEXT,acao TEXT,detalhes TEXT,data_hora TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE templates_diarios(id TEXT PRIMARY KEY,workspace TEXT,titulo TEXT,descricao TEXT,prioridade TEXT,atribuido_para TEXT,horario_prazo TIME,dias_semana TEXT);
      CREATE TABLE geracoes_diarias(template_id TEXT,data_prazo DATE,task_id TEXT,ignorada BOOLEAN DEFAULT FALSE,PRIMARY KEY(template_id,data_prazo));
      INSERT INTO usuarios VALUES('self@test'),('admin@test');
      INSERT INTO tarefas(id,atribuido_para) VALUES('legacy','self@test'),('received','self@test'),('unknown','self@test');
      INSERT INTO historico(id,task_id,autor_email,acao) VALUES('h1','legacy','self@test','Criou tarefa'),('h2','received','admin@test','Criou tarefa');`);
    const query=async(sql,args)=>{
      if(sql.includes('ALTER TABLE')) {await db.exec(sql);return {rows:[],rowCount:0};}
      const r=await db.query(sql,args);return {rows:r.rows,rowCount:r.affectedRows||r.rows.length};
    };
    await initTaskOwnership(query);await initTaskOwnership(query);
    const s=server(query);
    vm.runInContext("ensureWorkspaceExists=async()=>{};getUserByEmail=async email=>({email,workspace:'Equipe'});",s);
    const data={titulo:'Revisado',descricao:'Novas instruções',prioridade:'Alta',dataPrazo:'2026-10-20',horarioPrazo:'14:30',status:'Concluida',obsConclusao:'Pronto',criadoPor:'admin@test',atribuidoPara:'admin@test',workspace:'Outro'};
    const saved=await s.updateOwnTask('legacy',data,'self@test');
    assert.equal(saved.titulo,'Revisado');assert.equal(saved.descricao,data.descricao);assert.equal(saved.horarioPrazo,'14:30');
    assert.equal(saved.criadoPor,'self@test');assert.equal(saved.atribuidoPara,'self@test');assert.equal(saved.obsConclusao,'Pronto');assert.ok(saved.dataConclusao);
    for(const id of ['received','unknown','missing']) await assert.rejects(s.updateOwnTask(id,{...data,criadoPor:'self@test'},'self@test'),/só pode editar/);
    await assert.rejects(s.updateOwnTask('legacy',data,'admin@test'),/só pode editar/);
    const reopened=await s.updateOwnTask('legacy',{...data,status:'Pendente'},'self@test');
    assert.equal(reopened.dataConclusaoKey,'');assert.equal(reopened.obsConclusao,'');
    for(const bad of [{titulo:' '},{prioridade:'bad'},{status:'bad'},{horarioPrazo:'28:99'}]) await assert.rejects(s.updateOwnTask('legacy',{...data,...bad},'self@test'));
    const made=await s.createEmployeeTask({...data,autorEmail:'admin@test'},'self@test');
    assert.equal(made.criadoPor,'self@test');assert.equal(made.atribuidoPara,'self@test');
    await s.createEmployeeDailyTemplate({...data,diasSemana:'1,2,3',autorEmail:'admin@test',criarHoje:true},'self@test');
    assert.equal((await query('SELECT criado_por FROM templates_diarios')).rows[0].criado_por,'self@test');
    assert.equal((await query("SELECT criado_por FROM tarefas WHERE tipo='Diaria'")).rows[0].criado_por,'self@test');
    await query("UPDATE tarefas SET atribuido_para='admin@test' WHERE id='legacy'");
    await assert.rejects(s.updateOwnTask('legacy',data,'self@test'),/só pode editar/);
  } finally {await db.close();}
});

test('RPC uses signed identity, rejects impersonation and retains admin-only editing',()=>{
  const s=server(async()=>{});
  vm.runInContext("getBearerUser=()=>({email:'self@test',perfil:'Colaborador'});",s);
  assert.throws(()=>s.authorizeRpc('updateOwnTask',['id',{},'other@test'],{}),/proprio usuario/);
  assert.throws(()=>s.authorizeRpc('updateTask',['id',{}],{}),/Admin/);
  const selfArgs=['id',{criadoPor:'self@test'},'self@test'];s.authorizeRpc('updateOwnTask',selfArgs,{});assert.equal(selfArgs[2],'self@test');
  vm.runInContext("getBearerUser=()=>({email:'admin@test',perfil:'Admin'});",s);
  for(const method of ['createTask','createDailyTemplate']) {
    const args=[{autorEmail:'self@test'}];s.authorizeRpc(method,args,{});assert.equal(args[0].autorEmail,'admin@test');
  }
  const args=[{},'self@test'];s.authorizeRpc('createEmployeeTask',args,{});assert.equal(args[1],'admin@test');
});

test('personal edit option is shown only to the creator who is still assigned',()=>{
  const s=vm.createContext({document:{title:'',addEventListener(){}}});
  vm.runInContext(fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),s);
  vm.runInContext("currentUser={email:'self@test',perfil:'Colaborador'};",s);
  assert.equal(s.canEditOwnTask({criadoPor:'self@test',atribuidoPara:'self@test'}),true);
  for(const task of [{atribuidoPara:'self@test'},{criadoPor:'admin@test',atribuidoPara:'self@test'},{criadoPor:'self@test',atribuidoPara:'other@test'}]) assert.equal(s.canEditOwnTask(task),false);
});
