const NOTIFICATION_SOUNDS = [
  ['original', 'Som atual', 'Três notas crescentes, como você já conhece.'],
  ['notification-1', 'Cristal', 'Duas notas leves e brilhantes.'],
  ['notification-3', 'Ping agudo', 'Um aviso curto com notas mais altas.'],
  ['notification-5', 'Melodia', 'Duas notas com um salto mais marcado.'],
  ['alert-1', 'Alerta duplo', 'Dois bipes nítidos para chamar atenção.'],
  ['alert-3', 'Alerta forte', 'Dois bipes mais agudos e presentes.'],
  ['alert-5', 'Alerta intenso', 'O tom mais agudo desta seleção.'],
  ['none', 'Sem som', 'Mantém os avisos visuais.']
];
let notificationSettings = { sound: 'original', volume: 70, repeat: 1 };
let soundSettingsDirty = false;
let soundSettingsSaving = false;
let soundSettingsEpoch = 0;
let soundPlaybackToken = 0;
let soundCatalogPromise;
const soundBuffers = new Map();
const notificationNodes = new Set();

function trackNotificationNode(node) {
  notificationNodes.add(node);
  node.onended = () => { notificationNodes.delete(node); node.disconnect(); };
}

function stopNotificationSound() {
  soundPlaybackToken++;
  for (const node of notificationNodes) { try { node.stop(); } catch {} }
  notificationNodes.clear();
}

function resetNotificationSounds() {
  soundSettingsEpoch++;
  soundSettingsDirty = false;
  stopNotificationSound();
  notificationSettings = { sound: 'original', volume: 70, repeat: 1 };
}

function readSoundForm() {
  return {
    sound: document.querySelector('input[name="notificationSound"]:checked')?.value || 'original',
    volume: Number(document.querySelector('#soundVolume').value),
    repeat: Number(document.querySelector('#soundRepeat').value)
  };
}

function fillSoundForm() {
  if (soundSettingsDirty || soundSettingsSaving) return;
  document.querySelectorAll('input[name="notificationSound"]').forEach(input => { input.checked = input.value === notificationSettings.sound; });
  document.querySelector('#soundVolume').value = notificationSettings.volume;
  document.querySelector('#soundVolumeValue').textContent = `${notificationSettings.volume}%`;
  document.querySelector('#soundRepeat').value = notificationSettings.repeat;
}

async function refreshNotificationSettings() {
  const epoch = soundSettingsEpoch;
  try {
    const settings = await callServer('getNotificationSettings');
    if (epoch !== soundSettingsEpoch || soundSettingsSaving) return;
    if (!settings || !NOTIFICATION_SOUNDS.some(([id]) => id === settings.sound)) return;
    notificationSettings = settings;
    fillSoundForm();
  } catch {
    // A settings outage must not prevent users from loading their tasks.
  }
}

