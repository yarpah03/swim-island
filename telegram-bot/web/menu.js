(() => {
  'use strict';
  const app=window.Telegram?.WebApp,base='/v1/client/entry',status=document.getElementById('status');
  const initData=app?.initData||new URLSearchParams(location.hash.slice(1)).get('tgWebAppData')||'';
  app?.ready();app?.expand();try{app?.setHeaderColor('#08191f');app?.setBackgroundColor('#08191f');}catch{}
  async function api(path,data){
    const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData,...data}),cache:'no-store',signal:AbortSignal.timeout(22000)});
    const value=await response.json();if(!response.ok)throw new Error(value.error||'unavailable');return value;
  }
  if(initData)api('/bootstrap',{}).then(state=>{document.getElementById('admin').hidden=!state.admin;}).catch(()=>{status.textContent='Откройте меню заново из чата бота, если раздел не открывается.';});
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-action]');
    if(!button||document.body.classList.contains('busy'))return;
    const action=button.dataset.action;
    if(!initData){location.href='https://t.me/swim_island_entry_bot?start='+({materials:'brass',access:'web'}[action]||'menu');return;}
    document.body.classList.add('busy');status.textContent='Открываем раздел в чате…';try{app?.HapticFeedback?.selectionChanged();}catch{}
    try{
      await api('/action',{action,nonce:crypto.randomUUID()});
      status.textContent='Раздел открыт в чате бота.';
      if(app?.close)app.close();
    }catch(error){
      status.textContent=error.message==='slow_down'?'Вы быстро переключали разделы. Подождите немного.':error.message==='telegram_auth_required'?'Закройте меню и откройте его снова.':error.message==='start_bot_first'?'Откройте чат бота и нажмите «Начать».':'Не удалось открыть раздел. Попробуйте ещё раз.';
    }finally{document.body.classList.remove('busy');}
  });
})();
