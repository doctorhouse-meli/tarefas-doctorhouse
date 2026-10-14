let completionNotifications = [];
let completionNotificationIds = null;
let completionPollBusy = false;

function resetCompletionNotifications() {
  completionNotificationIds = null;
  completionNotifications = [];
  $('#completionNotificationsPanel').classList.add('hidden');
  $('#completionNotificationsBtn').classList.add('hidden');
}

document.addEventListener('DOMContentLoaded', () => {
  $('#completionNotificationsBtn').addEventListener('click', () => {
    $('#completionNotificationsPanel').classList.toggle('hidden');
    void refreshCompletionNotifications();
  });
  setInterval(refreshCompletionNotifications, 10000);
});

  async function refreshCompletionNotifications() {
    if (!currentUser || currentUser.perfil !== 'Admin' || completionPollBusy) return;
    completionPollBusy = true;
    const email = currentUser.email;
    try {
      const items = await callServer('getCompletionNotifications', email);
      if (!currentUser || currentUser.email !== email) return;
      const firstLoad = completionNotificationIds === null;
      const fresh = items.filter((item) => !item.lida && completionNotificationIds && !completionNotificationIds.has(item.id));
      if (firstLoad && items.some((item) => !item.lida)) $('#completionNotificationsPanel').classList.remove('hidden');
      completionNotificationIds = new Set(items.map((item) => item.id));
      completionNotifications = items;
      $('#completionNotificationsBtn').classList.remove('hidden');
      $('#completionNotificationsCount').textContent = items.filter((item) => !item.lida).length;
      $('#completionNotificationsList').innerHTML = items.length ? items.map((item) => `
        <article class="rounded-md border p-3 ${item.lida ? 'bg-white border-slate-200' : 'bg-sky-50 border-sky-300'}">
          <button type="button" data-completion-open="${escapeHtml(item.id)}" class="text-left w-full">
            <strong>${escapeHtml(item.autor)} concluiu: ${escapeHtml(item.titulo)}</strong>
            <div class="text-sm text-slate-500">${escapeHtml(new Date(item.data_hora).toLocaleString('pt-BR'))}${item.lida ? ' - Lida' : ' - Nao lida'}</div>
            ${item.obs_conclusao ? `<p class="text-sm whitespace-pre-wrap mt-2">${escapeHtml(item.obs_conclusao)}</p>` : ''}
          </button>
          ${item.lida ? '' : `<button type="button" data-completion-read="${escapeHtml(item.id)}" class="btn-secondary mt-2">Marcar como lida</button>`}
        </article>`).join('') : '<p class="text-slate-500">Nenhuma conclusao registrada.</p>';
      $$('[data-completion-open]').forEach((button) => button.addEventListener('click', async () => {
        try {
          const item = completionNotifications.find((entry) => entry.id === button.dataset.completionOpen);
          const data = await callServer('getAdminDashboardData');
          const task = data.tasks.find((entry) => entry.id === item.task_id);
          if (!task) throw new Error('Tarefa nao encontrada.');
          await openTaskDetails(task);
          await callServer('markCompletionRead', item.id, email);
          await refreshCompletionNotifications();
        } catch (error) { showTaskAlert('Nao foi possivel abrir a tarefa', error.message); }
      }));
      $$('[data-completion-read]').forEach((button) => button.addEventListener('click', async () => {
        try {
          await callServer('markCompletionRead', button.dataset.completionRead, email);
          await refreshCompletionNotifications();
        } catch (error) { showTaskAlert('Nao foi possivel marcar como lida', error.message); }
      }));
      if (fresh.length) {
        startTitleAlert('Tarefa concluida!');
        showTaskAlert('Tarefa concluida', `${fresh[0].autor}: ${fresh[0].titulo}. Veja em Conclusoes.`);
        playNotificationSound();
        showBrowserStatusNotification('Tarefa concluida', `${fresh[0].autor}: ${fresh[0].titulo}`, `conclusao-${fresh[0].id}`);
      }
    } catch (error) { console.log('Falha ao carregar conclusoes.', error); }
    finally { completionPollBusy = false; }
  }



