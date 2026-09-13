import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, makeId, pool, query } from './db.js';
import { DEFAULT_NOTIFICATION_SETTINGS, validateNotificationSettings } from './notification-settings.js';
import { initPush, createPushService } from './push.js';
import { initTaskOwnership } from './task-ownership.js';
import { initAnalysts, saveAnalystRecipients } from './analysts.js';
import { saveUserPermissions, authorizeTaskOperation } from './permissions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const pushService = createPushService(query);
const TZ = 'America/Sao_Paulo';
const SESSION_SECRET = process.env.SESSION_SECRET || 'troque-esta-chave-no-railway';

let initialized = false;
let initializationPromise;

export async function init() {
  if (initialized) return;
  if (initializationPromise) return initializationPromise;
  if (!process.env.DATABASE_URL) {
    throw new Error('Configure DATABASE_URL no Railway ou no arquivo .env local.');
  }
  initializationPromise = (async () => {
    await initDb();
    await initTaskOwnership(query);
    await initAnalysts(query);
    await initPush(query);
    initialized = true;
  })().catch(error => { initializationPromise = null; throw error; });
  return initializationPromise;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function requireFields(data, fields) {
  fields.forEach((field) => {
    if (data[field] === undefined || data[field] === null || String(data[field]).trim() === '') {
      throw new Error(`Campo obrigatorio: ${field}`);
    }
  });
}

function todayKey() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function weekdayKey(dateKey = todayKey()) {
  const date = new Date(`${dateKey}T12:00:00-03:00`);
  return String(date.getDay());
}

function toDateKey(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function toDateTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function normalizeTime(value) {
  const time = String(value || '').trim();
  if (!time) return null;
  const match = time.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (!match) throw new Error('Horario invalido. Use HH:MM.');
  return `${match[1]}:${match[2]}`;
}

function toTimeKey(value) {
  if (!value) return '';
  const text = String(value);
  return text.slice(0, 5);
}

function normalizeWeekdays(value) {
  const days = String(value || '1,2,3,4,5')
    .split(',')
    .map((day) => day.trim())
    .filter((day) => ['0', '1', '2', '3', '4', '5', '6'].includes(day));
  return [...new Set(days)].join(',') || '1,2,3,4,5';
}

function weekdaysLabel(value) {
  const names = { 0: 'Dom', 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sab' };
  return String(value || '')
    .split(',')
    .map((day) => names[day.trim()])
    .filter(Boolean)
    .join(', ');
}

function sanitizeUser(row) {
  return {
    id: row.id,
    nome: row.nome,
    email: row.email,
    perfil: row.perfil === 'Admin' ? 'Admin' : 'Colaborador',
    permissoes: row.permissoes || {},
    destinatariosPermitidos: row.destinatarios_permitidos || [],
    workspace: row.workspace,
  };
}

function normalizeProfile(profile) {
  if (profile === 'Admin') return 'Admin';
  return 'Colaborador';
}

function signToken(user) {
  const payload = Buffer.from(JSON.stringify({
    email: user.email,
    perfil: user.perfil,
    workspace: user.workspace,
    persistent: true,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) throw new Error('Sessao invalida.');
  const [payload, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error('Sessao invalida.');
  }
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (data.persistent !== true && (!Number.isFinite(data.exp) || Date.now() > data.exp)) throw new Error('Sessao expirada.');
  return data;
}

function getBearerUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return verifyToken(token);
}

function formatWorkspace(row) {
  return {
    id: row.id,
    nome: row.nome,
    descricao: row.descricao || '',
    ativo: row.ativo !== false,
    dataCriacao: toDateTime(row.data_criacao),
  };
}

function formatTask(row) {
  const completedSort = row.data_conclusao ? new Date(row.data_conclusao).getTime() : 0;
  const createdSort = row.data_criacao ? new Date(row.data_criacao).getTime() : 0;
  return {
    id: row.id,
    workspace: row.workspace,
    titulo: row.titulo,
    descricao: row.descricao || '',
    prioridade: row.prioridade,
    dataPrazo: toDateKey(row.data_prazo),
    horarioPrazo: toTimeKey(row.horario_prazo),
    status: row.status,
    atribuidoPara: row.atribuido_para,
    atribuidoParaNome: row.atribuido_para_nome || '',
    criadoPor: row.criado_por || '',
    criadoPorNome: row.criado_por_nome || (row.tipo === 'Diaria' && !row.criado_por ? 'Sistema' : 'Autoria não registrada'),
    solicitadoPor: row.solicitado_por || '',
    tarefaOrigemId: row.tarefa_origem_id || '',
    tipo: row.tipo,
    origemTemplateId: row.origem_template_id || '',
    obsConclusao: row.obs_conclusao || '',
    dataCriacao: toDateTime(row.data_criacao),
    dataCriacaoSort: createdSort,
    dataConclusao: toDateTime(row.data_conclusao),
    dataConclusaoKey: row.data_conclusao ? toDateKey(row.data_conclusao) : '',
    dataConclusaoSort: completedSort,
  };
}

function formatTemplate(row) {
  return {
    id: row.id,
    workspace: row.workspace,
    titulo: row.titulo,
    descricao: row.descricao || '',
    prioridade: row.prioridade,
    atribuidoPara: row.atribuido_para,
    criadoPor: row.criado_por || '',
    horarioPrazo: toTimeKey(row.horario_prazo),
    diasSemana: row.dias_semana || '1,2,3,4,5',
    diasSemanaLabel: weekdaysLabel(row.dias_semana || '1,2,3,4,5'),
  };
}

function formatComment(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    autorEmail: row.autor_email,
    dataHora: toDateTime(row.data_hora),
    mensagem: row.mensagem,
  };
}

function formatChecklistItem(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    titulo: row.titulo,
    concluido: row.concluido === true,
    dataCriacao: toDateTime(row.data_criacao),
    dataConclusao: toDateTime(row.data_conclusao),
  };
}

function formatHistoryItem(row) {
  return {
    autorNome: row.autor_nome || (['sistema','system'].includes(normalizeEmail(row.autor_email)) ? 'Sistema' : row.autor_email || 'Usuário não cadastrado'),
    id: row.id,
    taskId: row.task_id,
    autorEmail: row.autor_email,
    dataHora: toDateTime(row.data_hora),
    acao: row.acao,
    detalhes: row.detalhes || '',
    sort: row.data_hora ? new Date(row.data_hora).getTime() : 0,
  };
}

async function addHistory(taskId, authorEmail, action, details = '') {
  await query(
    'INSERT INTO historico (id, task_id, autor_email, acao, detalhes) VALUES ($1, $2, $3, $4, $5)',
    [makeId('HIS'), taskId, normalizeEmail(authorEmail || 'sistema'), action, details],
  );
}

async function ensureWorkspaceExists(workspace) {
  const result = await query('SELECT 1 FROM workspaces WHERE nome = $1 AND ativo = TRUE', [workspace]);
  if (!result.rowCount) throw new Error('Workspace invalido. Cadastre o workspace antes de usar.');
}

async function getUserByEmail(email) {
  const result = await query('SELECT u.*,ARRAY(SELECT recipient_id FROM analyst_recipients WHERE analyst_id=u.id) AS destinatarios_permitidos FROM usuarios u WHERE email = $1', [normalizeEmail(email)]);
  return result.rows[0] || null;
}

async function getTaskForUser(taskId, userEmail) {
  const result = await query('SELECT * FROM tarefas WHERE id = $1 AND atribuido_para = $2', [taskId, normalizeEmail(userEmail)]);
  if (!result.rowCount) throw new Error('Tarefa nao encontrada para este usuario.');
  return result.rows[0];
}

async function getTaskForParticipant(taskId, userEmail) {
  const result = await query(
    'SELECT * FROM tarefas WHERE id = $1 AND (atribuido_para = $2 OR solicitado_por = $2)',
    [taskId, normalizeEmail(userEmail)],
  );
  if (!result.rowCount) throw new Error('Tarefa nao encontrada para este usuario.');
  return result.rows[0];
}

export async function loginUser(email, senha) {
  const result = await query('SELECT * FROM usuarios WHERE email = $1 AND senha = $2', [
    normalizeEmail(email),
    String(senha || ''),
  ]);
  if (!result.rowCount) throw new Error('E-mail ou senha invalidos.');
  const user = sanitizeUser(result.rows[0]);
  return { ...user, token: signToken(user) };
}

export async function getWorkspaces() {
  const result = await query('SELECT * FROM workspaces WHERE ativo = TRUE ORDER BY nome');
  return result.rows.map(formatWorkspace);
}

export async function createWorkspace(workspaceData) {
  requireFields(workspaceData, ['nome']);
  const result = await query(
    `INSERT INTO workspaces (id, nome, descricao)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [makeId('WKS'), String(workspaceData.nome).trim(), workspaceData.descricao || ''],
  );
  return formatWorkspace(result.rows[0]);
}

export async function registerUser(userData) {
  requireFields(userData, ['nome','email','senha','perfil','workspace']);
  await ensureWorkspaceExists(userData.workspace);
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const result=await client.query(
      'INSERT INTO usuarios(id,nome,email,senha,perfil,workspace) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [makeId('USR'),userData.nome,normalizeEmail(userData.email),String(userData.senha),normalizeProfile(userData.perfil),userData.workspace]);
    await saveAnalystRecipients(client.query.bind(client),result.rows[0].id,normalizeProfile(userData.perfil),userData.destinatariosPermitidos || []);
    await saveUserPermissions(client.query.bind(client),result.rows[0].id,userData.permissoes);
    const saved=await client.query('SELECT * FROM usuarios WHERE id=$1',[result.rows[0].id]);
    await client.query('COMMIT');
    return sanitizeUser({...saved.rows[0],destinatarios_permitidos:userData.destinatariosPermitidos || []});
  } catch(error) {await client.query('ROLLBACK');throw error;}
  finally {client.release();}
}

export async function updateUser(userId, userData) {
  requireFields(userData, ['nome', 'email', 'perfil', 'workspace']);
  await ensureWorkspaceExists(userData.workspace);

  const current = await query('SELECT * FROM usuarios WHERE id = $1', [userId]);
  if (!current.rowCount) throw new Error('Usuario nao encontrado.');

  const oldEmail = normalizeEmail(current.rows[0].email);
  const newEmail = normalizeEmail(userData.email);
  const senha = String(userData.senha || '').trim() || current.rows[0].senha;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE usuarios
       SET nome = $2,
           email = $3,
           senha = $4,
           perfil = $5,
           workspace = $6
       WHERE id = $1
       RETURNING *`,
      [
        userId,
        userData.nome,
        newEmail,
        senha,
        normalizeProfile(userData.perfil),
        userData.workspace,
      ],
    );

    if (oldEmail !== newEmail) {
      await client.query('UPDATE tarefas SET atribuido_para = $2 WHERE atribuido_para = $1', [oldEmail, newEmail]);
      await client.query('UPDATE templates_diarios SET atribuido_para = $2 WHERE atribuido_para = $1', [oldEmail, newEmail]);
      await client.query('UPDATE tarefas SET criado_por = $2 WHERE criado_por = $1', [oldEmail, newEmail]);
      await client.query('UPDATE tarefas SET solicitado_por = $2 WHERE solicitado_por = $1', [oldEmail, newEmail]);
      await client.query('UPDATE templates_diarios SET criado_por = $2 WHERE criado_por = $1', [oldEmail, newEmail]);
      await client.query('UPDATE comentarios SET autor_email = $2 WHERE autor_email = $1', [oldEmail, newEmail]);
      await client.query('UPDATE historico SET autor_email = $2 WHERE autor_email = $1', [oldEmail, newEmail]);
    }

    await client.query('UPDATE tarefas SET criado_por_nome=$2 WHERE criado_por=$1',[newEmail,userData.nome]);
    await saveAnalystRecipients(client.query.bind(client),userId,normalizeProfile(userData.perfil),userData.destinatariosPermitidos);
    await saveUserPermissions(client.query.bind(client),userId,userData.permissoes);
    result.rows[0].permissoes=userData.permissoes || result.rows[0].permissoes;
    await client.query('COMMIT');
    return sanitizeUser({...result.rows[0],destinatarios_permitidos:userData.destinatariosPermitidos || []});
  } catch (error) {
    await client.query('ROLLBACK');
    if (String(error.message || '').includes('duplicate key')) {
      throw new Error('Este e-mail ja esta em uso por outro usuario.');
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteUser(userId, requesterEmail) {
  requireFields({ userId, requesterEmail }, ['userId', 'requesterEmail']);

  const current = await query('SELECT * FROM usuarios WHERE id = $1', [userId]);
  if (!current.rowCount) throw new Error('Usuario nao encontrado.');

  const user = current.rows[0];
  if (normalizeEmail(user.email) === normalizeEmail(requesterEmail)) {
    throw new Error('Voce nao pode excluir o proprio usuario logado.');
  }

  if (user.perfil === 'Admin') {
    const admins = await query('SELECT COUNT(*)::int AS total FROM usuarios WHERE perfil = $1', ['Admin']);
    if (Number(admins.rows[0].total || 0) <= 1) {
      throw new Error('Nao e possivel excluir o ultimo Admin.');
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM templates_diarios WHERE atribuido_para = $1', [normalizeEmail(user.email)]);
    await client.query('DELETE FROM usuarios WHERE id = $1', [userId]);
    await client.query('COMMIT');
    return { deleted: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function createTask(taskData) {
  requireFields(taskData, ['workspace', 'titulo', 'prioridade', 'dataPrazo', 'atribuidoPara']);
  await ensureWorkspaceExists(taskData.workspace);
  const assignedUser = await getUserByEmail(taskData.atribuidoPara);
  if (!assignedUser) throw new Error('Responsavel nao encontrado.');
  const status = taskData.status || 'Pendente';
  const result = await query(
    `INSERT INTO tarefas
      (id, workspace, titulo, descricao, prioridade, data_prazo, horario_prazo, status, atribuido_para, solicitado_por, tarefa_origem_id, tipo, data_conclusao, criado_por, criado_por_nome)
     VALUES ($1, $2, $3, $4, $5, $6, $7::time, $8, $9, $10, $11, 'Manual', $12, $13, (SELECT nome FROM usuarios WHERE email=$13))
     RETURNING *`,
    [
      makeId('TSK'),
      taskData.workspace,
      taskData.titulo,
      taskData.descricao || '',
      taskData.prioridade,
      taskData.dataPrazo,
      normalizeTime(taskData.horarioPrazo),
      status,
      normalizeEmail(taskData.atribuidoPara),
      taskData.solicitadoPor ? normalizeEmail(taskData.solicitadoPor) : null,
      taskData.tarefaOrigemId || null,
      status === 'Concluida' ? new Date() : null,
      taskData.autorEmail ? normalizeEmail(taskData.autorEmail) : null,
    ],
  );
  await addHistory(result.rows[0].id, taskData.autorEmail || 'sistema', 'Criou tarefa', taskData.titulo);
  return formatTask(result.rows[0]);
}

export async function createEmployeeTask(taskData, userEmail) {
  const user = await getUserByEmail(userEmail);
  if (!user) throw new Error('Usuario nao encontrado.');
  return createTask({
    ...taskData,
    workspace: user.workspace,
    atribuidoPara: user.email,
    status: 'Pendente',
    autorEmail: user.email,
  });
}

export async function getAllowedTaskRecipients(userEmail) {
  const result=await query(`SELECT recipient.id,recipient.nome,recipient.email,recipient.perfil,recipient.workspace
    FROM analyst_recipients permissions JOIN usuarios analyst ON analyst.id=permissions.analyst_id
    JOIN usuarios recipient ON recipient.id=permissions.recipient_id
    WHERE analyst.email=$1 AND analyst.permissoes->>'criarParaOutros'='true' AND recipient.perfil IN ('Admin','Colaborador')
    ORDER BY recipient.nome,recipient.id`,[normalizeEmail(userEmail)]);
  return result.rows.map(sanitizeUser);
}

export async function createAssignedTask(data,userEmail) {
  requireFields(data,['recipientId','titulo','prioridade','dataPrazo']);
  if(!['Baixa','Media','Alta','Urgente'].includes(data.prioridade)) throw Error('Prioridade inválida.');
  const result=await query(`INSERT INTO tarefas(id,workspace,titulo,descricao,prioridade,data_prazo,horario_prazo,status,
      atribuido_para,solicitado_por,tipo,criado_por,criado_por_nome)
    SELECT $1,recipient.workspace,$4,$5,$6,$7::date,$8::time,'Pendente',recipient.email,analyst.email,'Manual',analyst.email,analyst.nome
    FROM analyst_recipients permissions JOIN usuarios analyst ON analyst.id=permissions.analyst_id
    JOIN usuarios recipient ON recipient.id=permissions.recipient_id
    WHERE analyst.email=$2 AND analyst.permissoes->>'criarParaOutros'='true' AND recipient.id=$3
      AND recipient.perfil IN ('Admin','Colaborador') RETURNING *`,
    [makeId('TSK'),normalizeEmail(userEmail),data.recipientId,String(data.titulo).trim(),String(data.descricao || ''),
      data.prioridade,data.dataPrazo,normalizeTime(data.horarioPrazo)]);
  if(!result.rowCount) throw Error('Você não tem permissão para criar tarefas para essa pessoa. Peça ao administrador para atualizar seu cadastro.');
  await addHistory(result.rows[0].id,normalizeEmail(userEmail),'Criou tarefa',String(data.titulo).trim());
  return formatTask(result.rows[0]);
}

export async function updateTask(taskId, taskData) {
  requireFields(taskData, ['workspace', 'titulo', 'prioridade', 'dataPrazo', 'status', 'atribuidoPara']);
  await ensureWorkspaceExists(taskData.workspace);
  const assignedUser = await getUserByEmail(taskData.atribuidoPara);
  if (!assignedUser) throw new Error('Responsavel nao encontrado.');
  const current = await query('SELECT * FROM tarefas WHERE id = $1', [taskId]);
  if (!current.rowCount) throw new Error('Tarefa nao encontrada.');
  const completedAt = taskData.status === 'Concluida'
    ? (current.rows[0].data_conclusao || new Date())
    : null;
  const result = await query(
    `UPDATE tarefas
     SET workspace = $2, titulo = $3, descricao = $4, prioridade = $5, data_prazo = $6,
         horario_prazo = $7::time, status = $8, atribuido_para = $9, data_conclusao = $10
     WHERE id = $1
     RETURNING *`,
    [
      taskId,
      taskData.workspace,
      taskData.titulo,
      taskData.descricao || '',
      taskData.prioridade,
      taskData.dataPrazo,
      normalizeTime(taskData.horarioPrazo),
      taskData.status,
      normalizeEmail(taskData.atribuidoPara),
      completedAt,
    ],
  );
  await addHistory(taskId, taskData.autorEmail || 'admin', 'Editou tarefa', taskData.titulo);
  return formatTask(result.rows[0]);
}

export async function updateOwnTask(taskId, data, userEmail) {
  requireFields(data, ['titulo', 'prioridade', 'dataPrazo', 'status']);
  if (!['Baixa','Media','Alta','Urgente'].includes(data.prioridade)) throw Error('Prioridade inválida.');
  if (!['Pendente','Em Andamento','Concluida'].includes(data.status)) throw Error('Status inválido.');
  const result = await query(`UPDATE tarefas SET titulo=$3, descricao=$4, prioridade=$5,
      data_prazo=$6::date, horario_prazo=$7::time, status=$8,
      data_conclusao=CASE WHEN $8='Concluida' THEN COALESCE(data_conclusao,NOW()) ELSE NULL END,
      obs_conclusao=CASE WHEN $8='Concluida' THEN $9 ELSE '' END
    WHERE id=$1 AND atribuido_para=$2 RETURNING *`,
    [taskId, normalizeEmail(userEmail), String(data.titulo).trim(), String(data.descricao || ''),
      data.prioridade, data.dataPrazo, normalizeTime(data.horarioPrazo), data.status, String(data.obsConclusao || '').trim()]);
  if (!result.rowCount) throw Error('Você só pode editar tarefas atribuídas a você.');
  await addHistory(taskId, normalizeEmail(userEmail), 'Editou tarefa', String(data.titulo).trim());
  return formatTask(result.rows[0]);
}

export async function deleteTask(taskId) {
  const current = await query('SELECT * FROM tarefas WHERE id = $1', [taskId]);
  if (!current.rowCount) throw new Error('Tarefa nao encontrada.');
  await markDailyTaskAsIgnored(current.rows[0]);

  const result = await query('DELETE FROM tarefas WHERE id = $1 RETURNING *', [taskId]);
  if (!result.rowCount) throw new Error('Tarefa nao encontrada.');
  return { deleted: true };
}

export async function updateTaskStatus(taskId, newStatus, userEmail, completionNote = '') {
  await getTaskForUser(taskId, userEmail);
  const note = newStatus === 'Concluida' ? String(completionNote || '').trim() : '';
  const result = await query(
    `UPDATE tarefas
     SET status = $2,
         data_conclusao = CASE WHEN $2 = 'Concluida' THEN COALESCE(data_conclusao, NOW()) ELSE NULL END,
         obs_conclusao = CASE WHEN $2 = 'Concluida' THEN $3 ELSE '' END
     WHERE id = $1
     RETURNING *`,
    [taskId, newStatus, note],
  );
  await addHistory(taskId, userEmail, 'Alterou status', newStatus);
  if (note) await addHistory(taskId, userEmail, 'Observacao ao concluir', note);
  return formatTask(result.rows[0]);
}

export async function getEmployeeTasks(userEmail) {
  await generateDailyTasks();
  const result = await query(
    `SELECT t.*,COALESCE(u.nome,t.criado_por_nome) AS criado_por_nome FROM tarefas t LEFT JOIN usuarios u ON u.email=t.criado_por WHERE t.atribuido_para=$1 ORDER BY t.data_prazo,t.horario_prazo NULLS LAST,t.data_criacao`,
    [normalizeEmail(userEmail)],
  );
  return result.rows.map(formatTask);
}

export async function getSentTasks(userEmail) {
  const user = await getUserByEmail(userEmail);
  if (!user) throw new Error('Usuario nao encontrado.');
  const result = await query(
    `SELECT t.*,COALESCE(u.nome,t.criado_por_nome) AS criado_por_nome,recipient.nome AS atribuido_para_nome
     FROM tarefas t LEFT JOIN usuarios u ON u.email=t.criado_por
     LEFT JOIN usuarios recipient ON recipient.email=t.atribuido_para
     WHERE t.solicitado_por=$1 OR (t.criado_por=$1 AND t.atribuido_para<>$1)
     ORDER BY t.data_criacao DESC,t.data_prazo,t.horario_prazo NULLS LAST`,
    [normalizeEmail(userEmail)],
  );
  return result.rows.map(formatTask);
}

export async function getAdminDashboardData() {
  await generateDailyTasks();
  const [tasksResult, usersResult, workspaces, templatesResult] = await Promise.all([
    query('SELECT t.*,COALESCE(u.nome,t.criado_por_nome) AS criado_por_nome FROM tarefas t LEFT JOIN usuarios u ON u.email=t.criado_por ORDER BY t.data_prazo,t.horario_prazo NULLS LAST,t.data_criacao'),
    query(`SELECT u.*,ARRAY(SELECT recipient_id FROM analyst_recipients WHERE analyst_id=u.id) AS destinatarios_permitidos FROM usuarios u ORDER BY nome`),
    getWorkspaces(),
    query('SELECT * FROM templates_diarios ORDER BY titulo, id'),
  ]);
  const tasks = tasksResult.rows.map(formatTask);
  const users = usersResult.rows.map(sanitizeUser);
  const colaboradores = users;
  return {
    tasks,
    usuarios: users,
    colaboradores,
    workspaces,
    recurringTemplates: templatesResult.rows.map(formatTemplate),
    todayPanel: buildAdminTodayPanel(tasks, colaboradores),
    stats: {
      pendentes: tasks.filter((task) => task.status === 'Pendente').length,
      emAndamento: tasks.filter((task) => task.status === 'Em Andamento').length,
      concluidas: tasks.filter((task) => task.status === 'Concluida').length,
      total: tasks.length,
    },
  };
}

function buildAdminTodayPanel(tasks, colaboradores) {
  const today = todayKey();
  const active = tasks.filter((task) => task.status !== 'Concluida');
  const atrasadas = active.filter((task) => task.dataPrazo && task.dataPrazo < today);
  const hoje = active.filter((task) => task.dataPrazo === today);
  const porColaborador = colaboradores.map((user) => {
    const userTasks = active.filter((task) => normalizeEmail(task.atribuidoPara) === normalizeEmail(user.email));
    return {
      nome: user.nome,
      email: user.email,
      atrasadas: userTasks.filter((task) => task.dataPrazo && task.dataPrazo < today).length,
      hoje: userTasks.filter((task) => task.dataPrazo === today).length,
      andamento: userTasks.filter((task) => task.status === 'Em Andamento').length,
      pendentes: userTasks.filter((task) => task.status === 'Pendente').length,
      total: userTasks.length,
    };
  });
  return { atrasadas, hoje, porColaborador };
}

export async function createDailyTemplate(templateData) {
  requireFields(templateData, ['workspace', 'titulo', 'prioridade', 'atribuidoPara']);
  await ensureWorkspaceExists(templateData.workspace);
  const assignedUser = await getUserByEmail(templateData.atribuidoPara);
  if (!assignedUser) throw new Error('Responsavel nao encontrado.');
  const result = await query(
    `INSERT INTO templates_diarios
      (id, workspace, titulo, descricao, prioridade, atribuido_para, horario_prazo, dias_semana, criado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7::time, $8, $9)
     RETURNING *`,
    [
      makeId('TPL'),
      templateData.workspace,
      templateData.titulo,
      templateData.descricao || '',
      templateData.prioridade,
      normalizeEmail(templateData.atribuidoPara),
      normalizeTime(templateData.horarioPrazo),
      normalizeWeekdays(templateData.diasSemana),
      templateData.autorEmail ? normalizeEmail(templateData.autorEmail) : null,
    ],
  );
  return formatTemplate(result.rows[0]);
}

export async function updateDailyTemplate(templateId, data) {
  requireFields(data, ['workspace', 'titulo', 'prioridade', 'atribuidoPara', 'diasSemana']);
  if (!['Baixa', 'Media', 'Alta', 'Urgente'].includes(data.prioridade)) throw new Error('Prioridade inválida.');
  if (!String(data.diasSemana).split(',').every(day => /^[0-6]$/.test(day.trim()))) throw new Error('Dias da semana inválidos.');
  await ensureWorkspaceExists(data.workspace);
  if (!await getUserByEmail(data.atribuidoPara)) throw new Error('Responsável não encontrado.');
  const result = await query(
    `UPDATE templates_diarios SET workspace = $2, titulo = $3, descricao = $4,
      prioridade = $5, atribuido_para = $6, horario_prazo = $7::time, dias_semana = $8
      WHERE id = $1 RETURNING *`,
    [templateId, data.workspace, String(data.titulo).trim(), data.descricao || '', data.prioridade,
      normalizeEmail(data.atribuidoPara), normalizeTime(data.horarioPrazo), normalizeWeekdays(data.diasSemana)],
  );
  if (!result.rowCount) throw new Error('Repetição não encontrada. Atualize a lista.');
  return formatTemplate(result.rows[0]);
}

export async function deleteDailyTemplate(templateId) {
  const result = await query('DELETE FROM templates_diarios WHERE id = $1 RETURNING id', [templateId]);
  if (!result.rowCount) throw new Error('Repetição não encontrada. Atualize a lista.');
  return { deleted: true };
}

export async function getEmployeeDailyTemplates(userEmail) {
  const result = await query(
    'SELECT * FROM templates_diarios WHERE atribuido_para = $1 ORDER BY titulo',
    [normalizeEmail(userEmail)],
  );
  return result.rows.map(formatTemplate);
}

export async function createEmployeeDailyTemplate(templateData, userEmail) {
  const user = await getUserByEmail(userEmail);
  if (!user) throw new Error('Usuario nao encontrado.');
  const template = await createDailyTemplate({
    ...templateData,
    workspace: user.workspace,
    atribuidoPara: user.email,
    autorEmail: user.email,
  });
  if (String(templateData.criarHoje || '').toLowerCase() === 'true') {
    await createTaskFromTemplate(template, todayKey());
  }
  return template;
}

export async function deleteEmployeeDailyTemplate(templateId, userEmail) {
  const result = await query(
    'DELETE FROM templates_diarios WHERE id = $1 AND atribuido_para = $2 RETURNING *',
    [templateId, normalizeEmail(userEmail)],
  );
  if (!result.rowCount) throw new Error('Modelo diario nao encontrado para este usuario.');
  return { deleted: true };
}

async function createTaskFromTemplate(template, dateKey) {
  const generation = await query(
    'SELECT 1 FROM geracoes_diarias WHERE template_id = $1 AND data_prazo = $2',
    [template.id, dateKey],
  );
  if (generation.rowCount) return false;

  const exists = await query(
    `SELECT id FROM tarefas
     WHERE data_prazo = $1
       AND tipo = 'Diaria'
       AND (
         origem_template_id = $2
         OR (
           origem_template_id IS NULL
           AND workspace = $3
           AND titulo = $4
           AND atribuido_para = $5
         )
       )
     ORDER BY data_criacao ASC
     LIMIT 1`,
    [dateKey, template.id, template.workspace, template.titulo, normalizeEmail(template.atribuidoPara)],
  );
  if (exists.rowCount) {
    await query('UPDATE tarefas SET origem_template_id = $2 WHERE id = $1 AND origem_template_id IS NULL', [exists.rows[0].id, template.id]);
    await registerDailyGeneration(template.id, dateKey, exists.rows[0].id, false);
    return false;
  }

  const result = await query(
    `INSERT INTO tarefas
      (id, workspace, titulo, descricao, prioridade, data_prazo, horario_prazo, status, atribuido_para, tipo, origem_template_id, criado_por, criado_por_nome)
     VALUES ($1, $2, $3, $4, $5, $6, $7::time, 'Pendente', $8, 'Diaria', $9, $10, (SELECT nome FROM usuarios WHERE email=$10))
     RETURNING *`,
    [
      makeId('TSK'),
      template.workspace,
      template.titulo,
      template.descricao || '',
      template.prioridade || 'Media',
      dateKey,
      normalizeTime(template.horarioPrazo),
      normalizeEmail(template.atribuidoPara),
      template.id,
      template.criadoPor || null,
    ],
  );
  await registerDailyGeneration(template.id, dateKey, result.rows[0].id, false);
  await addHistory(result.rows[0].id, 'sistema', 'Gerou tarefa diaria', template.titulo);
  return true;
}

async function registerDailyGeneration(templateId, dateKey, taskId = null, ignored = false) {
  if (!templateId || !dateKey) return;
  await query(
    `INSERT INTO geracoes_diarias (template_id, data_prazo, task_id, ignorada)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (template_id, data_prazo) DO UPDATE
     SET task_id = COALESCE(geracoes_diarias.task_id, EXCLUDED.task_id),
         ignorada = geracoes_diarias.ignorada OR EXCLUDED.ignorada`,
    [templateId, dateKey, taskId, Boolean(ignored)],
  );
}

async function markDailyTaskAsIgnored(task) {
  if (!task || task.tipo !== 'Diaria' || !task.data_prazo) return;

  let templateId = task.origem_template_id || '';
  const dateKey = toDateKey(task.data_prazo);

  if (!templateId) {
    const weekday = weekdayKey(dateKey);
    const candidates = await query(
      `SELECT id
       FROM templates_diarios
       WHERE workspace = $1
         AND atribuido_para = $2
         AND (
           titulo = $3
           OR (
             SELECT COUNT(*)
             FROM templates_diarios t2
             WHERE t2.workspace = $1
               AND t2.atribuido_para = $2
               AND POSITION($4 IN t2.dias_semana) > 0
           ) = 1
         )
         AND POSITION($4 IN dias_semana) > 0
       ORDER BY titulo
       LIMIT 1`,
      [task.workspace, normalizeEmail(task.atribuido_para), task.titulo, weekday],
    );
    templateId = candidates.rows[0]?.id || '';
  }

  if (templateId) await registerDailyGeneration(templateId, dateKey, task.id, true);
}

export async function generateDailyTasks() {
  const client = await pool.connect();
  try {
    const lock = await client.query("SELECT pg_try_advisory_lock(hashtext('doctorhouse-daily-generation')) AS locked");
    if (!lock.rows[0].locked) return { created: 0 };
    try { return await generateDailyTasksUnlocked(); }
    finally { await client.query("SELECT pg_advisory_unlock(hashtext('doctorhouse-daily-generation'))"); }
  } finally { client.release(); }
}

async function generateDailyTasksUnlocked() {
  const date = todayKey();
  const weekday = weekdayKey(date);
  const result = await query('SELECT * FROM templates_diarios ORDER BY titulo');
  let created = 0;
  for (const row of result.rows) {
    const template = formatTemplate(row);
    const days = template.diasSemana.split(',').map((day) => day.trim());
    if (!days.includes(weekday)) continue;
    if (await createTaskFromTemplate(template, date)) created += 1;
  }
  return { created };
}

export async function addComment(taskId, commentText, userEmail) {
  await getTaskForParticipant(taskId, userEmail);
  requireFields({ commentText }, ['commentText']);
  const result = await query(
    `INSERT INTO comentarios (id, task_id, autor_email, mensagem)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [makeId('COM'), taskId, normalizeEmail(userEmail), commentText],
  );
  await addHistory(taskId, userEmail, 'Comentou', commentText);
  return formatComment(result.rows[0]);
}

export async function getTaskComments(taskId) {
  const result = await query('SELECT * FROM comentarios WHERE task_id = $1 ORDER BY data_hora ASC', [taskId]);
  return result.rows.map(formatComment);
}

export async function getTaskChecklist(taskId) {
  const result = await query('SELECT * FROM checklist WHERE task_id = $1 ORDER BY data_criacao ASC', [taskId]);
  return result.rows.map(formatChecklistItem);
}

export async function addChecklistItem(taskId, title, userEmail) {
  await getTaskForUser(taskId, userEmail);
  requireFields({ title }, ['title']);
  const result = await query(
    `INSERT INTO checklist (id, task_id, titulo)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [makeId('CHK'), taskId, title],
  );
  await addHistory(taskId, userEmail, 'Criou subtarefa', title);
  return formatChecklistItem(result.rows[0]);
}

export async function updateChecklistItem(itemId, done, userEmail) {
  const item = await query(
    `SELECT checklist.*, tarefas.atribuido_para
     FROM checklist
     JOIN tarefas ON tarefas.id = checklist.task_id
     WHERE checklist.id = $1`,
    [itemId],
  );
  if (!item.rowCount || normalizeEmail(item.rows[0].atribuido_para) !== normalizeEmail(userEmail)) {
    throw new Error('Subtarefa nao encontrada para este usuario.');
  }
  const result = await query(
    `UPDATE checklist
     SET concluido = $2, data_conclusao = CASE WHEN $2 = TRUE THEN COALESCE(data_conclusao, NOW()) ELSE NULL END
     WHERE id = $1
     RETURNING *`,
    [itemId, Boolean(done)],
  );
  await addHistory(result.rows[0].task_id, userEmail, Boolean(done) ? 'Concluiu subtarefa' : 'Reabriu subtarefa', result.rows[0].titulo);
  return formatChecklistItem(result.rows[0]);
}

export async function deleteChecklistItem(itemId, userEmail) {
  const item = await query(
    `SELECT checklist.*, tarefas.atribuido_para
     FROM checklist
     JOIN tarefas ON tarefas.id = checklist.task_id
     WHERE checklist.id = $1`,
    [itemId],
  );
  if (!item.rowCount || normalizeEmail(item.rows[0].atribuido_para) !== normalizeEmail(userEmail)) {
    throw new Error('Subtarefa nao encontrada para este usuario.');
  }
  await query('DELETE FROM checklist WHERE id = $1', [itemId]);
  await addHistory(item.rows[0].task_id, userEmail, 'Excluiu subtarefa', item.rows[0].titulo);
  return { deleted: true };
}

export async function getTaskHistory(taskId) {
  const result = await query('SELECT h.*,u.nome AS autor_nome FROM historico h LEFT JOIN usuarios u ON u.email=LOWER(TRIM(h.autor_email)) WHERE h.task_id=$1 ORDER BY h.data_hora DESC,h.id DESC', [taskId]);
  return result.rows.map(formatHistoryItem);
}

export async function getNotificationSettings() {
  const result = await query('SELECT value FROM app_settings WHERE key = $1', ['notification_sound']);
  const settings = result.rows[0]?.value || { ...DEFAULT_NOTIFICATION_SETTINGS };
  // Retired sounds must also disappear from previously saved team preferences.
  if (String(settings.sound).startsWith('meme-')) return { ...settings, sound: 'original' };
  return settings;
}

export async function saveNotificationSettings(data) {
  const settings = validateNotificationSettings(data);
  await query('INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', ['notification_sound', JSON.stringify(settings)]);
  return settings;
}

const rpc = {
  getNotificationSettings,
  saveNotificationSettings,
  loginUser,
  getAdminDashboardData,
  getWorkspaces,
  createWorkspace,
  createTask,
  createEmployeeTask,
  getAllowedTaskRecipients,
  createAssignedTask,
  forwardTask,
  getForwardRecipients,
  getCurrentUser: async()=>null,
  updateTask,
  updateOwnTask,
  deleteTask,
  registerUser,
  updateUser,
  deleteUser,
  getEmployeeTasks,
  getSentTasks,
  updateTaskStatus,
  createDailyTemplate,
  updateDailyTemplate,
  deleteDailyTemplate,
  getEmployeeDailyTemplates,
  createEmployeeDailyTemplate,
  deleteEmployeeDailyTemplate,
  addComment,
  getTaskComments,
  getTaskChecklist,
  addChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
  getTaskHistory,
  generateDailyTasks,
};

const adminOnly = new Set([
  'saveNotificationSettings',
  'getAdminDashboardData',
  'getWorkspaces',
  'createWorkspace',
  'createTask',
  'updateTask',
  'registerUser',
  'updateUser',
  'deleteUser',
  'createDailyTemplate',
  'updateDailyTemplate',
  'deleteDailyTemplate',
  'generateDailyTasks',
]);

const emailArgIndex = {
  getEmployeeTasks: 0,
  getSentTasks: 0,
  getAllowedTaskRecipients: 0,
  createAssignedTask: 1,
  getEmployeeDailyTemplates: 0,
  createEmployeeDailyTemplate: 1,
  createEmployeeTask: 1,
  deleteEmployeeDailyTemplate: 1,
  updateTaskStatus: 2,
  updateOwnTask: 2,
  addComment: 2,
  addChecklistItem: 2,
  updateChecklistItem: 2,
  deleteChecklistItem: 1,
  deleteUser: 1,
  deleteTask: 1,
  forwardTask: 2,
  getForwardRecipients: 0,
};

function authorizeRpc(functionName, args, req) {
  if (functionName === 'loginUser') return;
  const user = getBearerUser(req);
  if (adminOnly.has(functionName) && user.perfil !== 'Admin') {
    throw new Error('Acesso permitido apenas para Admin.');
  }
  const index = emailArgIndex[functionName];
  if (index !== undefined && user.perfil !== 'Admin' && normalizeEmail(args[index]) !== normalizeEmail(user.email)) {
    throw new Error('Voce so pode acessar dados do proprio usuario.');
  }
  if (['getAllowedTaskRecipients', 'createAssignedTask'].includes(functionName) && normalizeEmail(args[emailArgIndex[functionName]]) !== normalizeEmail(user.email)) {
    throw new Error('Usuário inválido.');
  }
  if (functionName === 'deleteUser' && normalizeEmail(args[1]) !== normalizeEmail(user.email)) {
    throw new Error('Usuário inválido.');
  }
  // Creation ownership always comes from the signed session, never the form.
  if (['createTask','createDailyTemplate'].includes(functionName)) args[0] = {...args[0],autorEmail:user.email};
  if (functionName === 'updateTask') args[1] = {...args[1],autorEmail:user.email};
  if (['createEmployeeTask','createEmployeeDailyTemplate'].includes(functionName)) args[1] = user.email;
  if (functionName === 'updateOwnTask') args[2] = user.email;
  if (functionName === 'createAssignedTask') args[1] = user.email;
  if (functionName === 'deleteTask') args[1] = user.email;
  if (functionName === 'forwardTask') args[2] = user.email;
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/pwa', async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    try {
      await init();
      const identity = getBearerUser(req);
      const user = await getUserByEmail(identity.email);
      if (!user) return res.status(401).json({error:'Sessão inválida.'});
      if (req.method === 'GET' && req.path === '/session') return res.json(sanitizeUser(user));
      if (req.method === 'GET' && req.path === '/key') return res.json({publicKey:await pushService.publicKey()});
      if (req.method === 'POST' && req.path === '/subscription') return res.json(await pushService.subscribe(user.email,req.body));
      if (req.method === 'DELETE' && req.path === '/subscription') return res.json(await pushService.unsubscribe(user.email,req.body.endpoint));
      if (req.method === 'POST' && req.path === '/test') return res.json(await pushService.test(user.email,req.body.endpoint));
      res.status(404).json({error:'Recurso não encontrado.'});
    } catch(error) { res.status(/Sessao|Sessão/.test(error.message) ? 401 : 400).json({error:error.message}); }
  });
  app.use(express.static(PUBLIC_DIR, {
    setHeaders(res, filePath) {
      if (/\.(html|css|js)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      }
    },
  }));

  app.post('/api/rpc/:functionName', async (req, res) => {
    try {
      await init();
      const fn = rpc[req.params.functionName];
      if (!fn) throw new Error('Funcao nao encontrada.');
      const args = req.body.args || [];
      authorizeRpc(req.params.functionName, args, req);
      const actor=req.params.functionName!=='loginUser' ? await authorizeTaskOperation(query,req.params.functionName,args,getBearerUser(req),adminOnly) : null;
      const result = req.params.functionName==='getCurrentUser' ? sanitizeUser(await getUserByEmail(getBearerUser(req).email)) : await fn(...args);
      if(req.params.functionName==='getAdminDashboardData') result.currentUser=result.usuarios.find(user=>user.email===actor.email) || sanitizeUser(actor);
      if (['createTask','createEmployeeTask','createAssignedTask','forwardTask','updateTask','updateOwnTask','updateTaskStatus','generateDailyTasks','createDailyTemplate','createEmployeeDailyTemplate'].includes(req.params.functionName)) {
        void pushService.dispatch().catch(() => console.error('Falha ao despachar notificações; a fila será reprocessada.'));
      }
      res.json({ ok: true, result });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message || 'Erro no servidor.' });
    }
  });

  app.get('/health', async (_req, res) => {
    await init();
    res.json({ ok: true });
  });

  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  return app;
}


export async function getForwardRecipients(userEmail) {
  const result=await query("SELECT recipient.* FROM analyst_recipients allowed JOIN usuarios actor ON actor.id=allowed.analyst_id JOIN usuarios recipient ON recipient.id=allowed.recipient_id WHERE actor.email=$1 AND actor.permissoes->>'encaminharTarefas'='true' AND recipient.email<>actor.email AND recipient.perfil IN ('Admin','Colaborador') ORDER BY recipient.nome",[normalizeEmail(userEmail)]);
  return result.rows.map(sanitizeUser);
}
export async function forwardTask(taskId,recipientId,userEmail) {
  const result=await query(`UPDATE tarefas t SET atribuido_para=recipient.email,workspace=recipient.workspace
    FROM usuarios actor,usuarios recipient
    WHERE t.id=$1 AND t.atribuido_para=$3 AND actor.email=$3
      AND actor.permissoes->>'encaminharTarefas'='true'
      AND recipient.id=$2 AND recipient.perfil IN ('Admin','Colaborador') AND recipient.email<>actor.email
      AND EXISTS(SELECT 1 FROM analyst_recipients allowed WHERE allowed.analyst_id=actor.id AND allowed.recipient_id=recipient.id)
    RETURNING t.*`,[taskId,recipientId,normalizeEmail(userEmail)]);
  if(!result.rowCount)throw Error('Você não tem permissão para encaminhar esta tarefa para essa pessoa.');
  const recipient=await getUserByEmail(result.rows[0].atribuido_para);
  await addHistory(taskId,normalizeEmail(userEmail),'Encaminhou tarefa','Para: '+recipient.nome);
  return formatTask(result.rows[0]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT || 3000;
  createApp().listen(port, () => {
    console.log(`Dashboard de tarefas rodando na porta ${port}`);
  });
  // The installed app can be closed: generation and delivery run on the server.
  let backgroundBusy = false, lastGeneration = 0;
  const tick = async () => {
    if (backgroundBusy) return;
    backgroundBusy = true;
    try {
      await init();
      if (Date.now() - lastGeneration > 60000) {
        lastGeneration = Date.now();
        try { await generateDailyTasks(); }
        catch { console.error('Falha na geração diária; o envio de notificações continuará.'); }
      }
      await pushService.dispatch();
    } catch { console.error('Falha temporária no serviço de notificações; nova tentativa em 15 segundos.'); }
    finally { backgroundBusy = false; }
  };
  setInterval(tick,15000).unref();
  void tick();
}
