import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const source = server.slice(server.indexOf('export async function createEmployeeDailyTemplate'), server.indexOf('export async function deleteEmployeeDailyTemplate')).replace('export ', '');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('recurrence uses only an authorized recipient and enforces both permissions', async () => {
  let saved, generated = 0;
  const user = {id:'actor',email:'ana@test',workspace:'A',perfil:'Colaborador',permissoes:{criarTarefasRepetitivas:true,criarParaOutros:true}};
  const other = {id:'other',email:'bia@test',workspace:'B'};
  const context = vm.createContext({
    getUserByEmail:async()=>user,
    getAllowedTaskRecipients:async()=>user.permissoes.criarParaOutros ? [other] : [],
    createDailyTemplate:async data=>{saved=data;return {...data,id:'template'};},
    createTaskFromTemplate:async()=>{generated++;},
    todayKey:()=> '2026-10-27', weekdayKey:()=>2, normalizeWeekdays:value=>value,
  });
  vm.runInContext(source,context);
  const create = data => context.createEmployeeDailyTemplate({titulo:'Rotina',prioridade:'Media',diasSemana:'1,2,3,4,5',criarHoje:'true',...data},user.email);
  await create({recipientId:'other',atribuidoPara:'intruso@test',workspace:'forged',autorEmail:'forged'});
  assert.equal(saved.atribuidoPara,'bia@test');
  assert.equal(saved.workspace,'B');
  assert.equal(saved.autorEmail,'ana@test');
  assert.equal(generated,1);
  await create({diasSemana:'3'});
  assert.equal(saved.atribuidoPara,'ana@test');
  assert.equal(generated,1);
  await assert.rejects(()=>create({recipientId:'unknown'}),/não autorizado/);
  user.permissoes.criarParaOutros=false;
  await assert.rejects(()=>create({recipientId:'other'}),/não autorizado/);
  user.permissoes.criarTarefasRepetitivas=false;
  await assert.rejects(()=>create({}),/não permite/);
});

test('the same task form routes a recurring assignment and preserves manual creation', async () => {
  const calls = [];
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector,{value:'',textContent:'',classList:{add(){},remove(){}},reset(){},querySelector(){return node('submit');},querySelectorAll(){return [{value:'2'},{value:'4'}];}});
    return nodes.get(selector);
  };
  const context = vm.createContext({$:node,document:{title:'',addEventListener(){},querySelector:node},
    callServer:async(...args)=>calls.push(args),formToObject:()=>({titulo:'Rotina',recipientId:'other'}),
    closeModals(){},showToast(){},loadEmployee:async()=>{},
    canCreateRecurringTasks:()=>true,creatorRepeatDays:()=> '2,4'});
  const handler = app.slice(app.indexOf('  async function handleCreateEmployeeTask('), app.indexOf('  async function handleDeleteEmployeeTemplate('));
  vm.runInContext('let ownTaskSavePending=false; let currentUser={email:"ana@test"}; let employeeTaskFilter="all"; let taskSearch="";'+handler,context);
  node('#employeeRepeat').value='custom';
  await context.handleCreateEmployeeTask({preventDefault(){},target:node('form')});
  assert.equal(calls[0][0],'createEmployeeDailyTemplate');
  assert.equal(calls[0][1].recipientId,'other');
  assert.equal(calls[0][1].diasSemana,'2,4');
  assert.equal(calls[0][2],'ana@test');
  node('#employeeRepeat').value='none';
  await context.handleCreateEmployeeTask({preventDefault(){},target:node('form')});
  assert.equal(calls[1][0],'createAssignedTask');
});

