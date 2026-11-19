import { PHOTOS, CHECKOUT, button, link, nav, escape } from './catalog.mjs';
import { photoCard } from './telegram.mjs';
export async function webAccess(env,origin,id,user,message,reset=false){
  if(reset===true){
    return photoCard(env,origin,id,{photo:PHOTOS.access,caption:'<b>Восстановить доступ к сайту?</b>\n\nПолучите личную ссылку и установите новый пароль. Логин, профиль и переписка сохранятся.\n\nПока новый пароль не сохранён, прежний продолжает работать.',rows:[
      [button('Получить ссылку восстановления','web:reset:confirm')],...nav('access'),
    ]},message);
  }
  let response,data;
  try{
    response=await fetch('https://swim-island-chats.pages.dev/v1/internal/tribute-web',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+env.TRIBUTE_WEB_BRIDGE_SECRET},body:JSON.stringify({telegramId:id,name:[user?.first_name,user?.last_name].filter(Boolean).join(' '),reset:reset==='confirmed'}),signal:AbortSignal.timeout(16000),redirect:'manual'});
    data=await response.json();
  }catch{
    return photoCard(env,origin,id,{photo:PHOTOS.access,caption:'<b>Не удалось проверить веб-доступ</b>\n\nПопробуйте ещё раз чуть позже. Ваш аккаунт сохранён.',rows:[[button('Повторить проверку','web')],...nav('access')]},message);
  }
  if(!response.ok){
    const unavailable=response.status>=500||[400,401,404,405].includes(response.status)||data.error==='payment_check_unavailable';
    return photoCard(env,origin,id,{photo:PHOTOS.access,caption:unavailable?
      '<b>Проверка временно недоступна</b>\n\nНе получилось получить статус из Tribute. Повторите проверку чуть позже.':
      '<b>Для сайта нужна активная подписка VIP</b>\n\nОформите или продлите подписку в Tribute, затем вернитесь сюда. Бот проверит оплату и подготовит веб-вход. Аккаунт связан с тем Telegram, с которого оформлена подписка.',
      rows:[...(unavailable?[]:[[link('Оформить подписку в Tribute',CHECKOUT)]]),[button('Проверить ещё раз','web')],...nav('access')]},message);
  }
  if(data.registered){
    return photoCard(env,origin,id,{photo:PHOTOS.access,caption:'<b>Ваш веб-аккаунт готов</b>\n\nВаш логин: <code>'+escape(data.login)+'</code>\n\nОткройте сайт и войдите с вашим паролем. Доступ на сайте связан с текущей подпиской Tribute. После продления прежний логин продолжит работать.',
      rows:[[link('🌐 Открыть веб-версию',data.url)],[button('Восстановить пароль','web:reset')],...nav('access')]},message);
  }
  return photoCard(env,origin,id,{photo:PHOTOS.access,caption:data.recovery?
    '<b>Личная ссылка восстановления</b>\n\nОткройте её и установите новый пароль. Ссылка одноразовая и действует 15 минут. Аккаунт и переписка сохранятся.':
    (data.staff?'<b>Доступ команды подтверждён</b>':'<b>Подписка подтверждена</b>')+'\n\nОткройте личную ссылку, выберите логин и пароль. После регистрации сразу откроется главное меню приложения.\n\nСсылка одноразовая, действует 15 минут. В дальнейшем можно заходить на сайт со своими данными — без открытия Telegram.',
    rows:[[link(data.recovery?'Установить новый пароль':'Создать аккаунт на сайте',data.url)],[link('Уже есть аккаунт — войти','https://vip.swimisland.ru/v1/client/vip')],...nav('access')]},message);
}
