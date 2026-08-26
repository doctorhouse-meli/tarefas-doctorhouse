import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;

pg.types.setTypeParser(1082, (value) => value);

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
      horario_prazo TIME,
      status TEXT NOT NULL DEFAULT 'Pendente',
      atribuido_para TEXT NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'Manual',
      origem_template_id TEXT,
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
      horario_prazo TIME,
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

    CREATE TABLE IF NOT EXISTS chat_mensagens (
      id TEXT PRIMARY KEY,
      colaborador_email TEXT NOT NULL,
      autor_email TEXT NOT NULL,
      autor_perfil TEXT NOT NULL,
      destinatario_email TEXT,
      conversa_key TEXT,
      data_hora TIMESTAMPTZ DEFAULT NOW(),
      mensagem TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS geracoes_diarias (
      template_id TEXT NOT NULL,
      data_prazo DATE NOT NULL,
      task_id TEXT,
      ignorada BOOLEAN DEFAULT FALSE,
      data_registro TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (template_id, data_prazo)
    );

    CREATE INDEX IF NOT EXISTS idx_tarefas_atribuido_para ON tarefas(atribuido_para);
    CREATE INDEX IF NOT EXISTS idx_tarefas_prazo ON tarefas(data_prazo);
    CREATE INDEX IF NOT EXISTS idx_templates_diarios_email ON templates_diarios(atribuido_para);
    CREATE INDEX IF NOT EXISTS idx_chat_colaborador_data ON chat_mensagens(colaborador_email, data_hora);
  `);

  await query("ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS destinatario_email TEXT");
  await query("ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS conversa_key TEXT");
  await query("ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS horario_prazo TIME");
  await query("ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS origem_template_id TEXT");
  await query("ALTER TABLE templates_diarios ADD COLUMN IF NOT EXISTS horario_prazo TIME");
  await query(`
    CREATE TABLE IF NOT EXISTS geracoes_diarias (
      template_id TEXT NOT NULL,
      data_prazo DATE NOT NULL,
      task_id TEXT,
      ignorada BOOLEAN DEFAULT FALSE,
      data_registro TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (template_id, data_prazo)
    )
  `);
  await query("CREATE INDEX IF NOT EXISTS idx_tarefas_origem_template ON tarefas(origem_template_id)");
  await query("CREATE INDEX IF NOT EXISTS idx_chat_conversa_data ON chat_mensagens(conversa_key, data_hora)");
  await query(`
    UPDATE chat_mensagens
    SET destinatario_email = CASE
          WHEN LOWER(autor_email) = LOWER(colaborador_email)
            THEN COALESCE((SELECT email FROM usuarios WHERE perfil = 'Admin' ORDER BY nome LIMIT 1), autor_email)
          ELSE colaborador_email
        END
    WHERE destinatario_email IS NULL
  `);
  await query(`
    UPDATE chat_mensagens
    SET conversa_key = CASE
          WHEN LOWER(autor_email) < LOWER(destinatario_email)
            THEN LOWER(autor_email) || '|' || LOWER(destinatario_email)
          ELSE LOWER(destinatario_email) || '|' || LOWER(autor_email)
        END
    WHERE conversa_key IS NULL AND destinatario_email IS NOT NULL
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
