import webpush from 'web-push';

export function validateSubscription(value) {
  let url;
  try { url = new URL(value?.endpoint); } catch { throw Error('Inscrição de notificações inválida.'); }
  const allowed = ['web.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com'];
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash ||
    !(allowed.includes(url.hostname) || /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname)) || url.href.length > 2048) {
    throw Error('Serviço de notificações não suportado.');
  }
  for (const [name, length] of [['p256dh',65],['auth',16]]) {
    const key = value?.keys?.[name];
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(key) || Buffer.from(key,'base64url').length !== length) throw Error('Chave de inscrição inválida.');
  }
  return { endpoint: url.href, keys: {p256dh:value.keys.p256dh,auth:value.keys.auth} };
}

export async function initPush(query) {
  await query(`
    SELECT pg_advisory_xact_lock(hashtext('doctorhouse-push-schema'));
    CREATE TABLE IF NOT EXISTS push_config (id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(id), keys JSONB NOT NULL);
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY, user_email TEXT NOT NULL REFERENCES usuarios(email) ON DELETE CASCADE ON UPDATE CASCADE,
      subscription JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS push_user_idx ON push_subscriptions(user_email);
    CREATE TABLE IF NOT EXISTS push_outbox (
      id BIGSERIAL PRIMARY KEY, endpoint TEXT NOT NULL REFERENCES push_subscriptions(endpoint) ON DELETE CASCADE,
      user_email TEXT NOT NULL, task_id TEXT NOT NULL, title TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS push_pending_idx ON push_outbox(available_at);
    CREATE OR REPLACE FUNCTION queue_task_push() RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        INSERT INTO push_outbox(endpoint,user_email,task_id,title)
          SELECT endpoint,user_email,NEW.id,'Nova tarefa recebida' FROM push_subscriptions WHERE user_email = NEW.atribuido_para;
      ELSE
        IF NEW.atribuido_para IS DISTINCT FROM OLD.atribuido_para THEN
          INSERT INTO push_outbox(endpoint,user_email,task_id,title)
            SELECT endpoint,user_email,NEW.id,'Tarefa atribuída a você' FROM push_subscriptions WHERE user_email = NEW.atribuido_para;
        END IF;
        IF NEW.status IS DISTINCT FROM OLD.status AND NEW.solicitado_por IS NOT NULL THEN
          INSERT INTO push_outbox(endpoint,user_email,task_id,title)
            SELECT endpoint,user_email,NEW.id,'Seu pedido foi atualizado' FROM push_subscriptions WHERE user_email = NEW.solicitado_por;
        END IF;
        IF COALESCE(NEW.obs_conclusao,'') <> '' AND NEW.obs_conclusao IS DISTINCT FROM OLD.obs_conclusao THEN
          INSERT INTO push_outbox(endpoint,user_email,task_id,title)
            SELECT s.endpoint,s.user_email,NEW.id,'Nova observação de conclusão' FROM push_subscriptions s JOIN usuarios u ON u.email = s.user_email WHERE u.perfil = 'Admin';
        END IF;
      END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS task_push_event ON tarefas;
    CREATE TRIGGER task_push_event AFTER INSERT OR UPDATE ON tarefas FOR EACH ROW EXECUTE FUNCTION queue_task_push();
  `);
  const existing = await query('SELECT keys FROM push_config WHERE id = TRUE');
  if (!existing.rowCount) await query('INSERT INTO push_config(id,keys) VALUES (TRUE,$1::jsonb) ON CONFLICT DO NOTHING',[JSON.stringify(webpush.generateVAPIDKeys())]);
}

export function createPushService(query, transport = webpush) {
  let keysPromise;
  const keys = () => keysPromise ||= query('SELECT keys FROM push_config WHERE id = TRUE').then(r => {
    if (!r.rows[0]) throw Error('Notificações ainda estão iniciando.');
    return r.rows[0].keys;
  }).catch(error => { keysPromise = null; throw error; });
  return {
    async publicKey() { return (await keys()).publicKey; },
    async subscribe(email, value) {
      const subscription = validateSubscription(value);
      // Rebinding a shared device must not deliver the previous user's queue.
      await query('DELETE FROM push_outbox WHERE endpoint = $1 AND user_email <> $2',[subscription.endpoint,email]);
      await query(`INSERT INTO push_subscriptions(endpoint,user_email,subscription) VALUES($1,$2,$3::jsonb)
        ON CONFLICT(endpoint) DO UPDATE SET user_email=EXCLUDED.user_email, subscription=EXCLUDED.subscription, updated_at=NOW()`,[subscription.endpoint,email,JSON.stringify(subscription)]);
      return {subscribed:true};
    },
    async unsubscribe(email, endpoint) {
      await query('DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_email=$2',[endpoint,email]);
      return {subscribed:false};
    },
    async test(email, endpoint) {
      const r=await query('SELECT endpoint FROM push_subscriptions WHERE endpoint=$1 AND user_email=$2',[endpoint,email]);
      if (!r.rowCount) throw Error('Ative as notificações neste aparelho primeiro.');
      await query(`INSERT INTO push_outbox(endpoint,user_email,task_id,title) VALUES($1,$2,'','Notificações ativadas')`,[endpoint,email]);
      return {queued:true};
    },
    async dispatch() {
      await query("DELETE FROM push_outbox WHERE attempts >= 5 OR created_at < NOW() - INTERVAL '1 day'");
      const r=await query(`UPDATE push_outbox SET attempts=attempts+1, available_at=NOW()+INTERVAL '60 seconds'
        WHERE id IN (SELECT id FROM push_outbox WHERE available_at<=NOW() ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED) RETURNING *`);
      if (!r.rowCount) return;
      const vapid=await keys();
      await Promise.all(r.rows.map(async event => {
        try {
          const target=await query('SELECT subscription FROM push_subscriptions WHERE endpoint=$1 AND user_email=$2',[event.endpoint,event.user_email]);
          if (target.rowCount) {
            const subscription=validateSubscription(target.rows[0].subscription);
            await transport.sendNotification(subscription,JSON.stringify({title:event.title,body:'Abra o Doctor House para conferir.',url:event.task_id ? '/?task='+encodeURIComponent(event.task_id) : '/',tag:'task-'+(event.task_id || event.id)}),{
              vapidDetails:{subject:'mailto:contato@doctorhouse.com.br',...vapid},TTL:86400,timeout:6000,urgency:'high'
            });
          }
          await query('DELETE FROM push_outbox WHERE id=$1',[event.id]);
        } catch(error) {
          console.error('Push delivery failed', {status:error.statusCode || 'network',attempt:event.attempts});
          if ([404,410].includes(error.statusCode)) await query('DELETE FROM push_subscriptions WHERE endpoint=$1',[event.endpoint]);
          // Other failures retain the leased event for a bounded retry.
        }
      }));
    }
  };
}
