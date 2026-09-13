const PWA_SESSION_KEY = 'doctorhousePwaToken';
let pwaRegistration = null;
let pwaInstallPrompt = null;
let pwaPushActive = false;
let pwaPublicKey = null;
let pwaTaskToOpen = new URL(location.href).searchParams.get('task');
const pwaStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pwaIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const pwaMobile = () => pwaIos() || navigator.userAgentData?.mobile === true || /Android|Windows Phone|IEMobile/i.test(navigator.userAgent || '');

async function pwaRequest(path, method='GET', body) {
  const response=await fetch('/api/pwa/'+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+authToken},body:body ? JSON.stringify(body):undefined});
  const result=await response.json();
  if(!response.ok) { const error=Error(result.error || 'Não foi possível conectar.'); error.status=response.status; throw error; }
  return result;
}

function pwaSaveSession(token) {
  if(pwaStandalone()) {
    clearSessionLogin();
    localStorage.setItem(PWA_SESSION_KEY,token);
  }
}
async function pwaRestoreSession() {
  if(!pwaStandalone()) return false;
  const token=localStorage.getItem(PWA_SESSION_KEY);
  if(!token) return false;
  authToken=token;
  try { currentUser=await pwaRequest('session'); await enterDashboard(); return true; }
  catch(error) {
    if(error.status===401) localStorage.removeItem(PWA_SESSION_KEY);
    authToken=''; currentUser=null;
    return false;
  }
}

async function pwaLogout() {
  localStorage.removeItem(PWA_SESSION_KEY);
  const subscription=await pwaRegistration?.pushManager?.getSubscription();
  if(subscription) {
    try { await pwaRequest('subscription','DELETE',{endpoint:subscription.endpoint}); } catch {}
    await subscription.unsubscribe();
  }
  pwaPushActive=false; pwaPublicKey=null;
  pwaRegistration?.active?.postMessage({type:'CLEAR_NOTIFICATIONS'});
  document.querySelector('#pwaPushButton').hidden=true;
  document.querySelector('#pwaTestPush').hidden=true;
  document.querySelector('#pwaStopPush').hidden=true;
}

async function pwaRefresh() {
  const button=document.querySelector('#pwaPushButton');
  button.hidden=!currentUser;
  if(!currentUser || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const {publicKey}=await pwaRequest('key'); pwaPublicKey=publicKey;
    if(!pwaRegistration) return;
    const subscription=await pwaRegistration.pushManager.getSubscription();
    pwaPushActive=false;
    if(subscription && Notification.permission==='granted') {
      await pwaRequest('subscription','POST',subscription.toJSON());
      pwaPushActive=true;
    }
    button.hidden=pwaPushActive;
    document.querySelector('#pwaTestPush').hidden=!pwaPushActive;
    document.querySelector('#pwaStopPush').hidden=!pwaPushActive;
    if(pwaPushActive) document.querySelector('#pwaStatus').textContent='Notificações ativadas neste aparelho, inclusive com o app fechado.';
  } catch { document.querySelector('#pwaStatus').textContent='O painel está disponível. Tente ativar as notificações novamente quando estiver conectado.'; }
}

async function pwaOpenTask() {
  if(!pwaTaskToOpen || !currentUser) return;
  const task=[...(currentEmployeeTasks || []),...(currentEmployeeRequests || []),...(adminData.tasks || [])].find(item=>String(item.id)===pwaTaskToOpen);
  if(!task) return;
  pwaTaskToOpen=null;
  history.replaceState(null,'',location.pathname);
  await openTaskDetails(task);
}

// Polling remains a fallback even when this device is subscribed to push.
// The same tag as the server replaces a pending alert instead of alerting twice.
async function pwaNotify(title, options) {
  try {
    const registration = pwaRegistration || await navigator.serviceWorker?.getRegistration();
    if(registration) {
      const shown = await registration.getNotifications({tag:options.tag});
      if(shown.length) return;
      await registration.showNotification(title,{...options,renotify:false,icon:'/assets/icon-192.png'});
    } else if('Notification' in window) {
      new Notification(title,options);
    }
  } catch {
    document.querySelector('#pwaStatus').textContent='Não foi possível mostrar o aviso do sistema. Confira as permissões de notificação deste aparelho.';
  }
}

