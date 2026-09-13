/* Workspace presentation. All data operations continue through app.js. */
let taskSearch = '';
let taskSort = 'date';
let activeAdminTab = 'overview';
let modalReturnFocus = null;

function initWorkspaceUI() {
  $('#taskSearch').addEventListener('input', event => {
    taskSearch = event.target.value;
    renderEmployeeTasks(applyEmployeeTaskFilter(currentEmployeeTasks));
  });
  $('#taskSort').addEventListener('change', event => {
    taskSort = event.target.value;
    renderEmployeeTasks(applyEmployeeTaskFilter(currentEmployeeTasks));
  });
  $('#adminSearch').addEventListener('input', renderAdminTasks);
  $('#userSearch').addEventListener('input', renderAdminUsers);
  $$('[data-admin-tab]').forEach(button => button.addEventListener('click', () => setAdminTab(button.dataset.adminTab)));
  $('#clearTaskFilters').addEventListener('click', () => {
    taskSearch = ''; $('#taskSearch').value = ''; employeeTaskFilter = 'all';
    renderEmployeeSummary(currentEmployeeTasks);
    renderEmployeeTasks(applyEmployeeTaskFilter(currentEmployeeTasks));
  });
  const labels = { titulo: 'Título', descricao: 'Descrição', prioridade: 'Prioridade', dataPrazo: 'Prazo', status: 'Status', atribuidoPara: 'Responsável', workspace: 'Workspace', nome: 'Nome', email: 'E-mail', senha: 'Senha', perfil: 'Perfil de acesso', adminEmail: 'Administrador', obsConclusao: 'Observação de conclusão (opcional)' };
  $$('.modal input:not([type=hidden]):not([type=checkbox]), .modal textarea, .modal select').forEach((input, index) => {
    if (input.closest('label') || input.closest('.time-select') || input.closest('#commentForm, #checklistForm')) return;
    input.id ||= `field-${index}`;
    const label = document.createElement('label');
    label.className = 'field-label'; label.htmlFor = input.id;
    label.textContent = (labels[input.name] || input.placeholder || 'Campo') + (input.required ? ' *' : '');
    input.before(label); label.append(input);
  });
  $$('.modal').forEach(modal => {
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
    const heading = modal.querySelector('h2');
    if (heading) { heading.id ||= `${modal.id}-title`; modal.setAttribute('aria-labelledby', heading.id); }
    modal.addEventListener('click', event => { if (event.target === modal) closeModals(); });
  });
  document.addEventListener('keydown', event => {
    const modal = $$('.modal').find(item => !item.classList.contains('hidden'));
    if (!modal) return;
    if (event.key === 'Escape') closeModals();
    if (event.key !== 'Tab') return;
    const fields = Array.from(modal.querySelectorAll('button, input, select, textarea, a[href], [tabindex="0"]')).filter(item => !item.disabled && item.getClientRects().length);
    const first = fields[0], last = fields.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  // Keep asynchronous failures visible, including the existing form handlers.
  window.addEventListener('unhandledrejection', event => { showToast(event.reason?.message || 'Não foi possível salvar. Tente novamente.'); });
  $('#toast').setAttribute('role', 'status');
  setAdminTab('overview');
}

function setAdminTab(tab) {
  activeAdminTab = tab;
  $$('[data-admin-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.adminPanel !== tab));
  $$('[data-admin-tab]').forEach(button => {
    button.classList.toggle('is-active', button.dataset.adminTab === tab);
    button.setAttribute('aria-pressed', String(button.dataset.adminTab === tab));
  });
}

function matchesTaskSearch(task, search) {
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return normalize([task.titulo, task.descricao, task.workspace, task.atribuidoPara].join(' ')).includes(normalize(search).trim());
}

function taskDescriptionHtml(description) {
  return String(description || '').split(/(https?:\/\/[^\s<>]+)/g).map(part => /^https?:\/\//.test(part)
    ? `<a href="${escapeHtml(part)}" target="_blank" rel="noopener noreferrer">${escapeHtml(part)}</a>`
    : escapeHtml(part)).join('');
}

function renderTaskGroups(tasks) {
  if (!tasks.length) return '<div class="empty-state"><span aria-hidden="true">✓</span><h3>Nenhuma tarefa por aqui</h3><p>Experimente outra lista ou busca, ou adicione uma nova tarefa.</p></div>';
  if (employeeTaskFilter === 'done' || taskSort !== 'date') return tasks.map(renderEmployeeTaskCard).join('');
  return [['overdue', 'Atrasadas'], ['today', 'Hoje'], ['next', 'Próximos dias'], ['undated', 'Sem prazo']].map(([key, label]) => {
    const group = tasks.filter(task => !task.dataPrazo ? key === 'undated' : getTaskDueKey(task) === key);
    return group.length ? `<section class="task-group"><h3 class="group-heading ${key}">${label}<span>${group.length}</span></h3>${group.map(renderEmployeeTaskCard).join('')}</section>` : '';
  }).join('');
}
