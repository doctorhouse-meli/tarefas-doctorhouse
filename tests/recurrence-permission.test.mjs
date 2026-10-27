import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeTaskOperation, validatePermissions } from '../src/permissions.js';

test('recurring creation requires explicit permission and honors revocation', async () => {
  const user = {email:'ana@test',perfil:'Colaborador',permissoes:{}};
  const query = async () => ({rows:[user]});
  const create = () => authorizeTaskOperation(query,'createEmployeeDailyTemplate',[{},user.email],{email:user.email},new Set());
  await assert.rejects(create,/não permite/);
  user.permissoes = validatePermissions({criarTarefasRepetitivas:true});
  assert.equal(await create(),user);
  user.permissoes = validatePermissions({});
  await assert.rejects(create,/não permite/);
  user.perfil = 'Admin';
  assert.equal(await create(),user);
  await assert.rejects(async()=>validatePermissions({criarTarefasRepetitivas:'true'}),/inválidas/);
});

