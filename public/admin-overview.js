// Keep management categories exclusive and compare deadlines in the workspace timezone.
function buildManagementOverview(tasks, email = '', now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const part = name => parts.find(item => item.type === name).value;
  const current = part('year')+'-'+part('month')+'-'+part('day')+'T'+part('hour')+':'+part('minute');
  const selected = tasks.filter(task => !email || String(task.atribuidoPara).toLowerCase() === email.toLowerCase());
  const deadline = task => task.dataPrazo ? task.dataPrazo+'T'+(task.horarioPrazo || '23:59') : '9999';
  const overdue = task => !!task.dataPrazo && deadline(task) < current;
  const byDeadline = (a,b) => deadline(a).localeCompare(deadline(b)) || String(a.titulo).localeCompare(String(b.titulo));
  const active = selected.filter(task => task.status !== 'Concluida');
  return {
    overdue: active.filter(overdue).sort(byDeadline),
    pending: active.filter(task => !overdue(task)).sort(byDeadline),
    completed: selected.filter(task => task.status === 'Concluida').sort((a,b) => Number(b.dataConclusaoSort || 0)-Number(a.dataConclusaoSort || 0)),
    total: selected.length,
    pendingCount: active.filter(task => task.status === 'Pendente').length,
    progressCount: active.filter(task => task.status === 'Em Andamento').length
  };
}