document.addEventListener('DOMContentLoaded',()=>{
  const status=document.querySelector('#pwaStatus');
  const help=document.querySelector('#pwaInstallHelp');
  const install=document.querySelector('#pwaInstallButton');
  install.hidden=!pwaMobile() || pwaStandalone();
  status.textContent=pwaStandalone() ? 'Doctor House instalado neste aparelho.' : pwaMobile() ? 'Leve suas tarefas para a tela inicial do celular.' : 'Gerencie as notificações deste computador.';
  const connection=()=>{document.querySelector('#connectionNotice').hidden=navigator.onLine;};
  connection(); window.addEventListener('offline',connection); window.addEventListener('online',()=>{connection();if(currentUser) pwaRefresh();});
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();if(!pwaMobile() || pwaStandalone())return;pwaInstallPrompt=event;install.hidden=false;});
  window.addEventListener('appinstalled',()=>{install.hidden=true;status.textContent='App instalado. Abra pelo ícone na tela inicial.';});
  install.addEventListener('click',async()=>{
    if(!pwaMobile() || pwaStandalone())return;
    if(pwaInstallPrompt) { await pwaInstallPrompt.prompt(); await pwaInstallPrompt.userChoice; pwaInstallPrompt=null; }
    else { help.hidden=!help.hidden; }
  });
  document.querySelector('#pwaCloseHelp').addEventListener('click',()=>{help.hidden=true;});
  if(!('serviceWorker' in navigator)) {status.textContent=pwaMobile() ? 'Este navegador não permite instalar o app. Abra no Safari ou Chrome atualizado.' : 'Este navegador não oferece suporte aos avisos em segundo plano.';return;}
  navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(registration=>{
    pwaRegistration=registration;
    if(currentUser) pwaRefresh();
    const update=document.querySelector('#pwaUpdate');
    const offer=()=>{if(registration.waiting && navigator.serviceWorker.controller) {update.hidden=false;document.querySelector('.pwa-settings').open=true;}};
    offer(); registration.addEventListener('updatefound',()=>{
      registration.installing?.addEventListener('statechange',offer);
    });
    update.addEventListener('click',()=>{
      if(!confirm('Atualizar o app agora? Salve ou cancele os formulários abertos antes de continuar.')) return;
      navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});
      registration.waiting?.postMessage({type:'ACTIVATE_UPDATE'});
    });
  }).catch(()=>{status.textContent='Não foi possível preparar os recursos do app. Atualize a página e tente novamente.';});
  navigator.serviceWorker.addEventListener('message',async event=>{
    if(event.data?.type!=='OPEN_TASK') return;
    pwaTaskToOpen=new URL(event.data.url,location.origin).searchParams.get('task');
    if(currentUser) {
      if(document.querySelector('.modal:not(.hidden)')) {showToast('Há uma atualização nas tarefas. Feche o formulário para conferir.');return;}
      await openMyTasks(false); await pwaOpenTask();
    }
  });
  document.querySelector('#pwaPushButton').addEventListener('click',async event=>{
    const button=event.currentTarget;
    if(pwaIos() && !pwaStandalone()) {help.hidden=false;status.textContent='No iPhone, instale e abra pela tela inicial antes de ativar as notificações.';return;}
    if(!('PushManager' in window) || !('Notification' in window)) {status.textContent='Use iOS 16.4 ou posterior, ou um navegador com notificações push.';return;}
    button.disabled=true;
    try {
      // Permission must be requested directly in the user's tap, before network waits.
      const permission=await Notification.requestPermission();
      if(permission!=='granted') {status.textContent='Permissão não concedida. Você pode liberar os avisos nos ajustes do aparelho.';return;}
      const registration=await navigator.serviceWorker.ready; pwaRegistration=registration;
      if(!pwaPublicKey) pwaPublicKey=(await pwaRequest('key')).publicKey;
      const binary=atob(pwaPublicKey.replace(/-/g,'+').replace(/_/g,'/'));
      const subscription=await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(binary,c=>c.charCodeAt(0))});
      await pwaRequest('subscription','POST',subscription.toJSON());
      await pwaRefresh();
    } catch(error) {status.textContent=error.message || 'Não foi possível ativar. Tente novamente.';}
    finally {button.disabled=false;}
  });
  document.querySelector('#pwaTestPush').addEventListener('click',async event=>{
    const button=event.currentTarget;button.disabled=true;
    try {
      const subscription=await pwaRegistration.pushManager.getSubscription();
      await pwaRequest('test','POST',{endpoint:subscription?.endpoint});
      status.textContent='Teste enviado. O aviso deve chegar em alguns segundos, conforme a conexão e os ajustes do aparelho.';
    } catch(error) {status.textContent=error.message;}
    finally {button.disabled=false;}
  });
  document.querySelector('#pwaStopPush').addEventListener('click',async()=>{
    const subscription=await pwaRegistration?.pushManager.getSubscription();
    try {
      if(subscription) {await pwaRequest('subscription','DELETE',{endpoint:subscription.endpoint});await subscription.unsubscribe();}
      pwaPushActive=false;await pwaRefresh();status.textContent='Notificações desativadas neste aparelho.';
    } catch(error) {status.textContent=error.message;}
  });
});
