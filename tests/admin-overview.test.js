import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const context=vm.createContext({Intl,Date});
vm.runInContext(fs.readFileSync(new URL('../public/admin-overview.js',import.meta.url),'utf8'),context);
const build=context.buildManagementOverview;
test('gestão separa atrasadas por dia e horário, inclui tarefas sem prazo e ordena conclusões pela entrega',()=>{
 const tasks=[
 {id:'old',atribuidoPara:'a',status:'Concluida',dataPrazo:'2027-01-01',dataConclusaoSort:1},
 {id:'new',atribuidoPara:'a',status:'Concluida',dataPrazo:'2025-01-01',dataConclusaoSort:2},
 {id:'yesterday',atribuidoPara:'a',status:'Pendente',dataPrazo:'2026-10-10'},
 {id:'early',atribuidoPara:'a',status:'Em Andamento',dataPrazo:'2026-10-11',horarioPrazo:'08:00'},
 {id:'today',atribuidoPara:'b',status:'Pendente',dataPrazo:'2026-10-11'},
 {id:'none',atribuidoPara:'b',status:'Pendente'},
 ];
 const now=new Date('2026-10-11T15:00:00Z');
 const panel=build(tasks,'',now);
 assert.deepEqual(Array.from(panel.overdue,t=>t.id),['yesterday','early']);
 assert.deepEqual(Array.from(panel.pending,t=>t.id),['today','none']);
 assert.deepEqual(Array.from(panel.completed,t=>t.id),['new','old']);
 assert.equal(panel.total,6);
 const filtered=build(tasks,'A',now);
 assert.equal(filtered.total,4);assert.equal(filtered.pending.length,0);
 assert.equal(build([],'',now).total,0);
 assert.equal(tasks[0].id,'old');
});
