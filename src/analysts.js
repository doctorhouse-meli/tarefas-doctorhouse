export async function initAnalysts(query) {
  await query(`
    SELECT pg_advisory_xact_lock(hashtext('doctorhouse-analysts-migration'));
    CREATE TABLE IF NOT EXISTS analyst_recipients (
      analyst_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      recipient_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      PRIMARY KEY(analyst_id,recipient_id)
    );
    DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM app_settings WHERE key='user_permissions_migrated') THEN
      INSERT INTO analyst_recipients(analyst_id,recipient_id)
        SELECT actor.id,recipient.id FROM usuarios actor CROSS JOIN usuarios recipient
        WHERE actor.perfil='Admin' AND actor.id<>recipient.id
        ON CONFLICT DO NOTHING;
      INSERT INTO app_settings(key,value) VALUES('user_permissions_migrated','true'::jsonb);
    END IF; END $$;
    ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS criado_por_nome TEXT;
    UPDATE tarefas t SET criado_por=t.solicitado_por WHERE t.criado_por IS NULL AND t.solicitado_por IS NOT NULL
      AND EXISTS(SELECT 1 FROM usuarios u WHERE u.email=t.solicitado_por);
    UPDATE tarefas t SET criado_por_nome=u.nome FROM usuarios u
      WHERE t.criado_por=u.email AND t.criado_por_nome IS NULL;
    DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM app_settings WHERE key='analyst_normal_tasks_migrated') THEN
    UPDATE tarefas SET titulo=REGEXP_REPLACE(titulo,'^Pedido: ?',''),
      descricao=REGEXP_REPLACE(descricao,E'^Pedido feito por:[^\\n]*\\n?','')
      WHERE solicitado_por IS NOT NULL AND (titulo LIKE 'Pedido:%' OR descricao LIKE 'Pedido feito por:%');
    INSERT INTO app_settings(key,value) VALUES('analyst_normal_tasks_migrated','true'::jsonb);
    END IF; END $$;
  `);
}

export async function saveAnalystRecipients(query, analystId, profile, recipientIds) {
  // An older admin client omitting this field must not erase existing permissions.
  if (recipientIds === undefined) return;
  const ids = recipientIds;
  if (!Array.isArray(ids) || ids.some(id=>typeof id!=='string') || ids.length>1000) throw Error('Selecione os destinatários permitidos.');
  const unique=[...new Set(ids)];
  if(unique.length) {
    const valid=await query("SELECT id FROM usuarios WHERE id=ANY($1::text[]) AND perfil IN ('Admin','Colaborador') AND id<>$2",[unique,analystId]);
    if(valid.rowCount!==unique.length) throw Error('Selecione apenas administradores ou colaboradores cadastrados.');
  }
  await query('DELETE FROM analyst_recipients WHERE analyst_id=$1',[analystId]);
  if(unique.length) await query('INSERT INTO analyst_recipients(analyst_id,recipient_id) SELECT $1,UNNEST($2::text[])',[analystId,unique]);
}
