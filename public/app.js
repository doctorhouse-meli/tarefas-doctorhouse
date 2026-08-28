let currentUser = null;
  let authToken = '';
  let adminData = { tasks: [], usuarios: [], colaboradores: [], workspaces: [], stats: {} };
  let selectedTask = null;
  let titleAlertLabel = 'Nova tarefa!';
  let adminPollTimer = null;
  let employeePollTimer = null;
  let employeeTaskFilter = 'pending';
  let employeePendingFilter = 'today';
  let currentEmployeeTasks = [];
  let currentEmployeeRequests = [];
  let knownEmployeeTaskIds = new Set();
  let knownRequestStatuses = new Map();
  let requestStatusBootstrapped = false;
  let knownAdminCompletionObs = new Set();
  let adminCompletionObsBootstrapped = false;
  let requestAdmins = [];
  let adminDefaultFilterApplied = false;
  let audioContext = null;
  let originalPageTitle = document.title || 'Dashboard de Tarefas';
  let originalFaviconHref = '';
  let titleAlertTimer = null;
  let unreadTaskNotifications = 0;
  const SESSION_LOGIN_KEY = 'taskDashboardSessionLogin';
  const SESSION_COOKIE_KEY = 'taskDashboardSessionLoginCookie';
  const NOTIFICATION_PROMPT_KEY = 'taskDashboardNotificationPromptHandledV2';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  document.addEventListener('DOMContentLoaded', () => {
    initTimeSelectors();
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
    $('#requestAdminForm').addEventListener('submit', handleCreateAdminRequest);
    $('#completeTaskForm').addEventListener('submit', handleCompleteTaskWithNote);
    $('#employeeTaskFilters').addEventListener('click', handleEmployeeFilterClick);
    $('#employeeSummary').addEventListener('click', handleEmployeeFilterClick);
    $('#backToMyTasksBtn').addEventListener('click', () => openMyTasks(false));
    $('#openAdminControlBtn').addEventListener('click', openAdminControl);
    $('#openRequestAdminBtn').addEventListener('click', () => openAdminRequest());
    $('#requestFromDetailsBtn').addEventListener('click', () => openAdminRequest(selectedTask));
    $('#openEmployeeTemplatesBtn').addEventListener('click', async () => {
      await loadEmployeeTemplates();
      openModal('employeeTemplatesListModal');
    });
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
      if (currentUser) clearTitleAlert();
    });
    document.addEventListener('click', () => {
      if (currentUser) clearTitleAlert();
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
    stopAdminPolling();
    stopEmployeePolling();
    clearSessionLogin();
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
      clearSessionLogin();
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
      await openMyTasks(true);
    } else {
      stopAdminPolling();
      await loadEmployee(true);
      startEmployeePolling();
    }
    maybeShowNotificationPrompt();
  }

  function saveSessionLogin(email, senha) {
    const login = {
      email,
      senha,
      savedAt: new Date().toISOString(),
    };
    const serialized = JSON.stringify(login);
    sessionStorage.setItem(SESSION_LOGIN_KEY, serialized);
    setSessionCookie(SESSION_COOKIE_KEY, serialized);
  }

  function getSessionLogin() {
    try {
      const raw = sessionStorage.getItem(SESSION_LOGIN_KEY) || getCookie(SESSION_COOKIE_KEY);
      if (!raw) return null;
      sessionStorage.setItem(SESSION_LOGIN_KEY, raw);
      return JSON.parse(raw);
    } catch (error) {
      clearSessionLogin();
      return null;
    }
  }

  function clearSessionLogin() {
    sessionStorage.removeItem(SESSION_LOGIN_KEY);
    document.cookie = `${SESSION_COOKIE_KEY}=; path=/; SameSite=Lax; max-age=0`;
  }

  function setSessionCookie(name, value) {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; SameSite=Lax`;
  }

  function getCookie(name) {
    const prefix = `${name}=`;
    const cookie = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix));
    return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : '';
  }

  async function loadAdmin() {
    $('#adminView').classList.remove('hidden');
    $('#employeeView').classList.add('hidden');
    adminData = await callServer('getAdminDashboardData');
    notifyAdminCompletionNotes(adminData.tasks || []);
    renderAdminStats();
    renderAdminTodayPanel();
    renderAdminSelects();
    if (!adminDefaultFilterApplied) {
      $('#filterStatus').value = 'Pendente';
      adminDefaultFilterApplied = true;
    }
    renderAdminTasks();
    renderAdminUsers();
  }

  async function openAdminControl() {
    if (!currentUser || currentUser.perfil !== 'Admin') return;
    stopEmployeePolling();
    await loadAdmin();
    startAdminPolling();
  }

  async function openMyTasks(isInitialLoad = false) {
    if (!currentUser) return;
    stopAdminPolling();
    await loadEmployee(isInitialLoad);
    startEmployeePolling();
  }

  function startAdminPolling() {
    stopAdminPolling();
    adminPollTimer = setInterval(async () => {
      if (!currentUser || currentUser.perfil !== 'Admin') return;
      if (!$('#adminView') || $('#adminView').classList.contains('hidden')) return;
      if ($$('.modal').some((modal) => !modal.classList.contains('hidden'))) return;

      try {
        await loadAdmin();
      } catch (error) {
        console.log('Falha ao atualizar painel admin.', error);
      }
    }, 10000);
  }

  function stopAdminPolling() {
    if (adminPollTimer) {
      clearInterval(adminPollTimer);
      adminPollTimer = null;
    }
    knownAdminCompletionObs = new Set();
    adminCompletionObsBootstrapped = false;
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
    `).join('') || '<p class="text-sm text-slate-400">Sem responsaveis.</p>';
  }

  function renderAdminTodayTask(task) {
    return `
      <div class="admin-mini-card">
        <p class="text-sm font-black text-slate-900">${escapeHtml(task.titulo)}</p>
        <p class="mt-1 text-xs text-slate-500">${escapeHtml(getUserLabelByEmail(task.atribuidoPara))} | ${escapeHtml(formatTaskSchedule(task))}</p>
      </div>
    `;
  }

  function renderAdminSelects() {
    const selectedEmployee = $('#filterEmployee').value;
    const selectedWorkspace = $('#filterWorkspace').value;
    const selectedStatus = $('#filterStatus').value;
    const responsaveis = adminData.usuarios || [];

    const employeeOptions = ['<option value="">Todos</option>']
      .concat(responsaveis.map((user) => `<option value="${escapeHtml(user.email)}">${escapeHtml(formatUserOptionLabel(user))}</option>`))
      .join('');
    $('#filterEmployee').innerHTML = employeeOptions;
    setSelectValueIfExists($('#filterEmployee'), selectedEmployee);

    const workspaceOptions = ['<option value="">Todos</option>']
      .concat(adminData.workspaces.map((workspace) => `<option value="${escapeHtml(workspace.nome)}">${escapeHtml(workspace.nome)}</option>`))
      .join('');
    $('#filterWorkspace').innerHTML = workspaceOptions;
    setSelectValueIfExists($('#filterWorkspace'), selectedWorkspace);
    setSelectValueIfExists($('#filterStatus'), selectedStatus);

    $$('.employeeSelect').forEach((select) => {
      select.innerHTML = responsaveis
        .map((user) => `<option value="${escapeHtml(user.email)}">${escapeHtml(formatUserOptionLabel(user))}</option>`)
        .join('');
    });

    $$('.workspaceSelect').forEach((select) => {
      select.innerHTML = adminData.workspaces
        .map((workspace) => `<option value="${escapeHtml(workspace.nome)}">${escapeHtml(workspace.nome)}</option>`)
        .join('');
    });
  }

  function setSelectValueIfExists(select, value) {
    if (!select || value === undefined || value === null) return;
    if (Array.from(select.options).some((option) => option.value === value || option.textContent === value)) {
      select.value = value;
    }
  }

  function formatUserOptionLabel(user) {
    return `${user.nome || user.email} - ${user.perfil || 'Usuario'}`;
  }

  function getUserLabelByEmail(email) {
    const user = (adminData.usuarios || []).find((item) => normalizeEmailClient(item.email) === normalizeEmailClient(email));
    return user ? user.nome : email;
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
          ${task.obsConclusao ? `<div class="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">Obs ao concluir: ${escapeHtml(task.obsConclusao)}</div>` : ''}
        </td>
        <td class="px-4 py-3">
          <div class="font-bold text-slate-800">${escapeHtml(getUserLabelByEmail(task.atribuidoPara))}</div>
          <div class="text-xs text-slate-400">${escapeHtml(task.atribuidoPara || '')}</div>
        </td>
        <td class="px-4 py-3">${priorityBadge(task.prioridade)}</td>
        <td class="px-4 py-3">${escapeHtml(formatTaskSchedule(task))}</td>
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
          <div class="flex justify-end gap-2">
            <button class="editUserBtn row-btn" data-user-id="${escapeHtml(user.id)}">Editar</button>
            ${normalizeEmailClient(user.email) !== normalizeEmailClient(currentUser.email) ? `<button class="deleteUserBtn row-btn row-btn-danger" data-user-id="${escapeHtml(user.id)}" data-user-name="${escapeHtml(user.nome)}">Excluir</button>` : ''}
          </div>
        </td>
      </tr>
    `).join('') || `
      <tr>
        <td colspan="5" class="px-4 py-6 text-center text-sm text-slate-500">Nenhum usuario cadastrado.</td>
      </tr>
    `;

    $$('.editUserBtn').forEach((button) => {
      button.addEventListener('click', () => openEditUser(button.dataset.userId));
    });
    $$('.deleteUserBtn').forEach((button) => {
      button.addEventListener('click', () => handleDeleteUser(button.dataset.userId, button.dataset.userName));
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
    setTimeField(form, 'horarioPrazo', task.horarioPrazo || '');
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
    $('#openAdminControlBtn').classList.toggle('hidden', currentUser?.perfil !== 'Admin');
    $('#openRequestAdminBtn').classList.toggle('hidden', !canRequestAdmin());
    const tasks = prepareEmployeeTasks(await callServer('getEmployeeTasks', currentUser.email));
    currentEmployeeTasks = tasks;
    currentEmployeeRequests = canRequestAdmin() ? await callServer('getMyAdminRequests', currentUser.email) : [];
    notifyNewEmployeeTasks(tasks, isInitialLoad);
    notifyRequestStatusChanges(currentEmployeeRequests, isInitialLoad);
    renderEmployeeSummary(tasks);
    renderEmployeeRequests(currentEmployeeRequests);
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
                <td class="px-3 py-2 text-xs font-bold text-slate-500">${escapeHtml(template.workspace || '')}<br>${escapeHtml(template.diasSemanaLabel || '')}${template.horarioPrazo ? `<br>${escapeHtml(template.horarioPrazo)}` : ''}</td>
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
        const dueA = getScheduleSortValue(a);
        const dueB = getScheduleSortValue(b);
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
      const dueA = getScheduleSortValue(a);
      const dueB = getScheduleSortValue(b);
      if (dueA !== dueB) return dueA - dueB;
      return String(a.titulo || '').localeCompare(String(b.titulo || ''));
    });
  }

  function sortOldestFirst(tasks) {
    return [...tasks].sort((a, b) => {
      const dueA = getScheduleSortValue(a);
      const dueB = getScheduleSortValue(b);
      if (dueA !== dueB) return dueA - dueB;
      const createdA = Number(a.dataCriacaoSort || 0);
      const createdB = Number(b.dataCriacaoSort || 0);
      if (createdA !== createdB) return createdA - createdB;
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
    if (task.dataPrazo) return getScheduleSortValue(task);
    return 0;
  }

  function getScheduleSortValue(task) {
    if (!task.dataPrazo) return Number.MAX_SAFE_INTEGER;
    const time = task.horarioPrazo || '23:59';
    return new Date(`${task.dataPrazo}T${time}:00`).getTime();
  }

  function formatTaskSchedule(task) {
    if (!task.dataPrazo) return 'Sem prazo';
    return task.horarioPrazo ? `${task.dataPrazo} - ${task.horarioPrazo}` : task.dataPrazo;
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
    const overdue = tasks.filter((task) => task.status !== 'Concluida' && getTaskDueKey(task) === 'overdue').length;
    const next = tasks.filter((task) => task.status !== 'Concluida' && getTaskDueKey(task) === 'next').length;
    const done = getDoneTasks(tasks).length;

    $('#employeeSummary').innerHTML = `
      <button type="button" class="employee-summary-card summary-today ${employeeTaskFilter === 'pending' ? 'is-active' : ''}" data-filter="pending">
        <p>Pendentes</p>
        <strong>${pending}</strong>
        <span>aguardando execucao</span>
      </button>
      <button type="button" class="employee-summary-card summary-next ${employeeTaskFilter === 'doing' ? 'is-active' : ''}" data-filter="doing">
        <p>Em andamento</p>
        <strong>${doing}</strong>
        <span>tarefas iniciadas</span>
      </button>
      <button type="button" class="employee-summary-card summary-overdue ${employeeTaskFilter === 'overdue' ? 'is-active' : ''}" data-filter="overdue">
        <p>Atrasadas</p>
        <strong>${overdue}</strong>
        <span>pendentes vencidas</span>
      </button>
      <button type="button" class="employee-summary-card summary-next ${employeeTaskFilter === 'next' ? 'is-active' : ''}" data-filter="next">
        <p>Proximos dias</p>
        <strong>${next}</strong>
        <span>agendadas para depois</span>
      </button>
      <button type="button" class="employee-summary-card summary-daily ${employeeTaskFilter === 'done' ? 'is-active' : ''}" data-filter="done">
        <p>Concluidas</p>
        <strong>${done}</strong>
        <span>finalizadas</span>
      </button>
    `;
  }

  function renderEmployeeRequests(requests) {
    const panel = $('#employeeRequestsPanel');
    if (!canRequestAdmin()) {
      panel.classList.add('hidden');
      panel.innerHTML = '';
      return;
    }

    const visible = [...requests].slice(0, 6);
    panel.classList.remove('hidden');
    panel.innerHTML = `
      <section class="employee-requests-panel">
        <div class="employee-requests-header">
          <div>
            <h2>Pedidos ao admin</h2>
            <p>${requests.length} pedido${requests.length === 1 ? '' : 's'} enviado${requests.length === 1 ? '' : 's'}</p>
          </div>
          <button type="button" class="employee-secondary-action" id="newRequestFromPanelBtn">Novo pedido</button>
        </div>
        <div class="employee-request-list">
          ${visible.map(renderEmployeeRequestItem).join('') || '<p class="rounded-md bg-white p-3 text-sm font-medium text-slate-500">Nenhum pedido enviado ainda.</p>'}
        </div>
      </section>
    `;

    $('#newRequestFromPanelBtn').addEventListener('click', () => openAdminRequest());
    $$('.requestDetailsBtn').forEach((button) => {
      button.addEventListener('click', () => openTaskDetails(currentEmployeeRequests.find((task) => task.id === button.dataset.taskId)));
    });
  }

  function renderEmployeeRequestItem(task) {
    return `
      <button type="button" class="requestDetailsBtn employee-request-item is-${task.status === 'Concluida' ? 'done' : task.status === 'Em Andamento' ? 'progress' : 'pending'}" data-task-id="${escapeHtml(task.id)}">
        <span class="min-w-0">
          <strong>${escapeHtml(task.titulo)}</strong>
          <small>${escapeHtml(formatTaskSchedule(task))}</small>
        </span>
        ${statusBadge(task.status)}
      </button>
    `;
  }

  function renderEmployeeTaskFilters(tasks) {
    const counts = {
      pending: getPendingTasks(tasks).length,
      doing: getDoingTasks(tasks).length,
      overdue: tasks.filter((task) => task.status !== 'Concluida' && getTaskDueKey(task) === 'overdue').length,
      next: tasks.filter((task) => task.status !== 'Concluida' && getTaskDueKey(task) === 'next').length,
      done: tasks.filter((task) => task.status === 'Concluida').length,
    };

    const filters = [
      ['pending', 'Pendentes'],
      ['doing', 'Em andamento'],
      ['overdue', 'Atrasadas'],
      ['next', 'Proximos dias'],
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
    const button = event.target.closest('.employee-summary-card, .employee-filter-btn');
    if (!button) return;

    employeeTaskFilter = button.dataset.filter || 'pending';
    if (employeeTaskFilter === 'pending' && !employeePendingFilter) employeePendingFilter = 'today';
    renderEmployeeSummary(currentEmployeeTasks);
    renderEmployeeTaskFilters(currentEmployeeTasks);
    renderEmployeeTasks(applyEmployeeTaskFilter(currentEmployeeTasks));
  }

  function applyEmployeeTaskFilter(tasks) {
    if (employeeTaskFilter === 'done') return sortOldestFirst(getDoneTasks(tasks));
    if (employeeTaskFilter === 'doing') return sortOldestFirst(getDoingTasks(tasks));
    if (employeeTaskFilter === 'pending') return sortOldestFirst(getPendingTasksByPendingFilter(tasks));
    if (employeeTaskFilter === 'overdue') return sortOldestFirst(tasks.filter((task) => task.status !== 'Concluida' && getTaskDueKey(task) === 'overdue'));
    if (employeeTaskFilter === 'next') return sortOldestFirst(getTasksByDueKey(tasks, 'next'));
    return sortEmployeeTasks(getDefaultEmployeeVisibleTasks(tasks));
  }

  function getTasksByPendingFilter(tasks, filterKey) {
    return getOpenTasks(tasks).filter((task) => {
      const dueKey = getTaskDueKey(task);
      if (filterKey === 'overdue') return dueKey === 'overdue';
      if (filterKey === 'next') return dueKey === 'next';
      return dueKey === 'today' || dueKey === 'overdue';
    });
  }

  function getPendingTasksByPendingFilter(tasks) {
    return getTasksByPendingFilter(tasks, employeePendingFilter || 'today');
  }

  function renderEmployeeTasks(tasks) {
    const titles = {
      pending: 'Tarefas pendentes',
      doing: 'Tarefas em andamento',
      overdue: 'Tarefas atrasadas',
      next: 'Tarefas dos proximos dias',
      done: 'Tarefas concluidas',
    };

    $('#employeeTasks').innerHTML = `
      <section class="employee-list-panel">
        <div class="employee-list-header">
          <div>
            <h2>${titles[employeeTaskFilter] || 'Minhas tarefas'}</h2>
            <p>${tasks.length} tarefa${tasks.length === 1 ? '' : 's'} encontrada${tasks.length === 1 ? '' : 's'}</p>
          </div>
        </div>
        ${employeeTaskFilter === 'pending' ? renderPendingSubfilters() : ''}
        <div class="employee-list-table">
          ${tasks.map(renderEmployeeTaskCard).join('') || '<p class="rounded-md bg-slate-50 p-4 text-sm font-medium text-slate-500">Nenhuma tarefa nesta visualizacao.</p>'}
        </div>
      </section>
    `;

    $$('.taskDetailsBtn').forEach((button) => {
      button.addEventListener('click', () => openTaskDetails(tasks.find((task) => task.id === button.dataset.taskId)));
    });
    $$('.statusBtn').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.dataset.status === 'Concluida') {
          openCompleteTaskModal(button.dataset.taskId);
          return;
        }
        changeStatus(button.dataset.taskId, button.dataset.status);
      });
    });
    $$('.requestAdminBtn').forEach((button) => {
      button.addEventListener('click', () => openAdminRequest(currentEmployeeTasks.find((task) => task.id === button.dataset.taskId)));
    });
    $$('.pending-subfilter-btn').forEach((button) => {
      button.addEventListener('click', () => {
        employeePendingFilter = button.dataset.pendingFilter || 'today';
        renderEmployeeTasks(applyEmployeeTaskFilter(currentEmployeeTasks));
      });
    });
  }

  function renderPendingSubfilters() {
    const counts = {
      today: getTasksByPendingFilter(currentEmployeeTasks, 'today').length,
      overdue: getTasksByPendingFilter(currentEmployeeTasks, 'overdue').length,
      next: getTasksByPendingFilter(currentEmployeeTasks, 'next').length,
    };
    const filters = [
      ['today', 'Hoje + atrasadas'],
      ['overdue', 'Atrasadas'],
      ['next', 'Proximos dias'],
    ];
    return `
      <div class="pending-subfilters">
        ${filters.map(([key, label]) => `
          <button class="pending-subfilter-btn ${employeePendingFilter === key ? 'is-active' : ''}" data-pending-filter="${key}">
            <span>${label}</span>
            <strong>${counts[key]}</strong>
          </button>
        `).join('')}
      </div>
    `;
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
    const requestButton = canRequestAdmin() && task.status !== 'Concluida'
      ? `<button class="requestAdminBtn employee-action-btn is-request" data-task-id="${escapeHtml(task.id)}">Pedir ao admin</button>`
      : '';

    if (task.status === 'Pendente') {
      return `
        <button class="statusBtn employee-action-btn is-start" data-task-id="${escapeHtml(task.id)}" data-status="Em Andamento">Comecar</button>
        <button class="statusBtn employee-action-btn is-finish" data-task-id="${escapeHtml(task.id)}" data-status="Concluida">Concluir</button>
        ${requestButton}
      `;
    }

    if (task.status === 'Em Andamento') {
      return `
        <button class="statusBtn employee-action-btn is-finish" data-task-id="${escapeHtml(task.id)}" data-status="Concluida">Concluir</button>
        ${requestButton}
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
    const schedule = formatTaskSchedule(task);
    if (task.status === 'Concluida') return `Prazo: ${schedule}`;
    if (dueKey === 'today') return `Hoje: ${schedule}`;
    if (dueKey === 'overdue') return `Vencida: ${schedule}`;
    return `Prazo: ${schedule}`;
  }

  function getStatusWeight(status) {
    if (status === 'Em Andamento') return 0;
    if (status === 'Pendente') return 1;
    return 2;
  }

  function openCompleteTaskModal(taskId) {
    const form = $('#completeTaskForm');
    form.reset();
    form.elements.taskId.value = taskId;
    openModal('completeTaskModal');
  }

  async function handleCompleteTaskWithNote(event) {
    event.preventDefault();
    const form = event.target;
    await changeStatus(form.elements.taskId.value, 'Concluida', form.elements.obsConclusao.value);
    form.reset();
    closeModals();
  }

  async function changeStatus(taskId, status, completionNote = '') {
    await callServer('updateTaskStatus', taskId, status, currentUser.email, completionNote);
    showToast('Status atualizado.');
    await loadEmployee(false);
  }

  async function openTaskDetails(task) {
    selectedTask = task;
    $('#detailsTitle').textContent = task.titulo;
    $('#detailsDescription').textContent = task.descricao || 'Sem descricao.';
    const isOwnAssignedTask = normalizeEmailClient(task.atribuidoPara) === normalizeEmailClient(currentUser.email);
    $('#requestFromDetailsBtn').classList.toggle('hidden', !canRequestAdmin() || !isOwnAssignedTask || task.status === 'Concluida');
    openModal('detailsModal');
    await Promise.all([
      loadComments(task.id),
      loadChecklist(task.id),
      loadHistory(task.id),
    ]);
  }

  function canRequestAdmin() {
    return currentUser?.perfil === 'Solicitante';
  }

  async function loadRequestAdmins() {
    if (!canRequestAdmin()) return [];
    if (!requestAdmins.length) requestAdmins = await callServer('getRequestAdmins', currentUser.email);
    return requestAdmins;
  }

  async function openAdminRequest(task = null) {
    if (!canRequestAdmin()) {
      showToast('Seu perfil nao permite enviar pedidos ao admin.');
      return;
    }

    const admins = await loadRequestAdmins();
    if (!admins.length) {
      showToast('Nenhum admin cadastrado para receber pedidos.');
      return;
    }

    const form = $('#requestAdminForm');
    form.reset();
    form.elements.taskId.value = task?.id || '';
    form.elements.adminEmail.innerHTML = admins
      .map((admin) => `<option value="${escapeHtml(admin.email)}">${escapeHtml(admin.nome)}</option>`)
      .join('');
    form.elements.titulo.value = task ? task.titulo : '';
    form.elements.prioridade.value = task?.prioridade || 'Media';
    form.elements.dataPrazo.value = toDateKey(new Date());
    setTimeField(form, 'horarioPrazo', '');
    if (task) {
      form.elements.descricao.placeholder = 'Explique o que precisa para concluir esta tarefa';
    } else {
      form.elements.descricao.placeholder = 'Explique o que precisa do admin';
    }
    closeModals();
    openModal('requestAdminModal');
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
    employeePendingFilter = 'today';
    await loadEmployee(false);
  }

  async function handleCreateAdminRequest(event) {
    event.preventDefault();
    await callServer('createAdminRequest', formToObject(event.target), currentUser.email);
    event.target.reset();
    closeModals();
    showToast('Pedido enviado ao admin.');
    employeeTaskFilter = 'pending';
    employeePendingFilter = 'today';
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
      const updatedUser = await callServer('updateUser', data.id, data);
      if (normalizeEmailClient(data.emailOriginal || currentUser.email) === normalizeEmailClient(currentUser.email)) {
        const savedLogin = getSessionLogin() || {};
        currentUser = { ...currentUser, ...updatedUser };
        saveSessionLogin(updatedUser.email, data.senha || savedLogin.senha || $('#loginPassword').value || '');
        $('#userInfo').textContent = `${currentUser.nome} - ${currentUser.perfil} - ${currentUser.workspace}`;
      }
      showToast('Usuario atualizado.');
    } else {
      await callServer('registerUser', data);
      showToast('Usuario cadastrado.');
    }
    event.target.reset();
    closeModals();
    await loadAdmin();
  }

  async function handleDeleteUser(userId, userName) {
    const ok = confirm(`Deseja excluir o usuario ${userName || ''}? Ele nao conseguira mais entrar, e os modelos diarios dele serao removidos.`);
    if (!ok) return;

    await callServer('deleteUser', userId, currentUser.email);
    showToast('Usuario excluido.');
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

  function formToObject(form) {
    syncTimeFields(form);
    const data = {};
    const formData = new FormData(form);
    for (const [key, value] of formData.entries()) {
      data[key] = data[key] ? `${data[key]},${value}` : value;
    }
    return data;
  }

  function initTimeSelectors() {
    $$('.time-select').forEach((container) => {
      const hour = container.querySelector('[data-time-hour]');
      const minute = container.querySelector('[data-time-minute]');
      const hidden = container.querySelector('input[type="hidden"]');
      if (!hour || !minute || !hidden) return;

      hour.innerHTML = '<option value="">Hora</option>' + Array.from({ length: 24 }, (_, index) => {
        const value = String(index).padStart(2, '0');
        return `<option value="${value}">${value}</option>`;
      }).join('');
      minute.innerHTML = '<option value="">Min</option>' + ['00', '15', '30', '45'].map((value) => `<option value="${value}">${value}</option>`).join('');

      const sync = () => {
        hidden.value = hour.value && minute.value ? `${hour.value}:${minute.value}` : '';
      };
      hour.addEventListener('change', sync);
      minute.addEventListener('change', sync);
    });
  }

  function setTimeField(form, fieldName, value) {
    const hidden = form.elements[fieldName];
    if (hidden) hidden.value = value || '';
    const container = form.querySelector(`.time-select[data-time-field="${fieldName}"]`);
    if (!container) return;
    const [hourValue = '', minuteValue = ''] = String(value || '').split(':');
    const hour = container.querySelector('[data-time-hour]');
    const minute = container.querySelector('[data-time-minute]');
    if (hour) hour.value = hourValue;
    if (minute) minute.value = minuteValue;
  }

  function syncTimeFields(form) {
    form.querySelectorAll('.time-select').forEach((container) => {
      const hidden = container.querySelector('input[type="hidden"]');
      const hour = container.querySelector('[data-time-hour]');
      const minute = container.querySelector('[data-time-minute]');
      if (!hidden || !hour || !minute) return;
      hidden.value = hour.value && minute.value ? `${hour.value}:${minute.value}` : '';
    });
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
      if (!currentUser || $('#employeeView').classList.contains('hidden')) return;
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
    knownRequestStatuses = new Map();
    requestStatusBootstrapped = false;
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

  function notifyRequestStatusChanges(requests, isInitialLoad) {
    if (!canRequestAdmin()) return;
    const activeStatuses = new Map(requests.map((task) => [task.id, task.status]));

    if (isInitialLoad || !requestStatusBootstrapped) {
      knownRequestStatuses = activeStatuses;
      requestStatusBootstrapped = true;
      return;
    }

    requests.forEach((task) => {
      const oldStatus = knownRequestStatuses.get(task.id);
      if (oldStatus && oldStatus !== task.status) {
        const message = `${task.titulo} agora esta ${task.status}.`;
        startTitleAlert('Pedido atualizado!');
        showTaskAlert('Pedido atualizado pelo admin', message);
        playNotificationSound();
        showBrowserStatusNotification('Pedido atualizado pelo admin', message, `pedido-${task.id}-${task.status}`);
      }
      knownRequestStatuses.set(task.id, task.status);
    });
  }

  function notifyAdminCompletionNotes(tasks) {
    if (!currentUser || currentUser.perfil !== 'Admin') return;
    const notedTasks = tasks.filter((task) => task.obsConclusao);
    const currentKeys = new Set(notedTasks.map((task) => `${task.id}:${task.obsConclusao}`));

    if (!adminCompletionObsBootstrapped) {
      knownAdminCompletionObs = currentKeys;
      adminCompletionObsBootstrapped = true;
      return;
    }

    notedTasks.forEach((task) => {
      const key = `${task.id}:${task.obsConclusao}`;
      if (knownAdminCompletionObs.has(key)) return;
      knownAdminCompletionObs.add(key);
      const message = `${task.titulo}: ${task.obsConclusao}`;
      startTitleAlert('Obs de conclusao!');
      showTaskAlert('Observacao ao concluir tarefa', message);
      playNotificationSound();
      showBrowserStatusNotification('Observacao ao concluir tarefa', message, `obs-${task.id}`);
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

    alert.onclick = null;
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
      body: `${task.titulo} - Prazo: ${formatTaskSchedule(task)}`,
      tag: task.id,
    });
  }

  function showBrowserStatusNotification(title, body, tag) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    new Notification(title, { body, tag });
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
