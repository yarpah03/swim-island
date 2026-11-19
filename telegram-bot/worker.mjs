import { CHECKOUT, APP, WEB, CATEGORIES, PHOTOS, SEED, button, link, nav, escape, isAdmin, publicCard } from './catalog.mjs';
import { telegram, text, photoCard, document, asset } from './telegram.mjs';
import { rows, one, run, subscribe, claimUpdate } from './store.mjs';
import { adminHome, adminMessage, adminCallback } from './admin.mjs';
import { sendPost } from './posts.mjs';
import { menuUser } from './menu-auth.mjs';
import { webAccess } from './web-access.mjs';
import { createTributeChecker } from '../chats/paid-access.mjs';

const checkPaid=createTributeChecker();
let priceCache;
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const MONEY=new Intl.NumberFormat('ru-RU');
export async function tariffs(env) {
  const now=Date.now();
  if(priceCache?.until>now) return priceCache.card;
  let periods=null;
  try {
    const r=await fetch('https://tribute.tg/api/v1/subscriptions',{headers:{'Api-Key':env.TRIBUTE_API_KEY},signal:AbortSignal.timeout(6000),redirect:'manual'});
    if(r.ok){
      const data=await r.json();
      periods=data.result?.find(x=>x.subscriptionId===Number(env.TRIBUTE_VIP_SUBSCRIPTION_IDS)&&x.currency==='rub')?.periods;
    }
  } catch {}
  const known={monthly:1180,halfyearly:5990,yearly:9990};
  const actual=Array.isArray(periods);
  const lines=[['monthly','Месяц'],['halfyearly','Полгода'],['yearly','Год']].flatMap(([period,title])=>{
    const price=actual?periods.find(x=>x.period===period)?.price:known[period];
    return Number.isFinite(price)&&price>0?[title+' — <b>'+MONEY.format(price)+' ₽</b>']:[];
  });
  const card={photo:PHOTOS.tariffs,caption:'<b>Тарифы VIP</b>\n\n'+(actual?'': 'Последние подтверждённые цены:\n')+lines.join('\n')+
    '\n\nДоступ к закрытому каналу и приложению входит в подписку. Индивидуальное онлайн-ведение оплачивается отдельно.\n\nПеред оплатой Tribute покажет итоговую сумму, доступные предложения и условия продления. Проверьте их на экране оформления.',
    rows:[[link('💎 Выбрать срок в Tribute',CHECKOUT)],[button('Что входит в клуб?','about')],...nav()]};
  if(actual)priceCache={until:now+600000,card};
  return card;
}
async function showPublic(env,origin,id,key,message){
  const record=await one(env.BOT_DB,'SELECT subscribed FROM bot_subscribers WHERE chat_id=?',id);
  return photoCard(env,origin,id,key==='tariffs'?await tariffs(env):publicCard(key,isAdmin(env,id),record?.subscribed!==0),message);
}
async function showCategory(env,origin,id,category,message,page=0){
  const count=await one(env.BOT_DB,'SELECT count(*) AS n FROM bot_materials WHERE category=? AND active=1',category);
  const pages=Math.max(1,Math.ceil(count.n/8));
  page=Math.max(0,Math.min(page,pages-1));
  const items=await rows(env.BOT_DB,'SELECT id,title FROM bot_materials WHERE category=? AND active=1 ORDER BY created_ms DESC,id LIMIT 8 OFFSET ?',category,page*8);
  const caption='<b>'+CATEGORIES[category]+'</b>\n\n'+(items.length?'Выберите материал. У каждого есть описание и кнопка открытия или скачивания.':
    'Видеоуроки ещё записываем. Пока начните с бесплатного PDF «Брасс с нуля: 8 тренировок» и чек-листов. Новые уроки появятся здесь — расскажем о них в новостях.');
  return photoCard(env,origin,id,{photo:PHOTOS[category],caption,rows:[
    ...items.map(x=>[button(x.title,'mat:'+x.id)]),
    ...(pages>1?[[
      ...(page>0?[button('← Предыдущие','cat:'+category+':'+(page-1))]:[]),
      ...(page+1<pages?[button('Следующие →','cat:'+category+':'+(page+1))]:[]),
    ]]:[]),
    ...(!items.length?[[button('📄 Забрать 8 тренировок по брассу','mat:breaststroke8')]]:[]),...nav('materials'),
  ]},message);
}
async function material(env,origin,id,key,message,download=false){
  const item=await one(env.BOT_DB,'SELECT * FROM bot_materials WHERE id=? AND active=1',key);
  if(!item)return showPublic(env,origin,id,'materials',message);
  if(download){
    await run(env.BOT_DB,'INSERT INTO bot_events(event,created_ms) VALUES(?,?)','download:'+item.id,Date.now());
    if(item.kind==='video')return telegram(env,'sendVideo',{chat_id:id,video:item.payload,caption:item.title,reply_markup:{inline_keyboard:nav('cat:'+item.category)}});
    if(item.kind==='url')return text(env,id,'Открыть материал:',[[link(item.title,item.payload)],...nav('cat:'+item.category)]);
    return document(env,origin,id,item,nav('cat:'+item.category));
  }
  const action=item.kind==='url'?link('Открыть материал',item.payload):button(item.kind==='video'?'▶️ Смотреть видео':'📥 Скачать PDF','file:'+item.id);
  return photoCard(env,origin,id,{photo:item.photo,caption:'<b>'+escape(item.title)+'</b>\n\n'+escape(item.description),rows:[[action],[button('💎 Больше материалов в VIP','buy')],...nav('cat:'+item.category)]},message);
}
async function paymentStatus(env,origin,id,message){
  const result=await checkPaid(env,id);
  const until=result.expiresAt?new Date(result.expiresAt).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'}):'';
  const caption=result.allowed?'<b>Оплаченная подписка активна</b>\n\nДоступ оплачен до '+until+'. Откройте канал через Tribute, затем приложение в закрепе.':
    result.reason==='trial'?'<b>Сейчас действует пробный доступ</b>\n\nМатериалы клуба открываются по правилам пробного периода. Скачивание PDF тренировок в приложении доступно после оплаты. Бесплатные PDF этого бота можно забрать прямо сейчас.':
    result.reason==='unavailable'?'<b>Проверка временно недоступна</b>\n\nПосмотрите свою подписку непосредственно в Tribute или повторите проверку чуть позже. Это не означает, что оплата пропала.':
    '<b>Активная оплаченная подписка не найдена</b>\n\nЕсли вы уже платили, проверьте, что открыли бота с того же Telegram-аккаунта. Статус и вход в закрытый канал доступны в Tribute.';
  return photoCard(env,origin,id,{photo:PHOTOS.access,caption,rows:[[link('Моя подписка в Tribute',CHECKOUT)],...(result.allowed?[[link('📲 Открыть приложение',APP)]]:[]),[button('Проверить ещё раз','checkpaid')],...nav('access')]},message);
}
async function news(env,origin,id,data,message){
  const selected=/^newsitem:([0-9a-f-]{36})$/.exec(data);
  if(selected){
    const job=await one(env.BOT_DB,"SELECT * FROM bot_broadcasts WHERE id=? AND status IN ('sending','paused','done')",selected[1]);
    if(job)await sendPost(env,id,job,nav('news:list'));
    return;
  }
  const jobs=await rows(env.BOT_DB,"SELECT id,created_ms FROM bot_broadcasts WHERE status IN ('sending','paused','done') ORDER BY created_ms DESC LIMIT 10");
  return photoCard(env,origin,id,{photo:PHOTOS.news,caption:'<b>Последние новости</b>\n\n'+(jobs.length?'Выберите выпуск, чтобы открыть его ещё раз.':'Первые новости готовим. Здесь появятся новые материалы, обновления и анонсы эфиров. Пока можно забрать бесплатные PDF.'),rows:[
    ...jobs.map(x=>[button('Выпуск от '+new Date(x.created_ms).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'}),'newsitem:'+x.id)]),
    ...(!jobs.length?[[button('🎁 Бесплатные материалы','materials')]]:[]),...nav('news'),
  ]},message);
}
export async function handleUpdate(request,env,update,ctx){
  const origin=new URL(request.url).origin;
  const m=update.message,q=update.callback_query;
  const from=m?.from||q?.from,chat=m?.chat||q?.message?.chat;
  if(chat?.type!=='private'||!Number.isSafeInteger(chat.id)||chat.id<=0||from?.id!==chat.id||from?.is_bot)return;
  const id=chat.id;
  if(q){
    if(q.id)try{await telegram(env,'answerCallbackQuery',{callback_query_id:q.id});}catch(e){if(e.status!==400)throw e;}
    await subscribe(env.BOT_DB,id);
    const data=String(q.data||'').slice(0,64);
    if(await adminCallback(env,origin,id,data,q.message,ctx))return;
    if(data.startsWith('admin')||/^(publish|manage|toggle|confirm|send|halt|job):/.test(data))return showPublic(env,origin,id,'home',q.message);
    if(data==='news:on'||data==='news:off'||data==='vip_stop'){
      await run(env.BOT_DB,'UPDATE bot_subscribers SET subscribed=?,updated_ms=? WHERE chat_id=?',data==='news:on'?1:0,Date.now(),id);
      return showPublic(env,origin,id,'news',q.message);
    }
    if(data==='news:list'||data.startsWith('newsitem:'))return news(env,origin,id,data,q.message);
    if(data==='web'||data==='web:reset'||data==='web:reset:confirm')return webAccess(env,origin,id,from,q.message,data==='web:reset'?true:data==='web:reset:confirm'?'confirmed':false);
    if(data==='checkpaid')return paymentStatus(env,origin,id,q.message);
    const cat=/^cat:(lessons|checklists|plans)(?::(\d{1,4}))?$/.exec(data);
    if(cat)return showCategory(env,origin,id,cat[1],q.message,Number(cat[2]||0));
    const item=/^(mat|file):([a-zA-Z0-9-]{1,40})$/.exec(data);
    if(item)return material(env,origin,id,item[2],q.message,item[1]==='file');
    if(data==='buy')await run(env.BOT_DB,'INSERT INTO bot_events(event,created_ms) VALUES(?,?)','Посмотрели оформление VIP',Date.now());
    return showPublic(env,origin,id,['home','materials','about','tariffs','buy','access','news','help'].includes(data)?data:'home',q.message);
  }
  const command=/^\/([a-z]+)(?:@\w+)?(?:\s+(\S+))?/.exec(m.text||'');
  if(command?.[1]==='stop'){
    await subscribe(env.BOT_DB,id);
    await run(env.BOT_DB,'UPDATE bot_subscribers SET subscribed=0,updated_ms=? WHERE chat_id=?',Date.now(),id);
    return showPublic(env,origin,id,'news');
  }
  if(command?.[1]==='admin'&&isAdmin(env,id)){
    await subscribe(env.BOT_DB,id);return adminHome(env,origin,id);
  }
  if(command?.[1]==='cancel'&&isAdmin(env,id)){
    await run(env.BOT_DB,'DELETE FROM bot_admin_drafts WHERE actor_id=?',id);return adminHome(env,origin,id);
  }
  const starts=command&&['start','menu','materials','tariffs','vip','news','help'].includes(command[1]);
  if(starts){
    await subscribe(env.BOT_DB,id,command[2]||'direct');
    if(command[1]==='start'&&command[2]==='test100'){
      const url=env.TRIBUTE_TEST_CHECKOUT_URL;
      if(url&&/^https:\/\/t\.me\/tribute\//.test(url))return photoCard(env,origin,id,{photo:PHOTOS.home,caption:'<b>Тестовый вход для друзей</b>\n\nЭто отдельная разовая тестовая подписка. Её сумму и условия проверьте на экране Tribute перед оплатой.\n\nПосле оформления откройте VIP-канал через Tribute и приложение в закрепе.',rows:[[link('Открыть тестовую подписку',url)],...nav()]});
    }
    if(command[1]==='start'&&command[2]==='web')return webAccess(env,origin,id,from);
    const key=command[1]==='start'?(command[2]==='crawl'?'materials':command[2]==='brass'?'breaststroke8':'home'):command[1]==='menu'?'home':command[1]==='vip'?'buy':command[1];
    return key==='breaststroke8'?material(env,origin,id,key):showPublic(env,origin,id,key);
  }
  if(await adminMessage(env,origin,id,m))return;
  await subscribe(env.BOT_DB,id);
  return showPublic(env,origin,id,'home');
}
export async function setup(env,origin){
  const me=await telegram(env,'getMe');
  if(me.username!=='swim_island_entry_bot')throw new Error('wrong_bot');
  const commands=[
    {command:'menu',description:'Главное меню'},{command:'materials',description:'Забрать полезные материалы'},
    {command:'tariffs',description:'Тарифы VIP'},{command:'vip',description:'Купить подписку'},
    {command:'news',description:'Новости и уведомления'},{command:'help',description:'Помощь'},{command:'stop',description:'Отключить новости'},
  ];
  for(const language_code of ['', 'ru']){
    await telegram(env,'setMyCommands',{commands,language_code});
    for(const chat of (env.BOT_ADMIN_IDS||'').split(',').map(Number).filter(Number.isSafeInteger)){
      try{await telegram(env,'setMyCommands',{commands:[...commands,{command:'admin',description:'Управление материалами и рассылками'}],scope:{type:'chat',chat_id:chat},language_code});}catch(e){if(e.status!==400)throw e;}
    }
  }
  await telegram(env,'setMyName',{name:'Плавательный остров | Уроки и VIP'});
  await telegram(env,'setMyDescription',{description:'Полезные материалы по плаванию от Ярослава Пахомова и Макара Марченко. Бесплатные PDF, уроки и чек-листы, новости клуба и подписка на Плавательный остров VIP. Нажмите «Начать» и выберите раздел.'});
  await telegram(env,'setMyShortDescription',{short_description:'Уроки, чек-листы и новости плавания. Бесплатные материалы и вход в Плавательный остров VIP.'});
  const menuButton={type:'web_app',text:'Меню',web_app:{url:'https://vip.swimisland.ru/v1/client/entry/menu'}};
  await telegram(env,'setChatMenuButton',{menu_button:JSON.stringify(menuButton)});
  for(const chat of (env.BOT_ADMIN_IDS||'').split(',').map(Number).filter(Number.isSafeInteger)){
    try{await telegram(env,'setChatMenuButton',{chat_id:chat,menu_button:JSON.stringify(menuButton)});}catch(e){if(e.status!==400)throw e;}
  }
  const configuredMenu=await telegram(env,'getChatMenuButton');
  if(configuredMenu.type!=='web_app'||configuredMenu.web_app?.url!==menuButton.web_app.url)throw new Error('menu_not_applied');

  const data=new FormData();
  data.set('photo',JSON.stringify({type:'static',photo:'attach://avatar'}));
  data.set('avatar',await asset(env,origin,'/media/avatar-entry-v2.jpg'),'swim-island-start.jpg');
  await telegram(env,'setMyProfilePhoto',data);
  const webhook=await telegram(env,'getWebhookInfo');
  if(webhook.url!==origin+'/telegram'){
    await telegram(env,'setWebhook',{url:origin+'/telegram',secret_token:env.TELEGRAM_WEBHOOK_SECRET,allowed_updates:['message','callback_query']});
  }
  return {username:me.username,commandsConfigured:true,avatarConfigured:true,webhookConfigured:true};
}
export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url),path=url.pathname;
    if((path==='/menu'||path==='/menu/')&&request.method==='GET'){
      const asset=await env.ASSETS.fetch(new Request(new URL('/menu/',url.origin)));
      return new Response(asset.body,{status:asset.status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
    }
    if(path==='/health'){
      if(request.method!=='GET')return json({error:'method'},405);
      const db=await one(env.BOT_DB,'SELECT count(*) AS n FROM bot_materials WHERE active=1');
      return json({ok:true,version:'news-menu-2',materials:db.n,paymentConfigured:!!env.TRIBUTE_API_KEY});
    }
    if(path.startsWith('/control/')){
      if(!env.BOT_CONTROL_TOKEN||request.headers.get('Authorization')!=='Bearer '+env.BOT_CONTROL_TOKEN)return json({error:'unauthorized'},401);
      if(path==='/control/setup'&&request.method==='POST'){
        try{return json(await setup(env,url.origin));}catch(e){return json({error:e.message,status:e.status||0},502);}
      }
      if(path==='/control/inspect'&&request.method==='GET'){
        const me=await telegram(env,'getMe'),webhook=await telegram(env,'getWebhookInfo'),commands=await telegram(env,'getMyCommands');
        const profile=await telegram(env,'getUserProfilePhotos',{user_id:me.id,limit:1});
        const menuButton=await telegram(env,'getChatMenuButton');
        let webBridge={ok:false};
        try {
          const response=await fetch('https://swim-island-chats.pages.dev/v1/internal/tribute-web',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+env.TRIBUTE_WEB_BRIDGE_SECRET},body:JSON.stringify({operation:'health'}),redirect:'manual',signal:AbortSignal.timeout(22000)});
          const check=await response.json();webBridge={ok:response.ok&&check.ok===true,status:response.status,menuAssets:check.entryStatus===200};
        } catch {}

        return json({username:me.username,webhook:webhook.url,pending:webhook.pending_update_count,commands:commands.map(x=>x.command),avatarCount:profile.total_count,menuButton,webBridge,materials:await rows(env.BOT_DB,'SELECT id,category,title FROM bot_materials WHERE active=1')});
      }
      return json({error:'not_found'},404);
    }
    if((path==='/menu/bootstrap'||path==='/menu/action')&&request.method==='POST'){
      let data;try{const raw=await request.text();if(raw.length>16384)return json({error:'too_large'},413);data=JSON.parse(raw);}catch{return json({error:'invalid_json'},400);}
      const user=await menuUser(env,data.initData);
      if(!user)return json({error:'telegram_auth_required'},401);
      if(path==='/menu/bootstrap')return json({ok:true,admin:isAdmin(env,user.id),firstName:user.first_name||''});
      const allowed=['home','materials','about','tariffs','buy','access','news','help','web','admin'];
      if(!allowed.includes(data.action)||data.action==='admin'&&!isAdmin(env,user.id))return json({error:'not_allowed'},403);
      if(typeof data.nonce!=='string'||!/^[a-f0-9-]{36}$/.test(data.nonce))return json({error:'invalid_input'},400);
      const now=Date.now();
      const limit=await env.BOT_DB.prepare('INSERT INTO bot_menu_limits(user_id,window_ms,count) VALUES(?,?,1) ON CONFLICT(user_id) DO UPDATE SET window_ms=CASE WHEN window_ms<? THEN excluded.window_ms ELSE window_ms END,count=CASE WHEN window_ms<? THEN 1 ELSE count+1 END WHERE window_ms<? OR count<30 RETURNING user_id').bind(user.id,now,now-60000,now-60000,now-60000).first();
      if(!limit)return json({error:'slow_down'},429);
      const claim=await env.BOT_DB.prepare('INSERT OR IGNORE INTO bot_menu_actions(nonce,user_id,created_ms) VALUES(?,?,?) RETURNING nonce').bind(data.nonce,user.id,now).first();
      if(!claim)return json({ok:true});
      try{
        await handleUpdate(request,env,{callback_query:{from:user,data:data.action,message:{chat:{id:user.id,type:'private'},message_id:0}}},ctx);
        return json({ok:true});
      }catch(e){
        await run(env.BOT_DB,'DELETE FROM bot_menu_actions WHERE nonce=?',data.nonce);
        return json({error:e.status===403?'start_bot_first':'unavailable'},502);
      }
    }
    if(path==='/telegram'){
      if(request.method!=='POST')return json({error:'method'},405);
      if(!env.TELEGRAM_WEBHOOK_SECRET||!env.TELEGRAM_BOT_TOKEN||request.headers.get('X-Telegram-Bot-Api-Secret-Token')!==env.TELEGRAM_WEBHOOK_SECRET)return json({error:'unauthorized'},401);
      let update;
      try{const raw=await request.text();if(raw.length>256000)return json({error:'too_large'},413);update=JSON.parse(raw);}catch{return json({error:'invalid_json'},400);}
      if(!Number.isSafeInteger(update?.update_id))return json({error:'invalid_update'},400);
      if(!await claimUpdate(env.BOT_DB,update.update_id))return json({ok:true});
      try{
        await handleUpdate(request,env,update,ctx);
        await run(env.BOT_DB,'UPDATE bot_updates SET completed=1 WHERE update_id=?',update.update_id);
        if(Math.random()<0.02)await run(env.BOT_DB,'DELETE FROM bot_updates WHERE lease_until<?',Date.now()-7*86400000);
        return json({ok:true});
      }catch(e){
        await run(env.BOT_DB,'UPDATE bot_updates SET lease_until=0 WHERE update_id=?',update.update_id);
        console.warn('Bot update failed',e.status||e.message);
        return json({error:'retry'},502);
      }
    }
    // Only free catalogue assets are served here; paid app files are separate.
    if(request.method==='GET'||request.method==='HEAD')return env.ASSETS.fetch(request);
    return json({error:'not_found'},404);
  },
};
