import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, makeId, pool, query } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TZ = 'America/Sao_Paulo';
const SESSION_SECRET = process.env.SESSION_SECRET || 'troque-esta-chave-no-railway';

let initialized = false;

export async function init() {
  if (initialized) return;
  if (!process.env.DATABASE_URL) {
    throw new Error('Configure DATABASE_URL no Railway ou no arquivo .env local.');
  }
  await initDb();
  initialized = true;
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
    perfil: row.perfil,
    workspace: row.workspace,
  };
}

function signToken(user) {
  const payload = Buffer.from(JSON.stringify({
    email: user.email,
    perfil: user.perfil,
    workspace: user.workspace,
    exp: Date.now() + 1000 * 60 * 60 * 12,
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
  if (!data.exp || Date.now() > data.exp) throw new Error('Sessao expirada.');
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
  return {
    id: row.id,
    workspace: row.workspace,
    titulo: row.titulo,
    descricao: row.descricao || '',
    prioridade: row.prioridade,
    dataPrazo: toDateKey(row.data_prazo),
    status: row.status,
    atribuidoPara: row.atribuido_para,
    tipo: row.tipo,
    dataCriacao: toDateTime(row.data_criacao),
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
    id: row.id,
    taskId: row.task_id,
    autorEmail: row.autor_email,
    dataHora: toDateTime(row.data_hora),
    acao: row.acao,
    detalhes: row.detalhes || '',
    sort: row.data_hora ? new Date(row.data_hora).getTime() : 0,
  };
}

function formatChatMessage(row) {
  return {
    id: row.id,
    colaboradorEmail: row.colaborador_email,
    autorEmail: row.autor_email,
    autorPerfil: row.autor_perfil,
    dataHora: toDateTime(row.data_hora),
    mensagem: row.mensagem,
    sort: row.data_hora ? new Date(row.data_hora).getTime() : 0,
  };
}

async function cleanupOldChatMessages() {
  await query("DELETE FROM chat_mensagens WHERE data_hora < NOW() - INTERVAL '24 hours'");
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
  const result = await query('SELECT * FROM usuarios WHERE email = $1', [normalizeEmail(email)]);
  return result.rows[0] || null;
}

async function getTaskForUser(taskId, userEmail) {
  const result = await query('SELECT * FROM tarefas WHERE id = $1 AND atribuido_para = $2', [taskId, normalizeEmail(userEmail)]);
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
  requireFields(userData, ['nome', 'email', 'senha', 'perfil', 'workspace']);
  await ensureWorkspaceExists(userData.workspace);
  const result = await query(
    `INSERT INTO usuarios (id, nome, email, senha, perfil, workspace)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      makeId('USR'),
      userData.nome,
      normalizeEmail(userData.email),
      String(userData.senha),
      userData.perfil,
      userData.workspace,
    ],
  );
  return sanitizeUser(result.rows[0]);
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
        userData.perfil === 'Admin' ? 'Admin' : 'Colaborador',
        userData.workspace,
      ],
    );

    if (oldEmail !== newEmail) {
      await client.query('UPDATE tarefas SET atribuido_para = $2 WHERE atribuido_para = $1', [oldEmail, newEmail]);
      await client.query('UPDATE templates_diarios SET atribuido_para = $2 WHERE atribuido_para = $1', [oldEmail, newEmail]);
      await client.query('UPDATE comentarios SET autor_email = $2 WHERE autor_email = $1', [oldEmail, newEmail]);
      await client.query('UPDATE historico SET autor_email = $2 WHERE autor_email = $1', [oldEmail, newEmail]);
    }

    await client.query('COMMIT');
    return sanitizeUser(result.rows[0]);
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

export async function createTask(taskData) {
  requireFields(taskData, ['workspace', 'titulo', 'prioridade', 'dataPrazo', 'atribuidoPara']);
  await ensureWorkspaceExists(taskData.workspace);
  const status = taskData.status || 'Pendente';
  const result = await query(
    `INSERT INTO tarefas
      (id, workspace, titulo, descricao, prioridade, data_prazo, status, atribuido_para, tipo, data_conclusao)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Manual', $9)
     RETURNING *`,
    [
      makeId('TSK'),
      taskData.workspace,
      taskData.titulo,
      taskData.descricao || '',
      taskData.prioridade,
      taskData.dataPrazo,
      status,
      normalizeEmail(taskData.atribuidoPara),
      status === 'Concluida' ? new Date() : null,
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

export async function updateTask(taskId, taskData) {
  requireFields(taskData, ['workspace', 'titulo', 'prioridade', 'dataPrazo', 'status', 'atribuidoPara']);
  await ensureWorkspaceExists(taskData.workspace);
  const current = await query('SELECT * FROM tarefas WHERE id = $1', [taskId]);
  if (!current.rowCount) throw new Error('Tarefa nao encontrada.');
  const completedAt = taskData.status === 'Concluida'
    ? (current.rows[0].data_conclusao || new Date())
    : null;
  const result = await query(
    `UPDATE tarefas
     SET workspace = $2, titulo = $3, descricao = $4, prioridade = $5, data_prazo = $6,
         status = $7, atribuido_para = $8, data_conclusao = $9
     WHERE id = $1
     RETURNING *`,
    [
      taskId,
      taskData.workspace,
      taskData.titulo,
      taskData.descricao || '',
      taskData.prioridade,
      taskData.dataPrazo,
      taskData.status,
      normalizeEmail(taskData.atribuidoPara),
      completedAt,
    ],
  );
  await addHistory(taskId, taskData.autorEmail || 'admin', 'Editou tarefa', taskData.titulo);
  return formatTask(result.rows[0]);
}

export async function deleteTask(taskId) {
  const result = await query('DELETE FROM tarefas WHERE id = $1 RETURNING *', [taskId]);
  if (!result.rowCount) throw new Error('Tarefa nao encontrada.');
  return { deleted: true };
}

export async function updateTaskStatus(taskId, newStatus, userEmail) {
  await getTaskForUser(taskId, userEmail);
  const result = await query(
    `UPDATE tarefas
     SET status = $2,
         data_conclusao = CASE WHEN $2 = 'Concluida' THEN COALESCE(data_conclusao, NOW()) ELSE NULL END
     WHERE id = $1
     RETURNING *`,
    [taskId, newStatus],
  );
  await addHistory(taskId, userEmail, 'Alterou status', newStatus);
  return formatTask(result.rows[0]);
}

export async function getEmployeeTasks(userEmail) {
  await generateDailyTasks();
  const result = await query(
    'SELECT * FROM tarefas WHERE atribuido_para = $1 ORDER BY data_prazo ASC, data_criacao DESC',
    [normalizeEmail(userEmail)],
  );
  return result.rows.map(formatTask);
}

export async function getAdminDashboardData() {
  await generateDailyTasks();
  const [tasksResult, usersResult, workspaces] = await Promise.all([
    query('SELECT * FROM tarefas ORDER BY data_prazo ASC, data_criacao DESC'),
    query('SELECT * FROM usuarios ORDER BY nome'),
    getWorkspaces(),
  ]);
  const tasks = tasksResult.rows.map(formatTask);
  const users = usersResult.rows.map(sanitizeUser);
  const colaboradores = users.filter((user) => user.perfil === 'Colaborador');
  return {
    tasks,
    usuarios: users,
    colaboradores,
    workspaces,
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
  const result = await query(
    `INSERT INTO templates_diarios
      (id, workspace, titulo, descricao, prioridade, atribuido_para, dias_semana)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      makeId('TPL'),
      templateData.workspace,
      templateData.titulo,
      templateData.descricao || '',
      templateData.prioridade,
      normalizeEmail(templateData.atribuidoPara),
      normalizeWeekdays(templateData.diasSemana),
    ],
  );
  return formatTemplate(result.rows[0]);
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
  const exists = await query(
    `SELECT 1 FROM tarefas
     WHERE workspace = $1 AND titulo = $2 AND atribuido_para = $3 AND data_prazo = $4 AND tipo = 'Diaria'`,
    [template.workspace, template.titulo, normalizeEmail(template.atribuidoPara), dateKey],
  );
  if (exists.rowCount) return false;

  const result = await query(
    `INSERT INTO tarefas
      (id, workspace, titulo, descricao, prioridade, data_prazo, status, atribuido_para, tipo)
     VALUES ($1, $2, $3, $4, $5, $6, 'Pendente', $7, 'Diaria')
     RETURNING *`,
    [
      makeId('TSK'),
      template.workspace,
      template.titulo,
      template.descricao || '',
      template.prioridade || 'Media',
      dateKey,
      normalizeEmail(template.atribuidoPara),
    ],
  );
  await addHistory(result.rows[0].id, 'sistema', 'Gerou tarefa diaria', template.titulo);
  return true;
}

export async function generateDailyTasks() {
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
  await getTaskForUser(taskId, userEmail);
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
  const result = await query('SELECT * FROM historico WHERE task_id = $1 ORDER BY data_hora DESC', [taskId]);
  return result.rows.map(formatHistoryItem);
}

export async function getChatContacts() {
  await cleanupOldChatMessages();
  const result = await query(`
    SELECT
      usuarios.id,
      usuarios.nome,
      usuarios.email,
      usuarios.workspace,
      MAX(chat_mensagens.data_hora) AS ultima_mensagem
    FROM usuarios
    LEFT JOIN chat_mensagens ON chat_mensagens.colaborador_email = usuarios.email
    WHERE usuarios.perfil = 'Colaborador'
    GROUP BY usuarios.id, usuarios.nome, usuarios.email, usuarios.workspace
    ORDER BY MAX(chat_mensagens.data_hora) DESC NULLS LAST, usuarios.nome ASC
  `);
  return result.rows.map((row) => ({
    id: row.id,
    nome: row.nome,
    email: row.email,
    workspace: row.workspace,
    ultimaMensagem: toDateTime(row.ultima_mensagem),
  }));
}

export async function getChatMessages(collaboratorEmail) {
  await cleanupOldChatMessages();
  const result = await query(
    `SELECT *
     FROM chat_mensagens
     WHERE colaborador_email = $1
       AND data_hora >= NOW() - INTERVAL '24 hours'
     ORDER BY data_hora ASC`,
    [normalizeEmail(collaboratorEmail)],
  );
  return result.rows.map(formatChatMessage);
}

export async function sendChatMessage(collaboratorEmail, message, senderEmail) {
  requireFields({ collaboratorEmail, message, senderEmail }, ['collaboratorEmail', 'message', 'senderEmail']);
  await cleanupOldChatMessages();

  const sender = await getUserByEmail(senderEmail);
  if (!sender) throw new Error('Usuario remetente nao encontrado.');

  const collaborator = await getUserByEmail(collaboratorEmail);
  if (!collaborator || collaborator.perfil !== 'Colaborador') {
    throw new Error('Colaborador nao encontrado.');
  }

  const result = await query(
    `INSERT INTO chat_mensagens (id, colaborador_email, autor_email, autor_perfil, mensagem)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      makeId('MSG'),
      normalizeEmail(collaboratorEmail),
      normalizeEmail(senderEmail),
      sender.perfil,
      String(message).trim(),
    ],
  );

  return formatChatMessage(result.rows[0]);
}

const rpc = {
  loginUser,
  getAdminDashboardData,
  getWorkspaces,
  createWorkspace,
  createTask,
  createEmployeeTask,
  updateTask,
  deleteTask,
  registerUser,
  updateUser,
  getEmployeeTasks,
  updateTaskStatus,
  createDailyTemplate,
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
  getChatContacts,
  getChatMessages,
  sendChatMessage,
  generateDailyTasks,
};

const adminOnly = new Set([
  'getAdminDashboardData',
  'getWorkspaces',
  'createWorkspace',
  'createTask',
  'updateTask',
  'deleteTask',
  'registerUser',
  'updateUser',
  'createDailyTemplate',
  'getChatContacts',
  'generateDailyTasks',
]);

const emailArgIndex = {
  getEmployeeTasks: 0,
  getEmployeeDailyTemplates: 0,
  createEmployeeDailyTemplate: 1,
  createEmployeeTask: 1,
  deleteEmployeeDailyTemplate: 1,
  updateTaskStatus: 2,
  addComment: 2,
  addChecklistItem: 2,
  updateChecklistItem: 2,
  deleteChecklistItem: 1,
  getChatMessages: 0,
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
  if (functionName === 'sendChatMessage') {
    const collaboratorEmail = normalizeEmail(args[0]);
    const senderEmail = normalizeEmail(args[2]);
    if (senderEmail !== normalizeEmail(user.email)) throw new Error('Remetente invalido.');
    if (user.perfil !== 'Admin' && collaboratorEmail !== normalizeEmail(user.email)) {
      throw new Error('Voce so pode conversar no proprio chat.');
    }
  }
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
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
      const result = await fn(...args);
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT || 3000;
  createApp().listen(port, () => {
    console.log(`Dashboard de tarefas rodando na porta ${port}`);
  });
}
