export async function initTaskOwnership(query) {
  await query(`
    ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS criado_por TEXT;
    ALTER TABLE templates_diarios ADD COLUMN IF NOT EXISTS criado_por TEXT;
    UPDATE tarefas t SET criado_por = h.autor_email
    FROM (
      SELECT DISTINCT ON (task_id) task_id, LOWER(TRIM(autor_email)) AS autor_email
      FROM historico WHERE acao = 'Criou tarefa' ORDER BY task_id, data_hora, id
    ) h
    WHERE t.id = h.task_id AND t.criado_por IS NULL
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.email = h.autor_email);
  `);
}