function initNotificationSounds() {
  document.querySelector('#soundOptions').innerHTML = NOTIFICATION_SOUNDS.map(([id, name, detail]) => `
    <div class="sound-option"><label><input type="radio" name="notificationSound" value="${id}" ${id === 'original' ? 'checked' : ''}><span><strong>${name}</strong><small>${detail}</small></span></label>
    ${id !== 'none' ? `<button type="button" class="btn-secondary" data-preview-sound="${id}" aria-label="Ouvir ${name}">▶ Ouvir</button>` : ''}</div>`).join('');
  const form = document.querySelector('#soundSettingsForm');
  form.addEventListener('input', () => {
    soundSettingsDirty = true;
    document.querySelector('#soundVolumeValue').textContent = `${document.querySelector('#soundVolume').value}%`;
    document.querySelector('#soundSettingsStatus').textContent = 'Alterações ainda não salvas.';
  });
  document.querySelectorAll('[data-preview-sound]').forEach(button => button.addEventListener('click', () => {
    previewNotificationSound({ ...readSoundForm(), sound: button.dataset.previewSound });
  }));
  document.querySelector('#previewSelectedSound').addEventListener('click', () => previewNotificationSound(readSoundForm()));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (soundSettingsSaving || currentUser?.perfil !== 'Admin') return;
    soundSettingsSaving = true;
    const epoch = ++soundSettingsEpoch;
    const data = readSoundForm();
    const button = document.querySelector('#saveSoundSettings');
    button.disabled = true;
    button.textContent = 'Salvando…';
    try {
      const saved = await callServer('saveNotificationSettings', data);
      if (epoch !== soundSettingsEpoch) return;
      notificationSettings = saved;
      soundSettingsDirty = JSON.stringify(readSoundForm()) !== JSON.stringify(data);
      document.querySelector('#soundSettingsStatus').textContent = soundSettingsDirty
        ? 'Seleção salva. Há novas alterações ainda não salvas.'
        : 'Salvo! O som será aplicado para toda a equipe na próxima atualização automática.';
    } catch (error) {
      document.querySelector('#soundSettingsStatus').textContent = error.message || 'Não foi possível salvar. Tente novamente.';
    } finally {
      soundSettingsSaving = false;
      button.disabled = false;
      button.textContent = 'Salvar para toda a equipe';
    }
  });
}

async function getNotificationBuffer(id) {
  if (soundBuffers.has(id)) return soundBuffers.get(id);
  if (!soundCatalogPromise) {
    soundCatalogPromise = fetch('/sounds/catalog.json?v=20260913-07').then(response => {
      if (!response.ok) throw Error('Falha ao carregar os sons.');
      return response.json();
    }).catch(error => { soundCatalogPromise = null; throw error; });
  }
  const catalog = await soundCatalogPromise;
  if (!catalog[id]) throw Error('Som indisponível.');
  const response = await fetch(catalog[id]);
  const buffer = await audioContext.decodeAudioData(await response.arrayBuffer());
  soundBuffers.set(id, buffer);
  return buffer;
}

async function playNotificationSound(settings = notificationSettings, preview = false) {
  stopNotificationSound();
  if (settings.sound === 'none' || settings.volume === 0) return true;
  const token = soundPlaybackToken;
  try {
    unlockNotificationSound();
    if (!audioContext) throw Error('Este navegador não suporta áudio.');
    if (audioContext.state === 'suspended') await audioContext.resume();
    if (token !== soundPlaybackToken) return false;
    if (settings.sound === 'original') {
      for (let i = 0; i < settings.repeat; i++) playLegacyNotificationSound(settings.volume, i * 1.05);
    } else {
      const buffer = await getNotificationBuffer(settings.sound);
      if (token !== soundPlaybackToken) return false;
      for (let i = 0; i < settings.repeat; i++) {
        const source = audioContext.createBufferSource();
        const gain = audioContext.createGain();
        source.buffer = buffer;
        gain.gain.value = settings.volume / 100;
        source.connect(gain); gain.connect(audioContext.destination);
        trackNotificationNode(source);
        source.addEventListener('ended', () => gain.disconnect());
        source.start(audioContext.currentTime + i * (buffer.duration + 0.3));
      }
    }
    return true;
  } catch (error) {
    if (token !== soundPlaybackToken) return false;
    if (preview) document.querySelector('#soundSettingsStatus').textContent = 'Não foi possível ouvir este som. Clique em Ouvir para tentar novamente.';
    else if (audioContext?.state === 'running') playLegacyNotificationSound(settings.volume);
    return false;
  }
}

async function previewNotificationSound(settings) {
  const status = document.querySelector('#soundSettingsStatus');
  status.textContent = settings.sound === 'none' || settings.volume === 0 ? 'Esta seleção está sem som.' : 'Carregando prévia…';
  if (await playNotificationSound(settings, true)) {
    if (settings.sound !== 'none' && settings.volume > 0) status.textContent = `Prévia: ${NOTIFICATION_SOUNDS.find(([id]) => id === settings.sound)?.[1]}. Para aplicar à equipe, clique em Salvar.`;
  }
}
