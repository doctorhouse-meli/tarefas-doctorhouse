import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
function app() {
  const context=vm.createContext({document:{title:'',addEventListener(){}}});
  vm.runInContext(fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),context);
  return code=>vm.runInContext(code,context);
}
test('gestão ordena concluídas pela conclusão, não pelo prazo, e mantém tarefas sem registro por último',()=>{
  const run=app();
  const ids=run(`sortAdminTasks([
    {id:'old',status:'Concluida',dataConclusaoSort:10,dataPrazo:'2027-01-01'},
    {id:'unknown',status:'Concluida',dataPrazo:'2028-01-01'},
    {id:'new',status:'Concluida',dataConclusaoSort:20,dataPrazo:'2025-01-01'},
    {id:'pending',status:'Pendente',dataPrazo:'2026-01-01'},
    {id:'doing',status:'Em Andamento',dataPrazo:'2026-02-01'}
  ]).map(task=>task.id)`);
  assert.deepEqual(Array.from(ids),['doing','pending','new','old','unknown']);
});
test('clique no cartão abre edição apenas com permissão, sem botão separado',()=>{
  const run=app();
  run("currentUser={permissoes:{editarTarefas:false}}; var task={id:'example',titulo:'Teste',status:'Pendente',atribuidoPara:'a@test'}; adminData.tasks=[task]; var opened=''; openEditTask=id=>opened='edit:'+id; openTaskDetails=task=>opened='details:'+task.id;");
  run("openOverviewTask('example')");
  assert.equal(run('opened'),'details:example');
  run("currentUser.permissoes.editarTarefas=true; openOverviewTask('example');");
  assert.equal(run('opened'),'edit:example');
  const html=run('renderAdminTodayTask(task)');
  assert.doesNotMatch(html,/data-overview-edit|management-actions/);
  assert.equal((html.match(/<button/g)||[]).length,1);
});
