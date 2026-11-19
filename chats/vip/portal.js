(() => {
  'use strict';
  const base='/v1/client/vip',canonical='https://yarpah03.github.io/swim-island/';
  const $=id=>document.getElementById(id),auth=$('auth'),blocked=$('blocked'),app=$('app'),chat=$('swim-chats'),frame=$('catalog'),profile=$('profile');
  let invite=new URLSearchParams(location.hash.slice(1)).get('invite')||'',register=!!invite,session,lastProof,checking,expiryTimer,loadingTimer,backToChat,installPrompt;
  const errors={web_login_format:'Логин: 3–32 латинские буквы, цифры или символы . _ -',web_password_format:'Введите пароль от 12 символов.',web_login_invalid:'Проверьте логин и пароль.',web_login_taken:'Этот логин занят. Выберите другой.',web_login_wait:'Слишком много попыток. Попробуйте через 10 минут.',invalid_name:'Введите имя от 2 до 40 символов.',web_invite_invalid:'Ссылка устарела или уже использована. Получите новую в боте.',web_invite_used:'Ссылка уже использована. Войдите со своим логином и паролем.'};
  function errorText(error){return errors[error.message]||'Не удалось связаться с приложением. Попробуйте ещё раз.';}
  function show(view){
    if(view===chat)document.body.dataset.page='chats';else delete document.body.dataset.page;
    for(const node of [auth,blocked,app,chat])node.hidden=node!==view;
    if(view!==app){clearTimeout(loadingTimer);if(view!==chat)frame.src='about:blank';}
    if(profile.open)profile.close();
  }
  async function api(path,data){
    const response=await fetch(base+path,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(20000)});
    const value=await response.json();
    if(!response.ok){const error=new Error(value.error||'unavailable');error.subscription=value.subscription;throw error;}
    return value;
  }
  async function proof(login,password){
    const bytes=new TextEncoder(),key=await crypto.subtle.importKey('raw',bytes.encode(password),'PBKDF2',false,['deriveBits']);
    const derived=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:600000,salt:bytes.encode('swim-island.pages.dev:v1:'+login)},key,256);
    return Array.from(new Uint8Array(derived),x=>x.toString(16).padStart(2,'0')).join('');
  }
  function loginScreen(message=''){
    register=false;invite='';
    show(auth);$('loading').hidden=true;$('credentials').hidden=false;
    $('name-field').hidden=$('repeat-field').hidden=$('to-login').hidden=true;
    $('name').required=$('repeat').required=false;$('name').disabled=$('repeat').disabled=true;
    $('password').autocomplete='current-password';$('login').readOnly=false;
    $('title').innerHTML='Войти<br>в свой остров';
    $('intro').textContent='Используйте логин и пароль, которые создали после подключения через бота.';
    $('submit').innerHTML='Войти в приложение <span>↗</span>';
    $('form-status').textContent=message;
  }
  function paymentScreen(sub){
    clearTimeout(expiryTimer);show(blocked);
    const unavailable=sub?.reason==='unavailable';
    $('blocked-title').innerHTML=unavailable?'Проверяем<br>доступ':sub?.expired?'Подписка<br>закончилась':'Подписка<br>неактивна';
    $('blocked-copy').textContent=unavailable?'Сейчас не удалось проверить статус в Tribute. Попробуйте ещё раз. Ваш аккаунт и переписка сохранены.':'Продлите подписку в Tribute, чтобы вернуться к тренировкам. Логин, профиль и переписка сохранятся.';
    $('renew').hidden=unavailable;
    $('payment-status').textContent='';
  }
  function armExpiry(sub){
    clearTimeout(expiryTimer);
    const delay=sub?.expiresAt?Math.max(30,Math.min(60000,sub.expiresAt-Date.now())):60000;
    expiryTimer=setTimeout(()=>refresh(),delay);
  }
  function showLibrary(hash='home',back){
    show(app);backToChat=back;
    $('app-loading').hidden=false;frame.inert=true;
    clearTimeout(loadingTimer);
    const url=new URL('/library/',location.origin);url.searchParams.set('view','portal');if(back)url.searchParams.set('from','chat');url.hash=hash;
    frame.src=url.href;
    loadingTimer=setTimeout(()=>{$('app-loading').textContent='Приложение загружается. Проверьте соединение и попробуйте открыть его снова.';},18000);
  }
  function resolveMaterial(value){
    const [title,url,...extra]=value.split('\n');
    if(extra.length||!url?.startsWith(canonical+'#'))return null;
    const hash=url.slice((canonical+'#').length);
    if(!/^[a-z][a-z0-9_]*(?:\/(?:workout|lesson|exercise|station)-[1-9]\d*(?:-[1-9]\d*)?)?$/.test(hash))return null;
    return {title,url,hash};
  }
  function showChat(targetRoom){
    show(chat);
    SwimChats.mount(chat,undefined,'',undefined,{web:true,fullWeb:true,webHome:()=>showLibrary(),targetRoom,
      materials:{resolve:resolveMaterial,open:(entry,room)=>showLibrary(entry.hash,()=>showChat(room))},
      webSessionLost:()=>refresh(true),
    });
  }
  function accept(state){
    session=state;lastProof=null;$('password').value=$('repeat').value='';
    if(invite||location.hash){invite='';register=false;history.replaceState(null,'',base);}
    armExpiry(state.subscription);
    if(app.hidden&&chat.hidden)showLibrary();
  }
  async function refresh(force=false){
    if(checking)return checking;
    if(document.hidden&&!force){expiryTimer=setTimeout(()=>refresh(),10000);return;}
    checking=(async()=>{
      if(session?.subscription?.expiresAt&&session.subscription.expiresAt<=Date.now())paymentScreen({...session.subscription,active:false,reason:'unpaid',expired:true});
      try{
        const state=await api('/session');
        if(state.active)accept(state);
        else if(state.subscription){session=state;paymentScreen(state.subscription);}
        else loginScreen();
      }catch(error){
        if(!app.hidden||!chat.hidden)paymentScreen({reason:'unavailable'});
        else{$('loading').hidden=true;loginScreen(errorText(error));}
      }
    })().finally(()=>checking=null);
    return checking;
  }
  $('credentials').addEventListener('submit',async event=>{
    event.preventDefault();if($('submit').disabled)return;
    const login=$('login').value.trim().toLowerCase(),password=$('password').value;
    if(!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(login)){$('form-status').textContent=errors.web_login_format;return;}
    if(password.length<12){$('form-status').textContent=errors.web_password_format;return;}
    if(register&&password!==$('repeat').value){$('form-status').textContent='Пароли не совпадают.';return;}
    $('submit').disabled=true;$('form-status').textContent=register?'Создаём аккаунт…':'Входим…';
    try{
      const value=await proof(login,password);
      const data={login,proof:value,...(register?{invite,name:$('name').value.trim()}:{})};
      lastProof={login,proof:value};
      await api(register?'/register':'/login',data);
      await refresh(true);
    }catch(error){
      if(error.subscription)paymentScreen(error.subscription);
      else $('form-status').textContent=errorText(error);
    }finally{$('submit').disabled=false;}
  });
  $('show-password').onclick=()=>{const visible=$('password').type==='password';$('password').type=visible?'text':'password';$('show-password').textContent=visible?'Скрыть':'Показать';};
  $('to-login').onclick=()=>{history.replaceState(null,'',base);loginScreen();};
  $('check-payment').onclick=async()=>{
    if($('check-payment').disabled)return;
    $('check-payment').disabled=true;$('payment-status').textContent='Проверяем оплату…';
    try{
      if(lastProof)await api('/login',lastProof);
      await refresh(true);
      if(!blocked.hidden)$('payment-status').textContent='Доступ пока не подтверждён. Если только что оплатили, повторите проверку немного позже.';
    }catch(error){
      if(error.subscription)paymentScreen(error.subscription);
      $('payment-status').textContent=error.subscription?'Оплата пока не подтверждена. Повторите проверку чуть позже.':errorText(error);
    }finally{$('check-payment').disabled=false;}
  };
  async function logout(){
    await api('/logout',{});session=undefined;lastProof=null;clearTimeout(expiryTimer);history.replaceState(null,'',base);loginScreen('Вы вышли из аккаунта.');
  }
  $('other-login').onclick=()=>logout().catch(error=>$('payment-status').textContent=errorText(error));
  $('logout').onclick=()=>logout().catch(error=>$('profile-status').textContent=errorText(error));
  $('close-profile').onclick=()=>profile.close();
  function showProfile(){
    $('profile-login').textContent='Ваш логин: '+(session?.login||'');
    $('profile-subscription').textContent=session?.subscription?.reason==='staff'?'Доступ команды клуба':session?.subscription?.expiresAt?'Подписка действует до '+new Date(session.subscription.expiresAt).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'}):'Активная подписка';
    $('profile-status').textContent='';profile.showModal();
  }
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;});
  $('install').onclick=async()=>{
    if(installPrompt){const event=installPrompt;installPrompt=null;await event.prompt();}
    else $('install-help').hidden=!$('install-help').hidden;
  };
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==frame.contentWindow||app.hidden)return;
    const msg=event.data;
    if(msg?.type==='swim-portal-ready'){clearTimeout(loadingTimer);$('app-loading').hidden=true;frame.inert=false;}
    if(msg?.type==='swim-portal-route'){
      if(msg.route==='profile')showProfile();
      else if(msg.route==='chats')msg.returnToThread&&backToChat?backToChat():showChat();
    }
    if(msg?.type==='swim-forward'){
      const entry=resolveMaterial((msg.material?.title||'')+'\n'+(msg.material?.url||''));
      if(entry){entry.detail=msg.material.detail;SwimChats.forward(entry,frame,showChat,resolveMaterial,true);}
    }
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&session)refresh(true);});
  async function start(){
    if(!invite)return refresh(true);
    show(auth);
    try{
      const state=await api('/invite',{invite});
      if(state.invite==='register'){
        register=true;$('loading').hidden=true;$('credentials').hidden=false;
        $('name-field').hidden=$('repeat-field').hidden=$('to-login').hidden=false;
        $('name').required=$('repeat').required=true;$('name').disabled=$('repeat').disabled=false;$('name').value=state.suggestedName||'';
        $('password').autocomplete='new-password';
        $('title').innerHTML=state.recovery?'Восстановите<br>доступ':'Создайте<br>свой аккаунт';
        if(state.recovery){$('login').value=state.login||'';$('login').readOnly=true;}
        $('intro').textContent=(state.subscription?.reason==='staff'?'Доступ команды подтверждён.':'Подписка подтверждена.')+' Выберите логин и пароль — с ними можно входить на сайт без открытия Telegram.';
        $('submit').innerHTML='Создать аккаунт и войти <span>↗</span>';
      }else if(state.subscription&&!state.subscription.active)paymentScreen(state.subscription);
      else loginScreen('Ссылка устарела или уже использована. Войдите либо получите новую ссылку в боте.');
    }catch(error){loginScreen(errorText(error));}
  }
  window.addEventListener('hashchange',()=>{
    invite=new URLSearchParams(location.hash.slice(1)).get('invite')||'';
    register=!!invite;lastProof=null;clearTimeout(expiryTimer);start();
  });
  start();
})();
