import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

function workspace() {
  const context = vm.createContext({ document: { title: '', addEventListener() {} } });
  for (const file of ['app.js', 'workspace.js']) {
    vm.runInContext(fs.readFileSync(new URL('../public/' + file, import.meta.url), 'utf8'), context);
  }
  vm.runInContext(`const sample = [
    { id:'a', titulo:'Reposição', descricao:'Conferir estoque', status:'Pendente', prioridade:'Media', dataPrazo:'2026-01-01' },
    { id:'b', titulo:'Catálogo', status:'Em Andamento', prioridade:'Urgente', dataPrazo:'2026-01-02' },
    { id:'c', titulo:'Finalizada', status:'Concluida', prioridade:'Alta', dataPrazo:'2026-01-01' },
    { id:'d', titulo:'Ideias', status:'Pendente', prioridade:'Baixa', dataPrazo:'' }
  ];`, context);
  return code => vm.runInContext(code, context);
}

test('listas abertas, pendentes e concluídas respeitam o status', () => {
  const run = workspace();
  assert.equal(run(`employeeTaskFilter='all'; applyEmployeeTaskFilter(sample).length`), 3);
  assert.equal(run(`employeeTaskFilter='pending'; applyEmployeeTaskFilter(sample).map(t=>t.id).join(',')`), 'a,d');
  assert.equal(run(`employeeTaskFilter='done'; applyEmployeeTaskFilter(sample)[0].id`), 'c');
});
test('busca ignora acentos e combina com filtro e ordenação', () => {
  const run = workspace();
  assert.equal(run(`taskSearch='reposicao'; applyEmployeeTaskFilter(sample)[0].id`), 'a');
  assert.equal(run(`taskSearch=''; taskSort='priority'; applyEmployeeTaskFilter(sample)[0].id`), 'b');
  assert.equal(run(`taskSearch='inexistente'; applyEmployeeTaskFilter(sample).length`), 0);
});
test('descrições escapam HTML e apenas HTTP(S) vira link', () => {
  const run = workspace();
  const html = run(`taskDescriptionHtml('<img src=x onerror=alert(1)> https://example.com/?q="x" javascript:alert(1)')`);
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(!html.includes('href="javascript:'));
});
test('tarefas sem prazo têm grupo próprio e datas usam formato brasileiro', () => {
  const run = workspace();
  assert.ok(run(`renderTaskGroups([sample[3]])`).includes('Sem prazo'));
  assert.equal(run(`formatTaskSchedule({dataPrazo:'2026-09-13',horarioPrazo:'09:30'})`), '13/09/2026 às 09:30');
});
