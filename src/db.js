import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
});

export async function query(text, params = []) {
  return pool.query(text, params);
}

export async function closeDb() {
  await pool.end();
}

export async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL UNIQUE,
      descricao TEXT DEFAULT '',
      ativo BOOLEAN DEFAULT TRUE,
      data_criacao TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      senha TEXT NOT NULL,
      perfil TEXT NOT NULL CHECK (perfil IN ('Admin', 'Colaborador')),
      workspace TEXT NOT NULL REFERENCES workspaces(nome)
    );

    CREATE TABLE IF NOT EXISTS tarefas (
      id TEXT PRIMARY KEY,
      workspace TEXT NOT NULL REFERENCES workspaces(nome),
      titulo TEXT NOT NULL,
      descricao TEXT DEFAULT '',
      prioridade TEXT NOT NULL DEFAULT 'Media',
      data_prazo DATE NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pendente',
      atribuido_para TEXT NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'Manual',
      data_criacao TIMESTAMPTZ DEFAULT NOW(),
      data_conclusao TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS templates_diarios (
      id TEXT PRIMARY KEY,
      workspace TEXT NOT NULL REFERENCES workspaces(nome),
      titulo TEXT NOT NULL,
      descricao TEXT DEFAULT '',
      prioridade TEXT NOT NULL DEFAULT 'Media',
      atribuido_para TEXT NOT NULL,
      dias_semana TEXT NOT NULL DEFAULT '1,2,3,4,5'
    );

    CREATE TABLE IF NOT EXISTS comentarios (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
      autor_email TEXT NOT NULL,
      data_hora TIMESTAMPTZ DEFAULT NOW(),
      mensagem TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS checklist (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
      titulo TEXT NOT NULL,
      concluido BOOLEAN DEFAULT FALSE,
      data_criacao TIMESTAMPTZ DEFAULT NOW(),
      data_conclusao TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS historico (
      id TEXT PRIMARY KEY,
      task_id TEXT REFERENCES tarefas(id) ON DELETE CASCADE,
      autor_email TEXT NOT NULL,
      data_hora TIMESTAMPTZ DEFAULT NOW(),
      acao TEXT NOT NULL,
      detalhes TEXT DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_tarefas_atribuido_para ON tarefas(atribuido_para);
    CREATE INDEX IF NOT EXISTS idx_tarefas_prazo ON tarefas(data_prazo);
    CREATE INDEX IF NOT EXISTS idx_templates_diarios_email ON templates_diarios(atribuido_para);
  `);

  await query(`
    INSERT INTO workspaces (id, nome, descricao)
    VALUES ($1, 'Principal', 'Workspace padrao')
    ON CONFLICT (nome) DO NOTHING
  `, [makeId('WKS')]);

  await query(`
    INSERT INTO usuarios (id, nome, email, senha, perfil, workspace)
    VALUES ($1, 'Administrador', 'admin@empresa.com', '123456', 'Admin', 'Principal')
    ON CONFLICT (email) DO NOTHING
  `, [makeId('USR')]);
}

export function makeId(prefix) {
  const random = crypto.randomUUID().slice(0, 8).toUpperCase();
  return `${prefix}-${random}`;
}
