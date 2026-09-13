import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';

function server(query) {
  const context = vm.createContext({ query, crypto, Buffer, process });
  let source = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  source = source.slice(source.indexOf('const TZ ='), source.lastIndexOf('if (process.argv[1]'));
  vm.runInContext(source.replaceAll('export ', ''), context);
  vm.runInContext(`ensureWorkspaceExists = async () => {}; getUserByEmail = async email => email === 'novo@test' ? {email} : null`, context);
  return code => vm.runInContext(code, context);
}

const data = { titulo: 'Conferir pedidos', descricao: 'Novas instruções', prioridade: 'Alta', workspace: 'Equipe', atribuidoPara: 'novo@test', horarioPrazo: '10:30', diasSemana: '1,3,5' };

test('editar e reatribuir altera a programação, preservando tarefas e histórico', async () => {
  const queries = [];
  const run = server(async (sql, params) => {
    queries.push({sql, params});
    return { rowCount: 1, rows: [{id: params[0],workspace: params[1],titulo: params[2],descricao: params[3],prioridade: params[4],atribuido_para: params[5],horario_prazo: params[6],dias_semana: params[7]}] };
  });
  const saved = await run(`updateDailyTemplate('tpl1', ${JSON.stringify(data)})`);
  assert.equal(saved.atribuidoPara, 'novo@test');
  assert.equal(saved.diasSemana, '1,3,5');
  assert.equal(saved.horarioPrazo, '10:30');
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /^UPDATE templates_diarios/);
  assert.equal(queries[0].params[0], 'tpl1');
});

test('edição inválida não grava; ID inexistente é reportado', async () => {
  let writes = 0;
  const run = server(async () => { writes++; return {rowCount:0,rows:[]}; });
  for (const invalid of [{diasSemana:''},{diasSemana:'1,9'},{horarioPrazo:'26:00'},{atribuidoPara:'ausente@test'},{titulo:'  '},{prioridade:'invalida'}]) {
    await assert.rejects(run(`updateDailyTemplate('tpl1', ${JSON.stringify({...data,...invalid})})`));
  }
  assert.equal(writes, 0);
  await assert.rejects(run(`updateDailyTemplate('ausente', ${JSON.stringify(data)})`), /não encontrada/);
});

test('exclusão preserva tarefas geradas e identificadores de geração', async () => {
  const calls=[];
  const run=server(async (sql,args) => {calls.push({sql,args});return {rowCount:1,rows:[{id:args[0]}]};});
  assert.equal((await run("deleteDailyTemplate('tpl1')")).deleted,true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].sql,'DELETE FROM templates_diarios WHERE id = $1 RETURNING id');
  assert.equal(calls[0].args[0],'tpl1');
});

test('somente Admin pode editar ou excluir repetições pelo RPC', () => {
  const run=server(async()=>({rows:[]}));
  for (const method of ['updateDailyTemplate','deleteDailyTemplate']) {
    for (const perfil of ['Colaborador','Solicitante','Admin']) {
      const action=()=>run(`authorizeRpc('${method}',[],{headers:{authorization:'Bearer '+signToken({email:'teste@test',perfil:'${perfil}'})}})`);
      if(perfil==='Admin') assert.doesNotThrow(action); else assert.throws(action,/Admin/);
    }
  }
});

test('resposta anterior à edição não restaura a programação antiga na lista', async () => {
  let finish;
  const context=vm.createContext({document:{title:'',addEventListener(){},querySelector:()=>({classList:{contains:()=>false}}),querySelectorAll:()=>[]},callServer:()=>new Promise(resolve=>{finish=resolve;})});
  for(const file of ['app.js','workspace.js','task-creator.js','admin-recurrences.js']) vm.runInContext(fs.readFileSync(new URL('../public/'+file,import.meta.url),'utf8'),context);
  vm.runInContext(`currentUser={email:'admin@test',perfil:'Admin'}; refreshNotificationSettings=async()=>{}; callServer=()=>new Promise(resolve=>{ pendingResolve=resolve; });`,context);
  const pending=vm.runInContext('loadAdmin(true)',context);
  vm.runInContext(`recurrenceRevision++; pendingResolve({tasks:[{id:'antiga'}]});`,context);
  await pending;
  assert.equal(vm.runInContext('adminData.tasks.length',context),0);
});
