function initAdminRecurrences() {
  document.querySelector('#recurrenceSearch').addEventListener('input', renderAdminRecurrences);
  document.querySelector('#recurrenceEmployee').addEventListener('change', renderAdminRecurrences);
  document.querySelector('#clearRecurrenceFilters').addEventListener('click', () => {
    document.querySelector('#recurrenceSearch').value = '';
    document.querySelector('#recurrenceEmployee').value = '';
    renderAdminRecurrences();
  });
}

function recurrenceSchedule(template) {
  const days = [...new Set(String(template.diasSemana || '1,2,3,4,5').split(','))].sort().join(',');
  if (days === '0,1,2,3,4,5,6') return 'Todos os dias';
  if (days === '1,2,3,4,5') return 'Dias úteis · segunda a sexta';
  return `Toda semana · ${template.diasSemanaLabel || days}`;
}

function filterAdminRecurrences(templates, users, search, employee) {
  return templates.filter(template => {
    const user = users.find(item => item.email === template.atribuidoPara);
    return (!employee || template.atribuidoPara === employee) &&
      matchesTaskSearch({ ...template, descricao: `${template.descricao || ''} ${user?.nome || ''} ${recurrenceSchedule(template)}` }, search);
  }).sort((a, b) => String(a.titulo).localeCompare(String(b.titulo), 'pt-BR') || String(a.id).localeCompare(String(b.id)));
}

function renderAdminRecurrences() {
  const templates = adminData.recurringTemplates || [];
  const users = adminData.usuarios || [];
  const select = document.querySelector('#recurrenceEmployee');
  const previous = select.value;
  const emails = [...new Set(templates.map(template => template.atribuidoPara))];
  const owners = emails.map(email => ({ email, name: users.find(user => user.email === email)?.nome || email })).sort((a,b) => a.name.localeCompare(b.name, 'pt-BR'));
  const options = '<option value="">Todos os responsáveis</option>' + owners.map(owner => `<option value="${escapeHtml(owner.email)}">${escapeHtml(owner.name)}</option>`).join('');
  if (select.innerHTML !== options) {
    select.innerHTML = options;
    select.value = emails.includes(previous) ? previous : '';
  }
  document.querySelector('#recurrenceTotal').textContent = `${templates.length} ${templates.length === 1 ? 'repetição cadastrada' : 'repetições cadastradas'}`;
  const visible = filterAdminRecurrences(templates, users, document.querySelector('#recurrenceSearch').value, select.value);
  document.querySelector('#recurrenceCount').textContent = `${visible.length} de ${templates.length} ${templates.length === 1 ? 'programação' : 'programações'}`;
  document.querySelector('#recurrenceList').innerHTML = visible.length ? visible.map(template => {
    const user = users.find(item => item.email === template.atribuidoPara);
    return `<article class="recurrence-card">
      <div class="recurrence-card-heading"><h3>${escapeHtml(template.titulo)}</h3>${priorityBadge(template.prioridade)}</div>
      ${template.descricao ? `<p class="recurrence-description">${taskDescriptionHtml(template.descricao)}</p>` : ''}
      <div class="recurrence-schedule"><span>↻ ${escapeHtml(recurrenceSchedule(template))}</span><span>◷ ${escapeHtml(template.horarioPrazo || 'Sem horário definido')}</span></div>
      <dl><div><dt>Responsável</dt><dd>${escapeHtml(user?.nome || template.atribuidoPara)}</dd><dd class="recurrence-email">${escapeHtml(template.atribuidoPara)}</dd></div><div><dt>Espaço</dt><dd>${escapeHtml(template.workspace)}</dd></div></dl>
    </article>`;
  }).join('') : `<p class="recurrence-empty">${templates.length ? 'Nenhuma repetição encontrada com estes filtros.' : 'Nenhuma tarefa com repetição cadastrada. Use o botão acima para criar a primeira.'}</p>`;
}
