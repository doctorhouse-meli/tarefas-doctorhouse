let taskCreatorSaving = false;
let creatorReturnTab = 'overview';

function initTaskCreator() {
  document.querySelectorAll('[data-open-task-creator]').forEach(button => button.addEventListener('click', () => {
    if (activeAdminTab !== 'create') creatorReturnTab = activeAdminTab;
    populateTaskCreator();
    setAdminTab('create');
    document.querySelector('#creatorTitle').focus();
  }));
  document.querySelector('#creatorCancel').addEventListener('click', () => setAdminTab(creatorReturnTab));
  document.querySelector('#taskCreatorForm').addEventListener('submit', submitTaskCreator);
  document.querySelector('#creatorRepeat').addEventListener('change', updateCreatorRecurrence);
  document.querySelector('#creatorWeekday').addEventListener('change', updateCreatorRecurrence);
  document.querySelectorAll('[name=creatorDays]').forEach(input => input.addEventListener('change', updateCreatorRecurrence));
  updateCreatorRecurrence();
}

function populateTaskCreator() {
  for (const [id, entries] of [
    ['creatorEmployee', (adminData.usuarios || []).map(user => [user.email, formatUserOptionLabel(user)])],
    ['creatorWorkspace', (adminData.workspaces || []).map(space => [space.nome, space.nome])]
  ]) {
    const select = document.getElementById(id);
    const selected = select.value;
    select.innerHTML = '<option value="">Selecione...</option>' + entries.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
    if (entries.some(([value]) => value === selected)) select.value = selected;
    else if (id === 'creatorWorkspace' && entries.some(([value]) => value === currentUser.workspace)) select.value = currentUser.workspace;
  }
  const date = document.querySelector('#creatorDate');
  if (!date.value) date.value = toDateKey(new Date());
}

function creatorRepeatDays(mode, weekday, selectedDays = []) {
  if (mode === 'daily') return '0,1,2,3,4,5,6';
  if (mode === 'weekdays') return '1,2,3,4,5';
  if (mode === 'weekly') {
    if (!/^[0-6]$/.test(String(weekday))) throw new Error('Escolha o dia da semana.');
    return String(weekday);
  }
  if (mode === 'custom') {
    const days = [...new Set(selectedDays.map(String))].filter(day => /^[0-6]$/.test(day)).sort();
    if (!days.length) throw new Error('Selecione pelo menos um dia para repetir.');
    return days.join(',');
  }
  if (mode !== 'none') throw new Error('Escolha uma opção de repetição válida.');
  return '';
}

function updateCreatorRecurrence() {
  const mode = document.querySelector('#creatorRepeat').value;
  const recurring = mode !== 'none';
  document.querySelector('#creatorDateField').classList.toggle('hidden', recurring);
  document.querySelector('#creatorDate').disabled = recurring;
  document.querySelector('#creatorDate').required = !recurring;
  document.querySelector('#creatorWeeklyField').classList.toggle('hidden', mode !== 'weekly');
  document.querySelector('#creatorCustomDays').classList.toggle('hidden', mode !== 'custom');
  document.querySelector('#creatorSubmit').textContent = recurring ? 'Criar tarefa recorrente' : 'Criar tarefa';
  const weekday = document.querySelector('#creatorWeekday').selectedOptions[0].textContent;
  const names = { daily:'Todos os dias, incluindo sábado e domingo.', weekdays:'De segunda a sexta-feira.', weekly:`Toda semana, ${weekday.toLowerCase()}.`, custom:'Toda semana, nos dias selecionados.', none:'Uma única tarefa, no prazo escolhido.' };
  document.querySelector('#creatorRepeatSummary').textContent = names[mode] + (recurring ? ' A programação vale a partir de hoje. A tarefa de hoje será criada se hoje fizer parte da repetição. Continua até a programação ser excluída em Tarefas diárias do responsável.' : '');
  document.querySelector('#creatorError').classList.add('hidden');
}

async function submitTaskCreator(event) {
  event.preventDefault();
  if (taskCreatorSaving) return;
  const form = event.target, errorBox = document.querySelector('#creatorError');
  errorBox.classList.add('hidden');
  const mode = document.querySelector('#creatorRepeat').value;
  let days;
  try {
    days = creatorRepeatDays(mode, document.querySelector('#creatorWeekday').value,
      Array.from(form.querySelectorAll('[name=creatorDays]:checked'), input => input.value));
  } catch (error) {
    errorBox.textContent = error.message; errorBox.classList.remove('hidden'); return;
  }
  const values = new FormData(form);
  const data = Object.fromEntries(['titulo','descricao','prioridade','atribuidoPara','workspace','horarioPrazo'].map(key => [key, values.get(key) || '']));
  data.autorEmail = currentUser.email;
  if (mode === 'none') { data.dataPrazo = values.get('dataPrazo'); data.status = 'Pendente'; }
  else data.diasSemana = days;
  taskCreatorSaving = true;
  const button = document.querySelector('#creatorSubmit');
  button.disabled = true; button.textContent = 'Salvando…';
  try {
    await callServer(mode === 'none' ? 'createTask' : 'createDailyTemplate', data);
  } catch (error) {
    errorBox.textContent = error.message || 'Não foi possível salvar. Tente novamente.';
    errorBox.classList.remove('hidden');
    taskCreatorSaving = false; button.disabled = false;
    button.textContent = mode === 'none' ? 'Criar tarefa' : 'Criar tarefa recorrente';
    return;
  }
  form.reset(); updateCreatorRecurrence();
  taskCreatorSaving = false; button.disabled = false;
  setAdminTab('tasks');
  document.querySelector('#filterEmployee').value = data.atribuidoPara;
  document.querySelector('#filterWorkspace').value = data.workspace;
  document.querySelector('#filterStatus').value = 'Pendente';
  document.querySelector('#adminSearch').value = '';
  showToast(mode === 'none' ? 'Tarefa criada.' : 'Repetição salva. As tarefas serão criadas nos dias escolhidos.');
  try { await loadAdmin(); } catch {
    showToast('Salvo com sucesso. Recarregue a página para atualizar a lista.');
  }
}
