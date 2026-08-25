let currentUser = null;
  let authToken = '';
  let adminData = { tasks: [], usuarios: [], colaboradores: [], workspaces: [], stats: {} };
  let selectedTask = null;
  let selectedChatCollaboratorEmail = '';
  let chatPollTimer = null;
  let knownChatMessageIds = new Set();
  let unreadChatMessages = 0;
  let chatBootstrapComplete = false;
  let titleAlertLabel = 'Nova tarefa!';
  let employeePollTimer = null;
  let employeeTaskFilter = 'pending';
  let currentEmployeeTasks = [];
  let knownEmployeeTaskIds = new Set();
  let audioContext = null;
  let originalPageTitle = document.title || 'Dashboard de Tarefas';
  let originalFaviconHref = '';
  let titleAlertTimer = null;
  let unreadTaskNotifications = 0;
  const SESSION_LOGIN_KEY = 'taskDashboardSessionLogin';
  const NOTIFICATION_PROMPT_KEY = 'taskDashboardNotificationPromptHandledV2';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  document.addEventListener('DOMContentLoaded', () => {
    $('#loginForm').addEventListener('submit', handleLogin);
    $('#logoutBtn').addEventListener('click', logout);
    $('#filterEmployee').addEventListener('change', renderAdminTasks);
    $('#filterWorkspace').addEventListener('change', renderAdminTasks);
    $('#filterStatus').addEventListener('change', renderAdminTasks);
    $('#taskForm').addEventListener('submit', handleSaveTask);
    $('#templateForm').addEventListener('submit', handleCreateTemplate);
    $('#userForm').addEventListener('submit', handleRegisterUser);
    $('#workspaceForm').addEventListener('submit', handleCreateWorkspace);
    $('#commentForm').addEventListener('submit', handleAddComment);
    $('#checklistForm').addEventListener('submit', handleAddChecklistItem);
    $('#employeeTemplateForm').addEventListener('submit', handleCreateEmployeeTemplate);
    $('#employeeTaskForm').addEventListener('submit', handleCreateEmployeeTask);
    $('#employeeTaskFilters').addEventListener('click', handleEmployeeFilterClick);
    $('#chatForm').addEventListener('submit', handleSendChatMessage);
    $('#openAdminChatsBtn').addEventListener('click', openAdminChatHub);
    $('#openEmployeeTemplatesBtn').addEventListener('click', async () => {
      await loadEmployeeTemplates();
      openModal('employeeTemplatesListModal');
    });
    $('#openEmployeeChatBtn').addEventListener('click', () => openChat(currentUser.email));
    $('#allowNotificationsBtn').addEventListener('click', async () => {
      const permission = await prepareNotifications(true);
      playNotificationSound();
      sessionStorage.setItem(NOTIFICATION_PROMPT_KEY, 'true');
      if (permission === 'granted') localStorage.setItem(NOTIFICATION_PROMPT_KEY, 'true');
      closeModals();
      showTaskAlert('Notificacoes ativadas', 'Quando uma tarefa nova chegar, voce vai ver este aviso e ouvir um som.');
    });
    $('#skipNotificationsBtn').addEventListener('click', () => {
      sessionStorage.setItem(NOTIFICATION_PROMPT_KEY, 'true');
      closeModals();
    });

    $$('[data-modal]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.dataset.modal === 'taskModal' && button.dataset.mode === 'create') resetTaskForm();
        if (button.dataset.modal === 'userModal' && button.dataset.mode === 'create') resetUserForm();
        closeModals();
        openModal(button.dataset.modal);
      });
    });
    $$('.closeModal').forEach((button) => {
      button.addEventListener('click', () => closeModals());
    });

    window.addEventListener('focus', () => {
      if (currentUser && currentUser.perfil === 'Colaborador') clearTitleAlert();
    });
    document.addEventListener('click', () => {
      if (currentUser && currentUser.perfil === 'Colaborador') clearTitleAlert();
    });

    initializeAuth();
  });

  async function callServer(functionName, ...args) {
    const response = await fetch('/api/rpc/' + encodeURIComponent(functionName), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ args }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || 'Erro no servidor.');
    return data.result;
  }

  async function handleLogin(event) {
    event.preventDefault();
    const errorBox = $('#loginError');
    errorBox.classList.add('hidden');

    try {
      const email = $('#loginEmail').value;
      const senha = $('#loginPassword').value;
      currentUser = await callServer('loginUser', email, senha);
      authToken = currentUser.token || '';
      saveSessionLogin(email, senha);
      await enterDashboard();
    } catch (error) {
      errorBox.textContent = error.message || 'Nao foi possivel entrar.';
      errorBox.classList.remove('hidden');
    }
  }

  function logout() {
    stopEmployeePolling();
    stopChatPolling();
    sessionStorage.removeItem(SESSION_LOGIN_KEY);
    currentUser = null;
    authToken = '';
    $('#authLoadingView').classList.add('hidden');
    $('#dashboardView').classList.add('hidden');
    $('#adminView').classList.add('hidden');
    $('#employeeView').classList.add('hidden');
    $('#loginView').classList.remove('hidden');
    $('#loginView').classList.add('flex');
    $('#loginForm').reset();
  }

  async function initializeAuth() {
    const savedLogin = getSessionLogin();
    if (!savedLogin || !savedLogin.email || !savedLogin.senha) {
      showLogin();
      return;
    }

    await tryAutoLogin(savedLogin);
  }

  async function tryAutoLogin(savedLogin) {
    if (!savedLogin || !savedLogin.email || !savedLogin.senha) return;

    $('#loginEmail').value = savedLogin.email;
    $('#loginPassword').value = savedLogin.senha;

    try {
      currentUser = await callServer('loginUser', savedLogin.email, savedLogin.senha);
      authToken = currentUser.token || '';
      await enterDashboard();
    } catch (error) {
      sessionStorage.removeItem(SESSION_LOGIN_KEY);
      showLogin();
      showToast('Sessao expirada. Entre novamente.');
    }
  }

  function showLogin() {
    $('#authLoadingView').classList.add('hidden');
    $('#dashboardView').classList.add('hidden');
    $('#loginView').classList.remove('hidden');
    $('#loginView').classList.add('flex');
  }

  async function enterDashboard() {
    $('#authLoadingView').classList.add('hidden');
    $('#loginView').classList.add('hidden');
    $('#loginView').classList.remove('flex');
    $('#dashboardView').classList.remove('hidden');
    $('#userInfo').textContent = `${currentUser.nome} - ${currentUser.perfil} - ${currentUser.workspace}`;
    clearTitleAlert();
    unlockNotificationSound();

    if (currentUser.perfil === 'Admin') {
      await loadAdmin();
    } else {
      await loadEmployee(true);
      startEmployeePolling();
    }
    maybeShowNotificationPrompt();
    startChatPolling();
  }

  function saveSessionLogin(email, senha) {
    sessionStorage.setItem(SESSION_LOGIN_KEY, JSON.stringify({
      email,
      senha,
      savedAt: new Date().toISOString(),
    }));
  }

  function getSessionLogin() {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_LOGIN_KEY));
    } catch (error) {
      sessionStorage.removeItem(SESSION_LOGIN_KEY);
      return null;
    }
  }

  async function loadAdmin() {
    $('#adminView').classList.remove('hidden');
    $('#employeeView').classList.add('hidden');
    adminData = await callServer('getAdminDashboardData');
    renderAdminStats();
    renderAdminTodayPanel();
    renderAdminSelects();
    renderAdminTasks();
    renderAdminUsers();
  }

  function renderAdminStats() {
    $('#statPendente').textContent = adminData.stats.pendentes || 0;
    $('#statAndamento').textContent = adminData.stats.emAndamento || 0;
    $('#statConcluida').textContent = adminData.stats.concluidas || 0;
    $('#statTotal').textContent = adminData.stats.total || 0;
  }

  function renderAdminTodayPanel() {
    const panel = adminData.todayPanel || { atrasadas: [], hoje: [], porColaborador: [] };
    $('#adminTodayOverdueCount').textContent = panel.atrasadas.length;
    $('#adminTodayDueCount').textContent = panel.hoje.length;

    $('#adminTodayOverdue').innerHTML = panel.atrasadas.slice(0, 8).map(renderAdminTodayTask).join('') ||
      '<p class="text-sm text-slate-400">Nada atrasado.</p>';
    $('#adminTodayDue').innerHTML = panel.hoje.slice(0, 8).map(renderAdminTodayTask).join('') ||
      '<p class="text-sm text-slate-400">Nada para hoje.</p>';
    $('#adminTodayEmployees').innerHTML = panel.porColaborador.map((item) => `
      <div class="rounded-md border border-slate-200 p-2">
        <div class="flex items-center justify-between gap-2">
          <p class="truncate text-sm font-black">${escapeHtml(item.nome)}</p>
          <span class="text-xs font-bold text-slate-500">${item.total}</span>
        </div>
        <p class="mt-1 text-xs text-slate-500">Hoje: ${item.hoje} | Atrasadas: ${item.atrasadas} | Andamento: ${item.andamento}</p>
      </div>
    `).join('') || '<p class="text-sm text-slate-400">Sem colaboradores.</p>';
  }

  function renderAdminTodayTask(task) {
    return `
      <div class="admin-mini-card">
        <p class="text-sm font-black text-slate-900">${escapeHtml(task.titulo)}</p>
        <p class="mt-1 text-xs text-slate-500">${escapeHtml(task.atribuidoPara)} | ${escapeHtml(task.dataPrazo || '')}</p>
      </div>
    `;
  }

  function renderAdminSelects() {
    const employeeOptions = ['<option value="">Todos</option>']
      .concat(adminData.colaboradores.map((user) => `<option value="${escapeHtml(user.email)}">${escapeHtml(user.nome)} (${escapeHtml(user.email)})</option>`))
      .join('');
    $('#filterEmployee').innerHTML = employeeOptions;

    const workspaceOptions = ['<option value="">Todos</option>']
      .concat(adminData.workspaces.map((workspace) => `<option value="${escapeHtml(workspace.nome)}">${escapeHtml(workspace.nome)}</option>`))
      .join('');
    $('#filterWorkspace').innerHTML = workspaceOptions;

    $$('.employeeSelect').forEach((select) => {
      select.innerHTML = adminData.colaboradores
        .map((user) => `<option value="${escapeHtml(user.email)}">${escapeHtml(user.nome)} (${escapeHtml(user.email)})</option>`)
        .join('');
    });

    $$('.workspaceSelect').forEach((select) => {
      select.innerHTML = adminData.workspaces
        .map((workspace) => `<option value="${escapeHtml(workspace.nome)}">${escapeHtml(workspace.nome)}</option>`)
        .join('');
    });
  }

  function renderAdminTasks() {
    const employee = $('#filterEmployee').value;
    const workspace = $('#filterWorkspace').value;
    const status = $('#filterStatus').value;
    const tasks = adminData.tasks.filter((task) => {
      const matchesEmployee = !employee || task.atribuidoPara === employee;
      const matchesWorkspace = !workspace || task.workspace === workspace;
      const matchesStatus = !status || task.status === status;
      return matchesEmployee && matchesWorkspace && matchesStatus;
    });

    $('#adminTaskRows').innerHTML = tasks.map((task) => `
      <tr>
        <td class="px-4 py-3">
          <div class="font-black text-slate-900">${escapeHtml(task.titulo)}</div>
          <div class="text-xs text-slate-500">${escapeHtml(task.workspace || '')}</div>
        </td>
        <td class="px-4 py-3">${escapeHtml(task.atribuidoPara)}</td>
        <td class="px-4 py-3">${priorityBadge(task.prioridade)}</td>
        <td class="px-4 py-3">${escapeHtml(task.dataPrazo || '')}</td>
        <td class="px-4 py-3">${statusBadge(task.status)}</td>
        <td class="px-4 py-3">${escapeHtml(task.tipo)}</td>
        <td class="px-4 py-3">
          <div class="flex justify-end gap-2">
            <button class="adminDetailsBtn row-btn" data-task-id="${escapeHtml(task.id)}">Detalhes</button>
            <button class="editTaskBtn row-btn" data-task-id="${escapeHtml(task.id)}">Editar</button>
            <button class="deleteTaskBtn row-btn row-btn-danger" data-task-id="${escapeHtml(task.id)}">Excluir</button>
          </div>
        </td>
      </tr>
    `).join('') || `
      <tr>
        <td colspan="7" class="px-4 py-8 text-center text-sm font-medium text-slate-500">Nenhuma tarefa encontrada com os filtros atuais.</td>
      </tr>
    `;

    $$('.editTaskBtn').forEach((button) => {
      button.addEventListener('click', () => openEditTask(button.dataset.taskId));
    });
    $$('.adminDetailsBtn').forEach((button) => {
      button.addEventListener('click', () => openTaskDetails(adminData.tasks.find((task) => task.id === button.dataset.taskId)));
    });
    $$('.deleteTaskBtn').forEach((button) => {
      button.addEventListener('click', () => handleDeleteTask(button.dataset.taskId));
    });
  }

  function renderAdminUsers() {
    const users = adminData.usuarios || [];
    $('#adminUserRows').innerHTML = users.map((user) => `
      <tr>
        <td class="px-4 py-3">
          <div class="font-medium">${escapeHtml(user.nome)}</div>
          <div class="text-xs text-slate-500">${escapeHtml(user.id || '')}</div>
        </td>
        <td class="px-4 py-3">${escapeHtml(user.email)}</td>
        <td class="px-4 py-3">${escapeHtml(user.perfil)}</td>
        <td class="px-4 py-3">${escapeHtml(user.workspace || '')}</td>
        <td class="px-4 py-3">
          ${user.perfil === 'Colaborador' ? `<button class="openChatBtn row-btn relative" data-email="${escapeHtml(user.email)}" data-name="${escapeHtml(user.nome)}">Chat<span class="chat-badge adminChatBadge hidden" data-email="${escapeHtml(user.email)}">0</span></button>` : '<span class="text-xs text-slate-400">-</span>'}
        </td>
        <td class="px-4 py-3">
          <div class="flex justify-end">
            <button class="editUserBtn row-btn" data-user-id="${escapeHtml(user.id)}">Editar</button>
          </div>
        </td>
      </tr>
    `).join('') || `
      <tr>
        <td colspan="6" class="px-4 py-6 text-center text-sm text-slate-500">Nenhum usuario cadastrado.</td>
      </tr>
    `;

    $$('.editUserBtn').forEach((button) => {
      button.addEventListener('click', () => openEditUser(button.dataset.userId));
    });
    $$('.openChatBtn').forEach((button) => {
      button.addEventListener('click', () => openChat(button.dataset.email, button.dataset.name));
    });
  }

  function resetUserForm() {
    $('#userModalTitle').textContent = 'Novo Usuario';
    const form = $('#userForm');
    form.reset();
    form.elements.id.value = '';
    form.elements.emailOriginal.value = '';
    form.elements.senha.required = true;
    form.elements.senha.placeholder = 'Senha';
    form.elements.perfil.value = 'Colaborador';
  }

  function openEditUser(userId) {
    const user = (adminData.usuarios || []).find((item) => item.id === userId);
    if (!user) return;

    $('#userModalTitle').textContent = 'Editar Usuario';
    const form = $('#userForm');
    form.elements.id.value = user.id || '';
    form.elements.emailOriginal.value = user.email || '';
    form.elements.nome.value = user.nome || '';
    form.elements.email.value = user.email || '';
    form.elements.senha.value = '';
    form.elements.senha.required = false;
    form.elements.senha.placeholder = 'Nova senha (deixe vazio para manter)';
    form.elements.perfil.value = user.perfil || 'Colaborador';
    form.elements.workspace.value = user.workspace || '';
    openModal('userModal');
  }

  function resetTaskForm() {
    $('#taskModalTitle').textContent = 'Nova Tarefa';
    const form = $('#taskForm');
    form.reset();
    form.elements.id.value = '';
    form.elements.status.value = 'Pendente';
  }

  function openEditTask(taskId) {
    const task = adminData.tasks.find((item) => item.id === taskId);
    if (!task) return;

    $('#taskModalTitle').textContent = 'Editar Tarefa';
    const form = $('#taskForm');
    form.elements.id.value = task.id;
    form.elements.titulo.value = task.titulo || '';
    form.elements.descricao.value = task.descricao || '';
    form.elements.prioridade.value = task.prioridade || 'Media';
    form.elements.dataPrazo.value = task.dataPrazo || '';
    form.elements.status.value = task.status || 'Pendente';
    form.elements.atribuidoPara.value = task.atribuidoPara || '';
    form.elements.workspace.value = task.workspace || '';
    openModal('taskModal');
  }

  async function handleSaveTask(event) {
    event.preventDefault();
    const data = formToObject(event.target);
    data.autorEmail = currentUser.email;

    if (data.id) {
      await callServer('updateTask', data.id, data);
      showToast('Tarefa atualizada.');
    } else {
      await callServer('createTask', data);
      showToast('Tarefa criada.');
    }

    event.target.reset();
    closeModals();
    await loadAdmin();
  }

  async function handleDeleteTask(taskId) {
    const ok = confirm('Deseja excluir esta tarefa? Esta acao nao pode ser desfeita.');
    if (!ok) return;

    await callServer('deleteTask', taskId);
    showToast('Tarefa excluida.');
    await loadAdmin();
  }

  async function loadEmployee(isInitialLoad = false) {
    $('#employeeView').classList.remove('hidden');
    $('#adminView').classList.add('hidden');
    const tasks = prepareEmployeeTasks(await callServer('getEmployeeTasks', currentUser.email));
    currentEmployeeTasks = tasks;
    notifyNewEmployeeTasks(tasks, isInitialLoad);
    renderEmployeeSummary(tasks);
    renderEmployeeTaskFilters(tasks);
    renderEmployeeTasks(applyEmployeeTaskFilter(tasks));
  }

  async function loadEmployeeTemplates() {
    const templates = await callServer('getEmployeeDailyTemplates', currentUser.email);
    renderEmployeeTemplates(templates);
  }

  function renderEmployeeTemplates(templates) {
    $('#employeeTemplates').innerHTML = templates.length ? `
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-slate-200 text-sm">
          <thead class="bg-slate-50">
            <tr>
              <th class="px-3 py-2 text-left text-xs font-black uppercase text-slate-500">Titulo</th>
              <th class="px-3 py-2 text-left text-xs font-black uppercase text-slate-500">Prioridade</th>
              <th class="px-3 py-2 text-left text-xs font-black uppercase text-slate-500">Workspace</th>
              <th class="px-3 py-2 text-right text-xs font-black uppercase text-slate-500">Acoes</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 bg-white">
            ${templates.map((template) => `
              <tr>
                <td class="px-3 py-2">
                  <div class="font-black text-slate-900">${escapeHtml(template.titulo)}</div>
                  <div class="text-xs text-slate-500">${escapeHtml(template.descricao || '')}</div>
                </td>
                <td class="px-3 py-2">${priorityBadge(template.prioridade || 'Media')}</td>
                <td class="px-3 py-2 text-xs font-bold text-slate-500">${escapeHtml(template.workspace || '')}<br>${escapeHtml(template.diasSemanaLabel || '')}</td>
                <td class="px-3 py-2 text-right">
                  <button class="deleteEmployeeTemplateBtn rounded-md bg-red-50 px-2 py-1 text-xs font-black text-red-700" data-template-id="${escapeHtml(template.id)}">Excluir</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : '<p class="bg-slate-50 p-3 text-sm font-medium text-slate-500">Nenhuma tarefa diaria configurada.</p>';

    $$('.deleteEmployeeTemplateBtn').forEach((button) => {
      button.addEventListener('click', () => handleDeleteEmployeeTemplate(button.dataset.templateId));
    });
  }

  function prepareEmployeeTasks(tasks) {
    return tasks
      .sort((a, b) => {
        if (a.status === 'Concluida' && b.status === 'Concluida') {
          return getCompletedSortValue(b) - getCompletedSortValue(a);
        }
        const dueA = a.dataPrazo ? new Date(a.dataPrazo + 'T12:00:00').getTime() : 0;
        const dueB = b.dataPrazo ? new Date(b.dataPrazo + 'T12:00:00').getTime() : 0;
        return dueA - dueB;
      });
  }

  function getDefaultEmployeeVisibleTasks(tasks) {
    return getPendingTasks(tasks);
  }

  function getRecentCompletedTasks(tasks) {
    return tasks.filter((task) => task.status === 'Concluida' && isRecentCompletedTask(task));
  }

  function getOpenTasks(tasks) {
    return tasks.filter((task) => task.status !== 'Concluida');
  }

  function getTasksByDueKey(tasks, dueKey) {
    return tasks.filter((task) => task.status !== 'Concluida' && getTaskDueKey(task) === dueKey);
  }

  function getPendingTasks(tasks) {
    return tasks.filter((task) => task.status === 'Pendente');
  }

  function getDoingTasks(tasks) {
    return tasks.filter((task) => task.status === 'Em Andamento');
  }

  function getDoneTasks(tasks) {
    return tasks.filter((task) => task.status === 'Concluida');
  }

  function sortEmployeeTasks(tasks) {
    return [...tasks].sort((a, b) => {
      if (a.status === 'Concluida' && b.status === 'Concluida') {
        return getCompletedSortValue(b) - getCompletedSortValue(a);
      }
      const dueA = a.dataPrazo ? new Date(a.dataPrazo + 'T12:00:00').getTime() : 0;
      const dueB = b.dataPrazo ? new Date(b.dataPrazo + 'T12:00:00').getTime() : 0;
      if (dueA !== dueB) return dueA - dueB;
      return String(a.titulo || '').localeCompare(String(b.titulo || ''));
    });
  }

  function sortRecentFirst(tasks) {
    return [...tasks].sort((a, b) => {
      const createdA = Number(a.dataCriacaoSort || 0);
      const createdB = Number(b.dataCriacaoSort || 0);
      if (createdA !== createdB) return createdB - createdA;
      const dueA = a.dataPrazo ? new Date(a.dataPrazo + 'T12:00:00').getTime() : 0;
      const dueB = b.dataPrazo ? new Date(b.dataPrazo + 'T12:00:00').getTime() : 0;
      if (dueA !== dueB) return dueA - dueB;
      return String(a.titulo || '').localeCompare(String(b.titulo || ''));
    });
  }

  function isRecentCompletedTask(task) {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const key = task.dataConclusaoKey || task.dataPrazo;

    return key === toDateKey(today) || key === toDateKey(yesterday);
  }

  function getCompletedSortValue(task) {
    if (task.dataConclusaoSort) return Number(task.dataConclusaoSort);
    if (task.dataPrazo) return new Date(task.dataPrazo + 'T12:00:00').getTime();
    return 0;
  }

  function toDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function renderEmployeeSummary(tasks) {
    $('#employeeGreeting').textContent = `Ola, ${currentUser.nome}`;

    const pending = getPendingTasks(tasks).length;
    const doing = getDoingTasks(tasks).length;
    const overdue = tasks.filter((task) => task.status === 'Pendente' && getTaskDueKey(task) === 'overdue').length;
    const next = tasks.filter((task) => task.status !== 'Concluida' && getTaskDueKey(task) === 'next').length;

    $('#employeeSummary').innerHTML = `
      <div class="employee-summary-card summary-today">
        <p>Pendentes</p>
        <strong>${pending}</strong>
        <span>aguardando execucao</span>
      </div>
      <div class="employee-summary-card summary-next">
        <p>Em andamento</p>
        <strong>${doing}</strong>
        <span>tarefas iniciadas</span>
      </div>
      <div class="employee-summary-card summary-overdue ${overdue ? 'is-danger' : ''}">
        <p>Atrasadas</p>
        <strong>${overdue}</strong>
        <span>pendentes vencidas</span>
      </div>
      <div class="employee-summary-card summary-daily">
        <p>Proximas</p>
        <strong>${next}</strong>
        <span>agendadas para depois</span>
      </div>
    `;
  }

  function renderEmployeeTaskFilters(tasks) {
    const counts = {
      pending: getPendingTasks(tasks).length,
      doing: getDoingTasks(tasks).length,
      overdue: tasks.filter((task) => task.status === 'Pendente' && getTaskDueKey(task) === 'overdue').length,
      next: tasks.filter((task) => task.status !== 'Concluida' && getTaskDueKey(task) === 'next').length,
      done: tasks.filter((task) => task.status === 'Concluida').length,
    };

    const filters = [
      ['pending', 'Pendentes'],
      ['doing', 'Em andamento'],
      ['overdue', 'Atrasadas'],
      ['next', 'Proximas'],
      ['done', 'Concluidas'],
    ];

    $('#employeeTaskFilters').innerHTML = filters.map(([key, label]) => `
      <button class="employee-filter-btn filter-${key} ${employeeTaskFilter === key ? 'is-active' : ''}" data-filter="${key}">
        <span>${label}</span>
        <strong>${counts[key]}</strong>
      </button>
    `).join('');

  }

  function handleEmployeeFilterClick(event) {
    const button = event.target.closest('.employee-filter-btn');
    if (!button) return;

    employeeTaskFilter = button.dataset.filter || 'pending';
    renderEmployeeTaskFilters(currentEmployeeTasks);
    renderEmployeeTasks(applyEmployeeTaskFilter(currentEmployeeTasks));
  }

  function applyEmployeeTaskFilter(tasks) {
    if (employeeTaskFilter === 'done') return sortEmployeeTasks(getDoneTasks(tasks));
    if (employeeTaskFilter === 'doing') return sortEmployeeTasks(getDoingTasks(tasks));
    if (employeeTaskFilter === 'pending') return sortRecentFirst(getPendingTasks(tasks));
    if (employeeTaskFilter === 'overdue') return sortEmployeeTasks(tasks.filter((task) => task.status === 'Pendente' && getTaskDueKey(task) === 'overdue'));
    if (employeeTaskFilter === 'next') return sortEmployeeTasks(getTasksByDueKey(tasks, 'next'));
    return sortEmployeeTasks(getDefaultEmployeeVisibleTasks(tasks));
  }

  function renderEmployeeTasks(tasks) {
    const titles = {
      pending: 'Tarefas pendentes',
      doing: 'Tarefas em andamento',
      overdue: 'Tarefas atrasadas',
      next: 'Proximas tarefas',
      done: 'Tarefas concluidas',
    };

    $('#employeeTasks').innerHTML = `
      <section class="employee-list-panel">
        <div class="employee-list-header">
          <div>
            <h2>${titles[employeeTaskFilter] || 'Minhas tarefas'}</h2>
            <p>${tasks.length} tarefa${tasks.length === 1 ? '' : 's'} encontrada${tasks.length === 1 ? '' : 's'}</p>
          </div>
          <button id="employeeTemplatesShortcut" class="employee-secondary-action">Tarefas diarias</button>
        </div>
        <div class="employee-list-table">
          ${tasks.map(renderEmployeeTaskCard).join('') || '<p class="rounded-md bg-slate-50 p-4 text-sm font-medium text-slate-500">Nenhuma tarefa nesta visualizacao.</p>'}
        </div>
      </section>
    `;

    $('#employeeTemplatesShortcut').addEventListener('click', async () => {
      await loadEmployeeTemplates();
      openModal('employeeTemplatesListModal');
    });

    $$('.taskDetailsBtn').forEach((button) => {
      button.addEventListener('click', () => openTaskDetails(tasks.find((task) => task.id === button.dataset.taskId)));
    });
    $$('.statusBtn').forEach((button) => {
      button.addEventListener('click', () => changeStatus(button.dataset.taskId, button.dataset.status));
    });
  }

  function renderEmployeeTaskCard(task) {
    const dueKey = getTaskDueKey(task);
    const statusClass = task.status === 'Concluida'
      ? 'is-done'
      : task.status === 'Em Andamento'
        ? 'is-progress'
        : 'is-pending';
    return `
      <article class="employee-task-row is-${dueKey} ${statusClass}">
        <div class="min-w-0">
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <button class="taskDetailsBtn employee-task-title text-left text-sm font-black leading-tight text-slate-900 hover:text-sky-700" data-task-id="${escapeHtml(task.id)}">${escapeHtml(task.titulo)}</button>
            ${priorityBadge(task.prioridade)}
            ${statusBadge(task.status)}
          </div>
          <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-slate-500">
            <span>${escapeHtml(formatDueLabel(task))}</span>
            <span class="text-slate-300">|</span>
            <span>${escapeHtml(task.workspace || '')}</span>
            <span class="text-slate-300">|</span>
            <span>${escapeHtml(task.tipo || 'Manual')}</span>
          </div>
          ${task.descricao ? `<div class="employee-task-description">${escapeHtml(task.descricao)}</div>` : ''}
        </div>
        <div class="employee-row-actions">
          ${renderEmployeeActionButtons(task)}
          <button class="taskDetailsBtn employee-action-btn is-details" data-task-id="${escapeHtml(task.id)}">Detalhes</button>
        </div>
      </article>
    `;
  }

  function renderEmployeeActionButtons(task) {
    if (task.status === 'Pendente') {
      return `
        <button class="statusBtn employee-action-btn is-start" data-task-id="${escapeHtml(task.id)}" data-status="Em Andamento">Comecar</button>
        <button class="statusBtn employee-action-btn is-finish" data-task-id="${escapeHtml(task.id)}" data-status="Concluida">Concluir</button>
      `;
    }

    if (task.status === 'Em Andamento') {
      return `
        <button class="statusBtn employee-action-btn is-finish" data-task-id="${escapeHtml(task.id)}" data-status="Concluida">Concluir</button>
      `;
    }

    return `
      <button class="statusBtn employee-action-btn is-redo" data-task-id="${escapeHtml(task.id)}" data-status="Pendente">Refazer</button>
    `;
  }

  function getTasksForDueColumn(tasks, columnKey) {
    return tasks
      .filter((task) => {
        if (columnKey === 'done') return task.status === 'Concluida';
        if (task.status === 'Concluida') return false;

        const dueKey = getTaskDueKey(task);
        return dueKey === columnKey;
      })
      .sort((a, b) => {
        if (columnKey === 'done') return getCompletedSortValue(b) - getCompletedSortValue(a);
        return getStatusWeight(a.status) - getStatusWeight(b.status);
      });
  }

  function getTaskDueKey(task) {
    if (!task.dataPrazo) return 'next';

    const todayKey = toDateKey(new Date());
    if (task.dataPrazo < todayKey) return 'overdue';
    if (task.dataPrazo === todayKey) return 'today';
    return 'next';
  }

  function formatDueLabel(task) {
    if (!task.dataPrazo) return 'Sem prazo';
    const dueKey = getTaskDueKey(task);
    if (task.status === 'Concluida') return `Prazo: ${task.dataPrazo}`;
    if (dueKey === 'today') return `Hoje: ${task.dataPrazo}`;
    if (dueKey === 'overdue') return `Vencida: ${task.dataPrazo}`;
    return `Prazo: ${task.dataPrazo}`;
  }

  function getStatusWeight(status) {
    if (status === 'Em Andamento') return 0;
    if (status === 'Pendente') return 1;
    return 2;
  }

  async function changeStatus(taskId, status) {
    await callServer('updateTaskStatus', taskId, status, currentUser.email);
    showToast('Status atualizado.');
    await loadEmployee(false);
  }

  async function openTaskDetails(task) {
    selectedTask = task;
    $('#detailsTitle').textContent = task.titulo;
    $('#detailsDescription').textContent = task.descricao || 'Sem descricao.';
    openModal('detailsModal');
    await Promise.all([
      loadComments(task.id),
      loadChecklist(task.id),
      loadHistory(task.id),
    ]);
  }

  async function loadComments(taskId) {
    const comments = await callServer('getTaskComments', taskId);
    $('#commentsList').innerHTML = comments.map((comment) => `
      <div class="rounded-md bg-white p-2 ring-1 ring-slate-200">
        <p class="text-xs text-slate-400">${escapeHtml(comment.autorEmail)} - ${escapeHtml(comment.dataHora)}</p>
        <p class="mt-1 text-sm">${escapeHtml(comment.mensagem)}</p>
      </div>
    `).join('') || '<p class="text-sm text-slate-400">Sem comentarios.</p>';
  }

  async function handleAddComment(event) {
    event.preventDefault();
    const form = event.target;
    await callServer('addComment', selectedTask.id, form.mensagem.value, currentUser.email);
    form.reset();
    await Promise.all([loadComments(selectedTask.id), loadHistory(selectedTask.id)]);
  }

  async function loadChecklist(taskId) {
    const checklist = await callServer('getTaskChecklist', taskId);
    $('#checklistList').innerHTML = checklist.map((item) => `
      <div class="flex items-center gap-2 rounded-md bg-white p-2 ring-1 ring-slate-200">
        <input class="checklistToggle h-4 w-4" type="checkbox" data-item-id="${escapeHtml(item.id)}" ${item.concluido ? 'checked' : ''}>
        <span class="flex-1 text-sm ${item.concluido ? 'text-slate-400 line-through' : 'text-slate-700'}">${escapeHtml(item.titulo)}</span>
        <button class="deleteChecklistBtn rounded-md bg-red-50 px-2 py-1 text-xs font-black text-red-700" data-item-id="${escapeHtml(item.id)}">Excluir</button>
      </div>
    `).join('') || '<p class="text-sm text-slate-400">Sem checklist.</p>';

    $$('.checklistToggle').forEach((input) => {
      input.addEventListener('change', async () => {
        await callServer('updateChecklistItem', input.dataset.itemId, input.checked, currentUser.email);
        await Promise.all([loadChecklist(taskId), loadHistory(taskId)]);
      });
    });
    $$('.deleteChecklistBtn').forEach((button) => {
      button.addEventListener('click', async () => {
        await callServer('deleteChecklistItem', button.dataset.itemId, currentUser.email);
        await Promise.all([loadChecklist(taskId), loadHistory(taskId)]);
      });
    });
  }

  async function loadHistory(taskId) {
    const history = await callServer('getTaskHistory', taskId);
    $('#historyList').innerHTML = history.map((item) => `
      <div class="rounded-md bg-white p-2 ring-1 ring-slate-200">
        <p class="text-xs font-bold text-slate-500">${escapeHtml(item.dataHora)} | ${escapeHtml(item.autorEmail)}</p>
        <p class="mt-1 text-sm font-black">${escapeHtml(item.acao)}</p>
        <p class="text-xs text-slate-500">${escapeHtml(item.detalhes || '')}</p>
      </div>
    `).join('') || '<p class="text-sm text-slate-400">Sem historico.</p>';
  }

  async function handleAddChecklistItem(event) {
    event.preventDefault();
    const form = event.target;
    await callServer('addChecklistItem', selectedTask.id, form.titulo.value, currentUser.email);
    form.reset();
    await Promise.all([loadChecklist(selectedTask.id), loadHistory(selectedTask.id)]);
  }

  async function handleCreateTemplate(event) {
    event.preventDefault();
    await callServer('createDailyTemplate', formToObject(event.target));
    event.target.reset();
    closeModals();
    showToast('Modelo diario criado.');
  }

  async function handleCreateEmployeeTemplate(event) {
    event.preventDefault();
    await callServer('createEmployeeDailyTemplate', formToObject(event.target), currentUser.email);
    event.target.reset();
    closeModals();
    showToast('Tarefa diaria criada.');
    await loadEmployeeTemplates();
    await loadEmployee(false);
  }

  async function handleCreateEmployeeTask(event) {
    event.preventDefault();
    await callServer('createEmployeeTask', formToObject(event.target), currentUser.email);
    event.target.reset();
    closeModals();
    showToast('Tarefa criada.');
    employeeTaskFilter = 'pending';
    await loadEmployee(false);
  }

  async function handleDeleteEmployeeTemplate(templateId) {
    const ok = confirm('Deseja excluir esta tarefa diaria? As tarefas ja criadas nao serao apagadas.');
    if (!ok) return;

    await callServer('deleteEmployeeDailyTemplate', templateId, currentUser.email);
    showToast('Tarefa diaria excluida.');
    await loadEmployeeTemplates();
  }

  async function handleRegisterUser(event) {
    event.preventDefault();
    const data = formToObject(event.target);
    if (data.id) {
      await callServer('updateUser', data.id, data);
      showToast('Usuario atualizado.');
    } else {
      await callServer('registerUser', data);
      showToast('Usuario cadastrado.');
    }
    event.target.reset();
    closeModals();
    await loadAdmin();
  }

  async function handleCreateWorkspace(event) {
    event.preventDefault();
    await callServer('createWorkspace', formToObject(event.target));
    event.target.reset();
    closeModals();
    showToast('Workspace cadastrado.');
    await loadAdmin();
  }

  async function openChat(collaboratorEmail, collaboratorName = '') {
    selectedChatCollaboratorEmail = collaboratorEmail;
    clearChatBadge(collaboratorEmail);
    closeModals();

    $('#chatTitle').textContent = currentUser.perfil === 'Admin'
      ? `Chat com ${collaboratorName || collaboratorEmail}`
      : 'Chat com Admin';
    $('#chatSubtitle').textContent = 'Mensagens somem automaticamente apos 24h.';

    await loadChatMessages(false);
    openModal('chatModal');
  }

  async function openAdminChatHub() {
    if (!currentUser || currentUser.perfil !== 'Admin') return;
    const contacts = await callServer('getChatContacts');
    renderAdminChatHub(contacts);
    openModal('adminChatHubModal');
  }

  function renderAdminChatHub(contacts) {
    $('#adminChatHubList').innerHTML = contacts.map((contact) => {
      const unread = getAdminUnreadCount(contact.email);
      return `
        <div class="admin-chat-contact">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-black text-slate-900">${escapeHtml(contact.nome)}</p>
              ${unread ? `<span class="rounded-full bg-red-50 px-2 py-1 text-xs font-black text-red-700">${unread} nova${unread === 1 ? '' : 's'}</span>` : ''}
            </div>
            <p class="mt-1 text-xs font-medium text-slate-500">${escapeHtml(contact.email)} | ${escapeHtml(contact.workspace || 'Sem workspace')}</p>
            <p class="mt-1 text-xs text-slate-400">${contact.ultimaMensagem ? `Ultima mensagem: ${escapeHtml(contact.ultimaMensagem)}` : 'Sem mensagens recentes'}</p>
          </div>
          <button class="openHubChatBtn row-btn" data-email="${escapeHtml(contact.email)}" data-name="${escapeHtml(contact.nome)}">Abrir chat</button>
        </div>
      `;
    }).join('') || '<p class="rounded-md bg-slate-50 p-4 text-sm text-slate-500">Nenhum colaborador encontrado.</p>';

    $$('.openHubChatBtn').forEach((button) => {
      button.addEventListener('click', () => openChat(button.dataset.email, button.dataset.name));
    });
  }

  function getAdminUnreadCount(collaboratorEmail) {
    const badge = $$('.adminChatBadge')
      .find((item) => normalizeEmailClient(item.dataset.email) === normalizeEmailClient(collaboratorEmail));
    return Number(badge?.textContent || '0');
  }

  function updateAdminGlobalChatBadge() {
    const badge = $('#adminChatGlobalBadge');
    if (!badge) return;
    const total = $$('.adminChatBadge').reduce((sum, item) => sum + Number(item.textContent || '0'), 0);
    badge.textContent = total;
    badge.classList.toggle('hidden', total <= 0);
  }

  async function loadChatMessages(shouldNotify = true) {
    const collaboratorEmail = selectedChatCollaboratorEmail || (currentUser?.perfil === 'Colaborador' ? currentUser.email : '');
    if (!currentUser || !collaboratorEmail) return;

    const messages = await callServer('getChatMessages', collaboratorEmail);
    renderChatMessages(messages);
    notifyNewChatMessages(messages, shouldNotify);
  }

  function renderChatMessages(messages) {
    $('#chatMessages').innerHTML = messages.map((message) => {
      const mine = normalizeEmailClient(message.autorEmail) === normalizeEmailClient(currentUser.email);
      return `
        <div class="chat-message ${mine ? 'is-mine' : 'is-other'}">
          <div class="chat-message-meta">
            <span>${mine ? 'Voce' : escapeHtml(message.autorPerfil === 'Admin' ? 'Admin' : message.autorEmail)}</span>
            <span>${escapeHtml(message.dataHora || '')}</span>
          </div>
          <div class="chat-message-body">${escapeHtml(message.mensagem)}</div>
        </div>
      `;
    }).join('') || '<p class="rounded-md bg-slate-50 p-4 text-sm text-slate-500">Nenhuma mensagem nas ultimas 24h.</p>';

    const box = $('#chatMessages');
    box.scrollTop = box.scrollHeight;
  }

  async function handleSendChatMessage(event) {
    event.preventDefault();
    const input = event.target.elements.mensagem;
    const text = input.value.trim();
    if (!text || !selectedChatCollaboratorEmail) return;

    await callServer('sendChatMessage', selectedChatCollaboratorEmail, text, currentUser.email);
    input.value = '';
    await loadChatMessages(false);
  }

  function startChatPolling() {
    stopChatPolling();
    chatBootstrapComplete = false;
    bootstrapChatMessages().finally(() => {
      if (!currentUser) return;
      chatBootstrapComplete = true;
      chatPollTimer = setInterval(async () => {
        if (!currentUser) return;
        try {
          if (currentUser.perfil === 'Admin') {
            await pollAdminChats();
          } else {
            if (!selectedChatCollaboratorEmail) selectedChatCollaboratorEmail = currentUser.email;
            await pollEmployeeChat();
          }
        } catch (error) {
          console.log('Falha ao atualizar chat.', error);
        }
      }, 5000);
    });
  }

  async function bootstrapChatMessages() {
    if (!currentUser) return;
    knownChatMessageIds = new Set();
    if (currentUser.perfil === 'Admin') {
      const contacts = await callServer('getChatContacts');
      for (const contact of contacts) {
        const messages = await callServer('getChatMessages', contact.email);
        messages
          .filter((message) => normalizeEmailClient(message.autorEmail) !== normalizeEmailClient(currentUser.email))
          .forEach((message) => knownChatMessageIds.add(message.id));
      }
      return;
    }

    const messages = await callServer('getChatMessages', currentUser.email);
    messages
      .filter((message) => normalizeEmailClient(message.autorEmail) !== normalizeEmailClient(currentUser.email))
      .forEach((message) => knownChatMessageIds.add(message.id));
  }

  function stopChatPolling() {
    if (chatPollTimer) {
      clearInterval(chatPollTimer);
      chatPollTimer = null;
    }
    unreadChatMessages = 0;
    knownChatMessageIds = new Set();
    chatBootstrapComplete = false;
  }

  async function pollEmployeeChat() {
    const messages = await callServer('getChatMessages', currentUser.email);
    const isChatOpen = !$('#chatModal').classList.contains('hidden') && selectedChatCollaboratorEmail === currentUser.email;
    if (isChatOpen) renderChatMessages(messages);
    notifyNewChatMessages(messages, true);
  }

  async function pollAdminChats() {
    const contacts = await callServer('getChatContacts');
    for (const contact of contacts) {
      const messages = await callServer('getChatMessages', contact.email);
      const isChatOpen = !$('#chatModal').classList.contains('hidden') && selectedChatCollaboratorEmail === contact.email;
      if (isChatOpen) renderChatMessages(messages);
      notifyNewChatMessages(messages, true, contact.email, contact.nome);
    }
    if (!$('#adminChatHubModal').classList.contains('hidden')) renderAdminChatHub(contacts);
  }

  function notifyNewChatMessages(messages, shouldNotify, collaboratorEmail = selectedChatCollaboratorEmail, collaboratorName = '') {
    const incoming = messages.filter((message) => normalizeEmailClient(message.autorEmail) !== normalizeEmailClient(currentUser.email));
    const incomingIds = new Set(incoming.map((message) => message.id));

    if (!shouldNotify || !chatBootstrapComplete) {
      incomingIds.forEach((id) => knownChatMessageIds.add(id));
      return;
    }

    const newMessages = incoming.filter((message) => !knownChatMessageIds.has(message.id));
    incomingIds.forEach((id) => knownChatMessageIds.add(id));

    if (!newMessages.length) return;

    const isChatOpen = !$('#chatModal').classList.contains('hidden') && selectedChatCollaboratorEmail === collaboratorEmail;
    if (!isChatOpen) incrementChatBadge(collaboratorEmail, newMessages.length);

    const last = newMessages[newMessages.length - 1];
    startTitleAlert('Nova mensagem!');
    showTaskAlert(currentUser.perfil === 'Admin' ? `Mensagem de ${collaboratorName || collaboratorEmail}` : 'Mensagem do Admin', last.mensagem);
    playNotificationSound();
    showBrowserChatNotification(last, collaboratorName || collaboratorEmail);
  }

  function incrementChatBadge(collaboratorEmail, count) {
    unreadChatMessages += count;
    if (currentUser.perfil === 'Colaborador') {
      const badge = $('#employeeChatBadge');
      badge.textContent = unreadChatMessages;
      badge.classList.remove('hidden');
      return;
    }

    $$('.adminChatBadge')
      .filter((badge) => normalizeEmailClient(badge.dataset.email) === normalizeEmailClient(collaboratorEmail))
      .forEach((badge) => {
      const current = Number(badge.textContent || '0') + count;
      badge.textContent = current;
      badge.classList.remove('hidden');
    });
    updateAdminGlobalChatBadge();
  }

  function clearChatBadge(collaboratorEmail) {
    if (currentUser?.perfil === 'Colaborador') {
      unreadChatMessages = 0;
      $('#employeeChatBadge').classList.add('hidden');
      return;
    }

    $$('.adminChatBadge')
      .filter((badge) => normalizeEmailClient(badge.dataset.email) === normalizeEmailClient(collaboratorEmail))
      .forEach((badge) => {
      badge.textContent = '0';
      badge.classList.add('hidden');
    });
    updateAdminGlobalChatBadge();
  }

  function showBrowserChatNotification(message, senderLabel) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    new Notification('Nova mensagem no chat', {
      body: `${senderLabel}: ${message.mensagem}`,
      tag: message.id,
    });
  }

  function formToObject(form) {
    const data = {};
    const formData = new FormData(form);
    for (const [key, value] of formData.entries()) {
      data[key] = data[key] ? `${data[key]},${value}` : value;
    }
    return data;
  }

  function openModal(id) {
    $('#' + id).classList.remove('hidden');
  }

  function closeModals() {
    $$('.modal').forEach((modal) => modal.classList.add('hidden'));
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 2500);
  }

  function maybeShowNotificationPrompt() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      localStorage.setItem(NOTIFICATION_PROMPT_KEY, 'true');
      return;
    }

    if (sessionStorage.getItem(NOTIFICATION_PROMPT_KEY) === 'true') return;

    openModal('notificationPromptModal');
  }

  async function prepareNotifications(askPermission = false) {
    unlockNotificationSound();

    if (askPermission && 'Notification' in window && Notification.permission === 'default') {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          showTaskAlert('Aviso dentro da dashboard ativo', 'O navegador nao liberou notificacoes externas, mas o alerta na tela e o som continuam funcionando com a pagina aberta.');
        }
        return permission;
      } catch (error) {
        console.log('Permissao de notificacao nao concedida.', error);
      }
    }

    if (askPermission && 'Notification' in window && Notification.permission === 'denied') {
      showTaskAlert('Notificacoes bloqueadas no Chrome', 'Clique no cadeado da barra de endereco, libere notificacoes para este site e recarregue a dashboard.');
    }

    return 'Notification' in window ? Notification.permission : 'unsupported';
  }

  function startEmployeePolling() {
    stopEmployeePolling();
    employeePollTimer = setInterval(async () => {
      if (!currentUser || currentUser.perfil !== 'Colaborador') return;
      try {
        await loadEmployee(false);
      } catch (error) {
        console.log('Falha ao buscar novas tarefas.', error);
      }
    }, 5000);
  }

  function stopEmployeePolling() {
    if (employeePollTimer) {
      clearInterval(employeePollTimer);
      employeePollTimer = null;
    }
    knownEmployeeTaskIds = new Set();
  }

  function notifyNewEmployeeTasks(tasks, isInitialLoad) {
    const incomingIds = new Set(tasks.map((task) => task.id));

    if (isInitialLoad || knownEmployeeTaskIds.size === 0) {
      knownEmployeeTaskIds = incomingIds;
      return;
    }

    const newTasks = tasks.filter((task) => !knownEmployeeTaskIds.has(task.id));
    knownEmployeeTaskIds = incomingIds;

    newTasks.forEach((task) => {
      startTitleAlert();
      showTaskAlert('Nova tarefa recebida', task.titulo);
      playNotificationSound();
      showBrowserNotification(task);
    });
  }

  function startTitleAlert(label = 'Nova tarefa!') {
    titleAlertLabel = label;
    unreadTaskNotifications += 1;
    setBrowserAttentionTitle();
    setFaviconBadge(unreadTaskNotifications);
    if (titleAlertTimer) return;

    let visible = false;
    titleAlertTimer = setInterval(() => {
      visible = !visible;
      setDocumentTitle(visible ? `(${unreadTaskNotifications}) ${titleAlertLabel}` : originalPageTitle);
    }, 1000);
  }

  function clearTitleAlert() {
    unreadTaskNotifications = 0;
    if (titleAlertTimer) {
      clearInterval(titleAlertTimer);
      titleAlertTimer = null;
    }
    setDocumentTitle(originalPageTitle);
    clearFaviconBadge();
  }

  function setBrowserAttentionTitle() {
    setDocumentTitle(`(${unreadTaskNotifications}) ${titleAlertLabel}`);
  }

  function setDocumentTitle(title) {
    document.title = title;

    try {
      if (window.parent && window.parent !== window) window.parent.document.title = title;
    } catch (error) {}

    try {
      if (window.top && window.top !== window) window.top.document.title = title;
    } catch (error) {}
  }

  function setFaviconBadge(count) {
    const favicon = getFaviconElement();
    if (!originalFaviconHref) originalFaviconHref = favicon.href || '';

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(44, 20, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.min(count, 9)), 44, 20);

    favicon.href = canvas.toDataURL('image/png');
  }

  function clearFaviconBadge() {
    const favicon = getFaviconElement();
    if (originalFaviconHref) {
      favicon.href = originalFaviconHref;
    }
  }

  function getFaviconElement() {
    let favicon = document.querySelector('link[rel="icon"]');
    if (!favicon) {
      favicon = document.createElement('link');
      favicon.rel = 'icon';
      document.head.appendChild(favicon);
    }
    return favicon;
  }

  function showTaskAlert(title, message) {
    let alert = $('#taskAlert');
    if (!alert) {
      alert = document.createElement('div');
      alert.id = 'taskAlert';
      alert.className = 'fixed right-4 top-4 z-[60] hidden max-w-sm rounded-xl border border-cyan-200 bg-white p-4 shadow-2xl';
      document.body.appendChild(alert);
    }

    alert.innerHTML = `
      <div class="flex items-start gap-3">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-500 text-sm font-black text-white">!</div>
        <div>
          <p class="font-black text-slate-900">${escapeHtml(title)}</p>
          <p class="mt-1 text-sm text-slate-600">${escapeHtml(message)}</p>
        </div>
      </div>
    `;
    alert.classList.remove('hidden');
    setTimeout(() => alert.classList.add('hidden'), 7000);
  }

  function showBrowserNotification(task) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    new Notification('Nova tarefa recebida', {
      body: `${task.titulo} - Prazo: ${task.dataPrazo || 'sem prazo'}`,
      tag: task.id,
    });
  }

  function unlockNotificationSound() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    if (!audioContext) audioContext = new AudioContext();
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
  }

  function playNotificationSound() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    if (!audioContext) audioContext = new AudioContext();
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }

    const now = audioContext.currentTime;
    playTone(now, 740, 0.2, 0.45);
    playTone(now + 0.22, 988, 0.22, 0.55);
    playTone(now + 0.48, 1319, 0.28, 0.5);
  }

  function playTone(startTime, frequency, duration, volume) {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, startTime);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.02);
  }

  function priorityBadge(priority) {
    const classes = {
      Baixa: 'bg-slate-100 text-slate-700',
      Media: 'bg-blue-50 text-blue-700',
      Alta: 'bg-amber-50 text-amber-700',
      Urgente: 'bg-red-50 text-red-700',
    };
    return `<span class="badge ${classes[priority] || classes.Media}">${escapeHtml(priority || 'Media')}</span>`;
  }

  function statusBadge(status) {
    const classes = {
      Pendente: 'bg-slate-100 text-slate-700',
      'Em Andamento': 'bg-blue-50 text-blue-700',
      Concluida: 'bg-emerald-50 text-emerald-700',
    };
    return `<span class="badge ${classes[status] || classes.Pendente}">${escapeHtml(status || 'Pendente')}</span>`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function normalizeEmailClient(email) {
    return String(email || '').trim().toLowerCase();
  }
