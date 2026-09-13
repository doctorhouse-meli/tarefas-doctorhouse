import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

function editor() {
  const context = vm.createContext({ document: { title: '', addEventListener() {} } });
  for (const file of ['app.js','workspace.js','task-creator.js']) vm.runInContext(fs.readFileSync(new URL('../public/'+file, import.meta.url),'utf8'),context);
  return code => vm.runInContext(code,context);
}

test('poll iniciado antes de editar é descartado ao chegar durante a edição', async () => {
  const run = editor();
  await run(`
    (async () => {
      currentUser = {email:'admin@test',perfil:'Admin'};
      let editing = false, finish;
      document.querySelector = () => ({classList:{contains:()=>false}});
      document.querySelectorAll = () => editing ? [{classList:{contains:()=>false}}] : [];
      callServer = () => new Promise(resolve => finish = resolve);
      const pending = loadAdmin(true);
      editing = true;
      finish({ tasks: [{id:'incoming'}] });
      await pending;
    })();
  `);
  assert.equal(run('adminData.tasks.length'),0);
});

test('atualizar opções nunca troca responsável de um formulário aberto', () => {
  const run=editor();
  run(`
    const selected = {value:'colaborador@test',innerHTML:'original',closest:()=>true};
    const filter = {value:'',innerHTML:'',options:[]};
    document.querySelector = () => filter;
    document.querySelectorAll = () => [selected];
    adminData.usuarios = [{email:'primeiro@test',nome:'Primeiro'}];
    adminData.workspaces = [{nome:'Outro'}];
    renderAdminSelects();
  `);
  assert.equal(run('selected.value'),'colaborador@test');
  assert.equal(run('selected.innerHTML'),'original');
});

test('renomear ou trocar status ajusta apenas os filtros que esconderiam a tarefa', () => {
  const run=editor();
  run(`
    const filters = {
      '#filterEmployee': {value:'pessoa@test'}, '#filterWorkspace':{value:''},
      '#filterStatus':{value:'Pendente'}, '#adminSearch':{value:'Título antigo'}
    };
    document.querySelector = key => filters[key];
    keepEditedTaskVisible({titulo:'Novo título',atribuidoPara:'pessoa@test',workspace:'Principal',status:'Em Andamento'});
  `);
  assert.equal(run(`filters['#adminSearch'].value`),'');
  assert.equal(run(`filters['#filterStatus'].value`),'Em Andamento');
  assert.equal(run(`filters['#filterEmployee'].value`),'pessoa@test');
  assert.equal(run(`filters['#filterWorkspace'].value`),'');
});

test('erro ao salvar preserva formulário e bloqueia envio duplicado', async () => {
  const run=editor();
  await run(`
    (async () => {
      currentUser = {email:'admin@test'};
      const errorBox = {textContent:'',classList:{add(){},remove(){}}};
      const button = {disabled:false,textContent:'Salvar'};
      document.querySelector = () => errorBox;
      formToObject = () => ({id:'1',titulo:'Novo título'});
      let rejectRequest, requests = 0;
      callServer = () => { requests++; return new Promise((resolve,reject) => rejectRequest=reject); };
      const form = {querySelector:()=>button,reset(){throw Error('Formulário foi apagado');}};
      const event = {preventDefault(){},target:form};
      const first = handleSaveTask(event);
      await handleSaveTask(event);
      if (requests !== 1) throw Error('Envio duplicado');
      rejectRequest(Error('Falha simulada'));
      await first;
      if (button.disabled || taskSavePending) throw Error('Botão não foi liberado');
      if (errorBox.textContent !== 'Falha simulada') throw Error('Erro não exibido');
    })();
  `);
});
