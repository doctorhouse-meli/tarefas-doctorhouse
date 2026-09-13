let recurrenceSaving = false;
let recurrenceRevision = 0;
let recurrenceEditingId = null;

function initAdminRecurrences() {
  document.querySelector('#recurrenceList').addEventListener('click', event => {
    const button = event.target.closest('[data-recurrence-action]');
    if (!button || recurrenceSaving || currentUser?.perfil !== 'Admin') return;
    const template = (adminData.recurringTemplates || []).find(item => item.id === button.dataset.id);
    if (!template) return;
    if (button.dataset.recurrenceAction === 'delete') deleteAdminRecurrence(template, button);
    else openRecurrenceEditor(template, button.dataset.recurrenceAction === 'assign');
  });
  document.querySelector('#recurrenceEditForm').addEventListener('submit', saveAdminRecurrence);
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
      <div class="recurrence-actions"><button type="button" class="btn-secondary" data-recurrence-action="edit" data-id="${escapeHtml(template.id)}">Editar</button><button type="button" class="btn-secondary" data-recurrence-action="assign" data-id="${escapeHtml(template.id)}">Trocar responsável</button><button type="button" class="text-button recurrence-delete" data-recurrence-action="delete" data-id="${escapeHtml(template.id)}">Excluir</button></div>
    </article>`;
  }).join('') : `<p class="recurrence-empty">${templates.length ? 'Nenhuma repetição encontrada com estes filtros.' : 'Nenhuma tarefa com repetição cadastrada. Use o botão acima para criar a primeira.'}</p>`;
}

function openRecurrenceEditor(template, focusOwner = false) {
  const form = document.querySelector('#recurrenceEditForm');
  form.reset();
  recurrenceEditingId = template.id;
  for (const [name, entries] of [
    ['atribuidoPara', (adminData.usuarios || []).map(user => [user.email, user.nome || user.email])],
    ['workspace', (adminData.workspaces || []).map(space => [space.nome, space.nome])]
  ]) {
    if (!entries.some(([value]) => value === template[name])) entries.push([template[name], template[name]]);
    form.elements.namedItem(name).innerHTML = entries.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
  }
  for (const name of ['titulo', 'descricao', 'prioridade', 'atribuidoPara', 'workspace', 'horarioPrazo']) form.elements.namedItem(name).value = template[name] || '';
  const days = String(template.diasSemana || '1,2,3,4,5').split(',');
  form.querySelectorAll('[name=diasSemana]').forEach(input => { input.checked = days.includes(input.value); });
  document.querySelector('#recurrenceEditError').textContent = '';
  openModal('recurrenceEditModal');
  if (focusOwner) requestAnimationFrame(() => form.elements.namedItem('atribuidoPara').focus());
}

async function saveAdminRecurrence(event) {
  event.preventDefault();
  if (recurrenceSaving || !recurrenceEditingId || currentUser?.perfil !== 'Admin') return;
  const form = event.target, errorBox = document.querySelector('#recurrenceEditError');
  const values = new FormData(form);
  const data = Object.fromEntries(['titulo', 'descricao', 'prioridade', 'atribuidoPara', 'workspace', 'horarioPrazo'].map(name => [name, values.get(name) || '']));
  data.diasSemana = values.getAll('diasSemana').join(',');
  if (!data.titulo.trim() || !data.diasSemana) { errorBox.textContent = 'Informe o título e selecione pelo menos um dia.'; return; }
  const id = recurrenceEditingId;
  recurrenceSaving = true;
  recurrenceRevision++;
  errorBox.textContent = '';
  const fieldset = document.querySelector('#recurrenceEditFields');
  fieldset.disabled = true;
  try {
    const saved = await callServer('updateDailyTemplate', id, data);
    adminData.recurringTemplates = (adminData.recurringTemplates || []).map(item => item.id === id ? saved : item);
  } catch (error) {
    errorBox.textContent = error.message || 'Não foi possível salvar. Tente novamente.';
    return;
  } finally {
    recurrenceSaving = false;
    fieldset.disabled = false;
  }
  recurrenceEditingId = null;
  closeModals();
  document.querySelector('#recurrenceSearch').value = '';
  document.querySelector('#recurrenceEmployee').value = '';
  renderAdminRecurrences();
  showToast('Repetição atualizada. As próximas tarefas usarão esta programação.');
}

async function deleteAdminRecurrence(template, button) {
  if (!confirm(`Excluir a repetição “${template.titulo}”?\n\nEla deixará de gerar novas tarefas. As tarefas já criadas serão mantidas.`)) return;
  recurrenceSaving = true;
  recurrenceRevision++;
  button.disabled = true;
  try {
    await callServer('deleteDailyTemplate', template.id);
    adminData.recurringTemplates = (adminData.recurringTemplates || []).filter(item => item.id !== template.id);
    renderAdminRecurrences();
    showToast('Repetição excluída. As tarefas já criadas foram mantidas.');
  } catch (error) {
    showToast(error.message || 'Não foi possível excluir. Tente novamente.');
  } finally {
    recurrenceSaving = false;
    button.disabled = false;
  }
}
