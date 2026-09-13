export const PERMISSION_KEYS = ['excluirTarefas','encaminharTarefas','criarParaOutros','editarTarefas'];
export function validatePermissions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key=>!PERMISSION_KEYS.includes(key)) || Object.values(value).some(v=>typeof v!=='boolean')) throw Error('Permissões inválidas.');
  return Object.fromEntries(PERMISSION_KEYS.map(key=>[key,value[key]===true]));
}
export async function saveUserPermissions(query,id,value) {
  if(value===undefined)return;
  await query('UPDATE usuarios SET permissoes=$2::jsonb WHERE id=$1',[id,JSON.stringify(validatePermissions(value))]);
}
export async function authorizeTaskOperation(query,method,args,identity,adminMethods) {
  const result=await query('SELECT * FROM usuarios WHERE email=$1',[identity.email]);
  const user=result.rows[0];if(!user)throw Error('Sessão inválida. Entre novamente.');
  if(adminMethods.has(method)&&user.perfil!=='Admin')throw Error('Acesso permitido apenas para Admin.');
  const allow=key=>{if(user.permissoes?.[key]!==true)throw Error('Seu cadastro não permite esta ação. Peça ao administrador para liberar a permissão.');};
  const getTask=async()=>{const r=await query('SELECT * FROM tarefas WHERE id=$1',[args[0]]);const task=r.rows[0];if(!task || (user.perfil!=='Admin'&&task.atribuido_para!==user.email))throw Error('Tarefa não disponível para este usuário.');return task;};
  const canSend=async email=>{
    if(email===user.email)return;
    allow('criarParaOutros');
    const r=await query('SELECT 1 FROM analyst_recipients p JOIN usuarios u ON u.id=p.recipient_id WHERE p.analyst_id=$1 AND u.email=$2',[user.id,email]);
    if(!r.rowCount)throw Error('Destinatário não autorizado no cadastro.');
  };
  if(['createTask','createDailyTemplate'].includes(method))await canSend(String(args[0]?.atribuidoPara||'').trim().toLowerCase());
  if(method==='createAssignedTask')allow('criarParaOutros');
  if(method==='forwardTask')allow('encaminharTarefas');
  if(method==='deleteTask'){allow('excluirTarefas');await getTask();}
  if(['deleteDailyTemplate','deleteEmployeeDailyTemplate'].includes(method))allow('excluirTarefas');
  if(method==='updateDailyTemplate'){
    allow('editarTarefas');
    const r=await query('SELECT * FROM templates_diarios WHERE id=$1',[args[0]]);
    if(r.rows[0]?.atribuido_para!==args[1]?.atribuidoPara)await canSend(args[1]?.atribuidoPara);
  }
  if(method==='updateTaskStatus'){
    await getTask();
    if(!['Pendente','Em Andamento','Concluida'].includes(args[1]))throw Error('Status inválido.');
  }
  if(['updateTask','updateOwnTask'].includes(method)){
    allow('editarTarefas');const task=await getTask(),data=args[1];
    if(method==='updateTask' && data.atribuidoPara!==task.atribuido_para) {
      allow('encaminharTarefas');
      const r=await query("SELECT 1 FROM usuarios WHERE email=$1 AND perfil='Colaborador'",[data.atribuidoPara]);
      if(!r.rowCount)throw Error('Encaminhe apenas para outro colaborador.');
    }
  }
  return user;
}
