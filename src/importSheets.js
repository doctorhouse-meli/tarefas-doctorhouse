import fs from 'node:fs/promises';
import path from 'node:path';
import { closeDb, initDb, makeId, query } from './db.js';

const inputPath = process.argv[2] || 'data/sheets-export.json';

function rows(exportData, sheetName) {
  if (Array.isArray(exportData[sheetName])) return exportData[sheetName];
  return exportData.sheets?.[sheetName] || [];
}

function value(row, keys, fallback = '') {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return row[key];
    }
  }
  return fallback;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeBool(input, fallback = true) {
  if (input === true || input === false) return input;
  const text = String(input ?? '').trim().toLowerCase();
  if (['false', 'falso', '0', 'nao', 'não', 'inativo'].includes(text)) return false;
  if (['true', 'verdadeiro', '1', 'sim', 'ativo'].includes(text)) return true;
  return fallback;
}

function normalizeDate(input) {
  if (!input) return null;
  if (input instanceof Date) return input.toISOString().slice(0, 10);
  const text = String(input).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function normalizeDateTime(input) {
  if (!input) return null;
  const text = String(input).trim();
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeTime(input) {
  if (!input) return null;
  const text = String(input).trim();
  if (!text) return null;
  const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  return match ? `${match[1]}:${match[2]}` : null;
}

function normalizePriority(input) {
  const text = String(input || 'Media').trim();
  return ['Baixa', 'Media', 'Alta', 'Urgente'].includes(text) ? text : 'Media';
}

function normalizeStatus(input) {
  const text = String(input || 'Pendente').trim();
  return ['Pendente', 'Em Andamento', 'Concluida'].includes(text) ? text : 'Pendente';
}

function normalizeProfile(input) {
  const text = String(input || 'Colaborador').trim();
  return ['Admin', 'Colaborador', 'Solicitante'].includes(text) ? text : 'Colaborador';
}

function normalizeType(input) {
  const text = String(input || 'Manual').trim();
  return ['Manual', 'Diaria'].includes(text) ? text : 'Manual';
}

function normalizeWeekdays(input) {
  const days = String(input || '1,2,3,4,5')
    .split(',')
    .map((day) => day.trim())
    .filter((day) => ['0', '1', '2', '3', '4', '5', '6'].includes(day));
  return [...new Set(days)].join(',') || '1,2,3,4,5';
}

function validId(input, prefix) {
  return String(input || '').trim() || makeId(prefix);
}

async function ensureWorkspace(nome, descricao = '') {
  await query(
    `INSERT INTO workspaces (id, nome, descricao, ativo)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (nome) DO NOTHING`,
    [makeId('WKS'), nome || 'Principal', descricao || ''],
  );
}

async function taskExists(taskId) {
  if (!taskId) return false;
  const result = await query('SELECT 1 FROM tarefas WHERE id = $1', [taskId]);
  return result.rowCount > 0;
}

async function importWorkspaces(workspaces, users, tasks, templates) {
  const names = new Map();

  workspaces.forEach((row) => {
    const nome = String(value(row, ['Nome', 'nome'], 'Principal')).trim() || 'Principal';
    names.set(nome, {
      id: validId(value(row, ['ID', 'id']), 'WKS'),
      nome,
      descricao: value(row, ['Descricao', 'Descrição', 'descricao'], ''),
      ativo: normalizeBool(value(row, ['Ativo', 'ativo'], true), true),
      dataCriacao: normalizeDateTime(value(row, ['DataCriacao', 'DataCriação', 'dataCriacao', 'data_criacao'], '')),
    });
  });

  [...users, ...tasks, ...templates].forEach((row) => {
    const nome = String(value(row, ['Workspace', 'workspace'], 'Principal')).trim() || 'Principal';
    if (!names.has(nome)) {
      names.set(nome, { id: makeId('WKS'), nome, descricao: 'Importado do Sheets', ativo: true, dataCriacao: null });
    }
  });

  for (const workspace of names.values()) {
    await query(
      `INSERT INTO workspaces (id, nome, descricao, ativo, data_criacao)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()))
       ON CONFLICT (nome) DO UPDATE
       SET descricao = EXCLUDED.descricao,
           ativo = EXCLUDED.ativo`,
      [workspace.id, workspace.nome, workspace.descricao, workspace.ativo, workspace.dataCriacao],
    );
  }

  return names.size;
}

async function importUsers(users) {
  let count = 0;
  for (const row of users) {
    const email = normalizeEmail(value(row, ['Email', 'email']));
    if (!email) continue;
    const workspace = String(value(row, ['Workspace', 'workspace'], 'Principal')).trim() || 'Principal';
    await ensureWorkspace(workspace);
    await query(
      `INSERT INTO usuarios (id, nome, email, senha, perfil, workspace)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO UPDATE
       SET nome = EXCLUDED.nome,
           senha = EXCLUDED.senha,
           perfil = EXCLUDED.perfil,
           workspace = EXCLUDED.workspace`,
      [
        validId(value(row, ['ID', 'id']), 'USR'),
        value(row, ['Nome', 'nome'], email),
        email,
        String(value(row, ['Senha', 'senha'], '123456')),
        normalizeProfile(value(row, ['Perfil (Admin/Colaborador)', 'Perfil', 'perfil'], 'Colaborador')),
        workspace,
      ],
    );
    count += 1;
  }
  return count;
}

async function importTasks(tasks) {
  let count = 0;
  for (const row of tasks) {
    const title = value(row, ['Titulo', 'Título', 'titulo']);
    const assignedTo = normalizeEmail(value(row, ['AtribuidoPara (Email)', 'AtribuídoPara (Email)', 'AtribuidoPara', 'atribuidoPara']));
    if (!title || !assignedTo) continue;
    const workspace = String(value(row, ['Workspace', 'workspace'], 'Principal')).trim() || 'Principal';
    await ensureWorkspace(workspace);
    await query(
      `INSERT INTO tarefas
        (id, workspace, titulo, descricao, prioridade, data_prazo, horario_prazo, status, atribuido_para, tipo, data_criacao, data_conclusao)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, CURRENT_DATE), $7::time, $8, $9, $10, COALESCE($11::timestamptz, NOW()), $12::timestamptz)
       ON CONFLICT (id) DO UPDATE
       SET workspace = EXCLUDED.workspace,
           titulo = EXCLUDED.titulo,
           descricao = EXCLUDED.descricao,
           prioridade = EXCLUDED.prioridade,
           data_prazo = EXCLUDED.data_prazo,
           horario_prazo = EXCLUDED.horario_prazo,
           status = EXCLUDED.status,
           atribuido_para = EXCLUDED.atribuido_para,
           tipo = EXCLUDED.tipo,
           data_criacao = EXCLUDED.data_criacao,
           data_conclusao = EXCLUDED.data_conclusao`,
      [
        validId(value(row, ['ID', 'id']), 'TSK'),
        workspace,
        title,
        value(row, ['Descricao', 'Descrição', 'descricao'], ''),
        normalizePriority(value(row, ['Prioridade (Baixa/Media/Alta/Urgente)', 'Prioridade', 'prioridade'], 'Media')),
        normalizeDate(value(row, ['DataPrazo', 'dataPrazo', 'data_prazo'])),
        normalizeTime(value(row, ['HorarioPrazo', 'HorárioPrazo', 'Horario', 'Horário', 'horarioPrazo', 'horario_prazo'])),
        normalizeStatus(value(row, ['Status (Pendente/Em Andamento/Concluida)', 'Status', 'status'], 'Pendente')),
        assignedTo,
        normalizeType(value(row, ['Tipo (Manual/Diaria)', 'Tipo', 'tipo'], 'Manual')),
        normalizeDateTime(value(row, ['DataCriacao', 'DataCriação', 'dataCriacao', 'data_criacao'])),
        normalizeDateTime(value(row, ['DataConclusao', 'DataConclusão', 'dataConclusao', 'data_conclusao'])),
      ],
    );
    count += 1;
  }
  return count;
}

async function importTemplates(templates) {
  let count = 0;
  for (const row of templates) {
    const title = value(row, ['Titulo', 'Título', 'titulo']);
    const assignedTo = normalizeEmail(value(row, ['AtribuidoPara (Email)', 'AtribuídoPara (Email)', 'AtribuidoPara', 'atribuidoPara']));
    if (!title || !assignedTo) continue;
    const workspace = String(value(row, ['Workspace', 'workspace'], 'Principal')).trim() || 'Principal';
    await ensureWorkspace(workspace);
    await query(
      `INSERT INTO templates_diarios
        (id, workspace, titulo, descricao, prioridade, atribuido_para, horario_prazo, dias_semana)
       VALUES ($1, $2, $3, $4, $5, $6, $7::time, $8)
       ON CONFLICT (id) DO UPDATE
       SET workspace = EXCLUDED.workspace,
           titulo = EXCLUDED.titulo,
           descricao = EXCLUDED.descricao,
           prioridade = EXCLUDED.prioridade,
           atribuido_para = EXCLUDED.atribuido_para,
           horario_prazo = EXCLUDED.horario_prazo,
           dias_semana = EXCLUDED.dias_semana`,
      [
        validId(value(row, ['ID', 'id']), 'TPL'),
        workspace,
        title,
        value(row, ['Descricao', 'Descrição', 'descricao'], ''),
        normalizePriority(value(row, ['Prioridade', 'prioridade'], 'Media')),
        assignedTo,
        normalizeTime(value(row, ['HorarioPrazo', 'HorárioPrazo', 'Horario', 'Horário', 'horarioPrazo', 'horario_prazo'])),
        normalizeWeekdays(value(row, ['DiasSemana', 'diasSemana', 'dias_semana'], '1,2,3,4,5')),
      ],
    );
    count += 1;
  }
  return count;
}

async function importComments(comments) {
  let count = 0;
  for (const row of comments) {
    const taskId = value(row, ['TaskID', 'taskId', 'task_id']);
    const message = value(row, ['Mensagem', 'mensagem']);
    if (!taskId || !message) continue;
    if (!(await taskExists(taskId))) continue;
    await query(
      `INSERT INTO comentarios (id, task_id, autor_email, data_hora, mensagem)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()), $5)
       ON CONFLICT (id) DO UPDATE
       SET task_id = EXCLUDED.task_id,
           autor_email = EXCLUDED.autor_email,
           data_hora = EXCLUDED.data_hora,
           mensagem = EXCLUDED.mensagem`,
      [
        validId(value(row, ['ID', 'id']), 'COM'),
        taskId,
        normalizeEmail(value(row, ['AutorEmail', 'autorEmail', 'autor_email'], 'sistema')),
        normalizeDateTime(value(row, ['DataHora', 'dataHora', 'data_hora'])),
        message,
      ],
    );
    count += 1;
  }
  return count;
}

async function importChecklist(items) {
  let count = 0;
  for (const row of items) {
    const taskId = value(row, ['TaskID', 'taskId', 'task_id']);
    const title = value(row, ['Titulo', 'Título', 'titulo']);
    if (!taskId || !title) continue;
    if (!(await taskExists(taskId))) continue;
    await query(
      `INSERT INTO checklist (id, task_id, titulo, concluido, data_criacao, data_conclusao)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()), $6::timestamptz)
       ON CONFLICT (id) DO UPDATE
       SET task_id = EXCLUDED.task_id,
           titulo = EXCLUDED.titulo,
           concluido = EXCLUDED.concluido,
           data_criacao = EXCLUDED.data_criacao,
           data_conclusao = EXCLUDED.data_conclusao`,
      [
        validId(value(row, ['ID', 'id']), 'CHK'),
        taskId,
        title,
        normalizeBool(value(row, ['Concluido', 'Concluído', 'concluido'], false), false),
        normalizeDateTime(value(row, ['DataCriacao', 'DataCriação', 'dataCriacao', 'data_criacao'])),
        normalizeDateTime(value(row, ['DataConclusao', 'DataConclusão', 'dataConclusao', 'data_conclusao'])),
      ],
    );
    count += 1;
  }
  return count;
}

async function importHistory(items) {
  let count = 0;
  for (const row of items) {
    const action = value(row, ['Acao', 'Ação', 'acao'], '');
    if (!action) continue;
    const taskId = value(row, ['TaskID', 'taskId', 'task_id'], null);
    const safeTaskId = await taskExists(taskId) ? taskId : null;
    await query(
      `INSERT INTO historico (id, task_id, autor_email, data_hora, acao, detalhes)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()), $5, $6)
       ON CONFLICT (id) DO UPDATE
       SET task_id = EXCLUDED.task_id,
           autor_email = EXCLUDED.autor_email,
           data_hora = EXCLUDED.data_hora,
           acao = EXCLUDED.acao,
           detalhes = EXCLUDED.detalhes`,
      [
        validId(value(row, ['ID', 'id']), 'HIS'),
        safeTaskId,
        normalizeEmail(value(row, ['AutorEmail', 'autorEmail', 'autor_email'], 'sistema')),
        normalizeDateTime(value(row, ['DataHora', 'dataHora', 'data_hora'])),
        action,
        value(row, ['Detalhes', 'detalhes'], ''),
      ],
    );
    count += 1;
  }
  return count;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Configure DATABASE_URL antes de importar.');
  }

  const absolutePath = path.resolve(inputPath);
  const exportData = JSON.parse(await fs.readFile(absolutePath, 'utf8'));

  await initDb();

  const data = {
    workspaces: rows(exportData, 'Workspaces'),
    users: rows(exportData, 'Usuarios'),
    tasks: rows(exportData, 'Tarefas'),
    templates: rows(exportData, 'TemplatesDiarios'),
    comments: rows(exportData, 'Comentarios'),
    checklist: rows(exportData, 'Checklist'),
    history: rows(exportData, 'Historico'),
  };

  const summary = {};
  summary.workspaces = await importWorkspaces(data.workspaces, data.users, data.tasks, data.templates);
  summary.usuarios = await importUsers(data.users);
  summary.tarefas = await importTasks(data.tasks);
  summary.templatesDiarios = await importTemplates(data.templates);
  summary.comentarios = await importComments(data.comments);
  summary.checklist = await importChecklist(data.checklist);
  summary.historico = await importHistory(data.history);

  console.table(summary);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
