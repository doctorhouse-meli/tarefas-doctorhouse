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
test('editar na visão geral exige permissão e fica separado do botão de detalhes',()=>{
  const run=app();
  run(`currentUser={permissoes:{editarTarefas:false}}; var task={id:'example',titulo:'Teste',status:'Pendente',atribuidoPara:'a@test'};`);
  assert.doesNotMatch(run('renderAdminTodayTask(task)'),/data-overview-edit/);
  run('currentUser.permissoes.editarTarefas=true');
  const html=run('renderAdminTodayTask(task)');
  assert.match(html,/data-overview-edit="example"/);
  assert.match(html,/<\/button><div class="management-actions"><button/);
});
