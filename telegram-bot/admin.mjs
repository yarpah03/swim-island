import { CATEGORIES, PHOTOS, CHECKOUT, button, link, nav, escape, https, isAdmin } from './catalog.mjs';
import { rows, one, run, draft, saveDraft } from './store.mjs';
import { telegram, text, photoCard, document } from './telegram.mjs';
import { drain, progress } from './broadcast.mjs';
import { snapshotPost } from './posts.mjs';

const cancelRows=[[button('Отменить','admin:cancel')]];
export async function adminHome(env,origin,id,message) {
  const stat=await one(env.BOT_DB,'SELECT count(*) AS total,sum(subscribed) AS active FROM bot_subscribers');
  const materials=await one(env.BOT_DB,'SELECT count(*) AS n FROM bot_materials WHERE active=1');
  return photoCard(env,origin,id,{photo:PHOTOS.admin,caption:'<b>Управление ботом</b>\n\nЧитатели: '+stat.total+'\nПолучают новости: '+(stat.active||0)+'\nМатериалов в каталоге: '+materials.n+
    '\n\nДобавляйте уроки и файлы в каталог. Для рассылки сначала создайте черновик, проверьте его и подтвердите отправку. До подтверждения подписчикам ничего не отправляется.',
    rows:[[button('＋ Добавить материал','admin:add')],[button('📚 Каталог материалов','admin:catalog')],[button('✉️ Новая рассылка','admin:newsletter')],[button('📊 Рассылки и статистика','admin:jobs')],...nav()]},message);
}
async function materialPreview(env,origin,id,d) {
  const item=d.data;
  return photoCard(env,origin,id,{
    photo:item.photo||PHOTOS[item.category],caption:'<b>Предпросмотр материала</b>\n\n<b>'+escape(item.title)+'</b>\n\n'+escape(item.description),
    rows:[[button('Опубликовать в каталоге','publish:'+d.nonce)],[button('Отменить','admin:cancel')]],
  });
}
export async function adminMessage(env,origin,id,message) {
  if(!isAdmin(env,id)) return false;
  const d=await draft(env.BOT_DB,id);
  if(!d) return false;
  const value=message.text?.trim();
  if(value==='/cancel') {
    await run(env.BOT_DB,'DELETE FROM bot_admin_drafts WHERE actor_id=?',id);
    await adminHome(env,origin,id);return true;
  }
  if(d.step==='material:title') {
    if(!value||value.length>90){await text(env,id,'Пришлите название текстом, до 90 символов.',cancelRows);return true;}
    await saveDraft(env.BOT_DB,id,'material:description',{...d.data,title:value},d.nonce);
    await text(env,id,'Теперь короткое описание: кому поможет материал и что внутри. До 650 символов.',cancelRows);
  } else if(d.step==='material:description') {
    if(!value||value.length>650){await text(env,id,'Пришлите описание текстом, до 650 символов.',cancelRows);return true;}
    await saveDraft(env.BOT_DB,id,'material:file',{...d.data,description:value},d.nonce);
    await text(env,id,'Пришлите PDF, видео или HTTPS-ссылку на урок. Один материал — один файл или ссылка.',cancelRows);
  } else if(d.step==='material:file') {
    let attachment;
    if(message.document&&(message.document.mime_type==='application/pdf'||/\.pdf$/i.test(message.document.file_name||''))) attachment={kind:'document',payload:message.document.file_id};
    else if(message.video) attachment={kind:'video',payload:message.video.file_id};
    else if(value&&https(value)) attachment={kind:'url',payload:https(value)};
    if(!attachment){await text(env,id,'Нужен PDF, видео или одна ссылка, начинающаяся с https://.',cancelRows);return true;}
    await saveDraft(env.BOT_DB,id,'material:photo',{...d.data,...attachment},d.nonce);
    await text(env,id,'Добавьте фотографию-обложку. Либо используйте обложку клуба.',[[button('Использовать обложку клуба','admin:defaultphoto')],...cancelRows]);
  } else if(d.step==='material:photo') {
    if(!message.photo?.length){await text(env,id,'Пришлите фотографию или нажмите «Использовать обложку клуба».',[[button('Использовать обложку клуба','admin:defaultphoto')],...cancelRows]);return true;}
    const data={...d.data,photo:message.photo.at(-1).file_id};
    await saveDraft(env.BOT_DB,id,'material:preview',data,d.nonce);
    await materialPreview(env,origin,id,{...d,data});
  } else if(d.step==='newsletter:message') {
    if(!message.text&&!message.caption&&!message.photo&&!message.video&&!message.document){
      await text(env,id,'Пришлите одно сообщение: текст, фото, видео или файл с подписью.',cancelRows);return true;
    }
    const jobId=crypto.randomUUID();
    const preview=await telegram(env,'copyMessage',{chat_id:id,from_chat_id:id,message_id:message.message_id});
    await run(env.BOT_DB,'INSERT INTO bot_broadcasts(id,source_chat,source_message,created_by,created_ms,status,payload) VALUES(?,?,?,?,?,?,?)',jobId,id,preview.message_id,id,Date.now(),'draft',JSON.stringify(snapshotPost(message)));
    await saveDraft(env.BOT_DB,id,'newsletter:preview',{jobId},d.nonce);
    const count=await one(env.BOT_DB,'SELECT count(*) AS n FROM bot_subscribers WHERE subscribed=1');
    await text(env,id,'<b>Это предпросмотр — подписчики его ещё не получили.</b>\n\nСейчас новости получают: '+count.n+'.\n\nПосле подтверждения сообщение уйдёт подписчикам. Если аудитория большая, бот покажет прогресс и кнопку продолжения.',[
      [button('Отправить подписчикам','confirm:'+jobId)],
      [button('Отменить','admin:cancel')],
    ]);
  } else return false;
  return true;
}
export async function adminCallback(env,origin,id,data,message,ctx) {
  if(!isAdmin(env,id)) return false;
  if(data==='admin') {await adminHome(env,origin,id,message);return true;}
  if(data==='admin:cancel') {
    const d=await draft(env.BOT_DB,id);
    if(d?.data.jobId) await run(env.BOT_DB,"UPDATE bot_broadcasts SET status='cancelled' WHERE id=? AND status='draft' AND created_by=?",d.data.jobId,id);
    await run(env.BOT_DB,'DELETE FROM bot_admin_drafts WHERE actor_id=?',id);
    await adminHome(env,origin,id,message);return true;
  }
  if(data==='admin:add'){
    await text(env,id,'<b>Куда добавить материал?</b>',[
      ...Object.entries(CATEGORIES).map(([key,title])=>[button(title,'admin:category:'+key)]),...cancelRows,
    ]);return true;
  }
  const category=/^admin:category:(lessons|checklists|plans)$/.exec(data);
  if(category){
    await saveDraft(env.BOT_DB,id,'material:title',{category:category[1]});
    await text(env,id,'Пришлите название нового материала, до 90 символов.',cancelRows);return true;
  }
  if(data==='admin:defaultphoto'){
    const d=await draft(env.BOT_DB,id);
    if(d?.step!=='material:photo'){await adminHome(env,origin,id,message);return true;}
    const content={...d.data,photo:PHOTOS[d.data.category]};
    await saveDraft(env.BOT_DB,id,'material:preview',content,d.nonce);
    await materialPreview(env,origin,id,{...d,data:content});return true;
  }
  if(data.startsWith('publish:')){
    const d=await draft(env.BOT_DB,id);
    if(d?.step!=='material:preview'||data!=='publish:'+d.nonce){await text(env,id,'Этот черновик уже закрыт. Новый можно создать в управлении.',nav('admin'));return true;}
    const item=d.data,idMaterial='m-'+d.nonce;
    await run(env.BOT_DB,'INSERT OR IGNORE INTO bot_materials(id,category,title,description,kind,payload,photo,created_by,created_ms) VALUES(?,?,?,?,?,?,?,?,?)',idMaterial,item.category,item.title,item.description,item.kind,item.payload,item.photo,id,Date.now());
    await run(env.BOT_DB,'DELETE FROM bot_admin_drafts WHERE actor_id=? AND nonce=?',id,d.nonce);
    await text(env,id,'Материал опубликован в разделе «'+CATEGORIES[item.category]+'». Рассылка автоматически не отправлялась.',[[button('Открыть материал','mat:'+idMaterial)],...nav('admin')]);return true;
  }
  const catalogPage=/^admin:catalog(?::(\d{1,4}))?$/.exec(data);
  if(catalogPage){
    const count=await one(env.BOT_DB,'SELECT count(*) AS n FROM bot_materials');
    const pages=Math.max(1,Math.ceil(count.n/8));
    const page=Math.min(Number(catalogPage[1]||0),pages-1);
    const items=await rows(env.BOT_DB,'SELECT id,title,active FROM bot_materials ORDER BY active DESC,created_ms DESC LIMIT 8 OFFSET ?',page*8);
    await text(env,id,'<b>Каталог материалов</b>\n\nВыберите материал, чтобы открыть или скрыть его из каталога.',[
      ...items.map(x=>[button((x.active?'● ':'○ ')+x.title,'manage:'+x.id)]),
      ...(pages>1?[[
        ...(page>0?[button('← Предыдущие','admin:catalog:'+(page-1))]:[]),
        ...(page+1<pages?[button('Следующие →','admin:catalog:'+(page+1))]:[]),
      ]]:[]),...nav('admin'),
    ]);return true;
  }
  const manage=/^(manage|toggle):([a-zA-Z0-9-]{1,40})$/.exec(data);
  if(manage){
    const item=await one(env.BOT_DB,'SELECT * FROM bot_materials WHERE id=?',manage[2]);
    if(!item) return true;
    if(manage[1]==='toggle'){
      await run(env.BOT_DB,'UPDATE bot_materials SET active=1-active WHERE id=?',item.id);
      await text(env,id,'Статус материала изменён.',[[button('Вернуться в каталог','admin:catalog')]]);return true;
    }
    await text(env,id,'<b>'+escape(item.title)+'</b>\n\n'+(item.active?'Виден в каталоге.':'Скрыт из каталога.'),[
      [button(item.active?'Скрыть из каталога':'Вернуть в каталог','toggle:'+item.id)],
      ...(item.active?[[button('Открыть','mat:'+item.id)]]:[]),...nav('admin'),
    ]);return true;
  }
  if(data==='admin:newsletter'){
    await saveDraft(env.BOT_DB,id,'newsletter:message');
    await text(env,id,'<b>Новая рассылка</b>\n\nПришлите одно готовое сообщение: текст, фотографию, видео или PDF. Его можно переслать сюда.\n\nСначала покажу предпросмотр. Отправка подписчикам произойдёт только после отдельного подтверждения.',cancelRows);return true;
  }
  if(data==='admin:jobs'){
    const jobs=await rows(env.BOT_DB,"SELECT id,status,created_ms FROM bot_broadcasts WHERE status IN ('sending','paused','done','cancelled') ORDER BY created_ms DESC LIMIT 10");
    const events=await rows(env.BOT_DB,"SELECT event,count(*) AS n FROM bot_events GROUP BY event");
    await text(env,id,'<b>Рассылки и переходы</b>\n\n'+events.map(x=>escape(x.event)+': '+x.n).join('\n')+'\n\nВыберите рассылку:',[
      ...jobs.map(x=>[button(new Date(x.created_ms).toLocaleDateString('ru-RU')+' · '+x.status,'job:'+x.id)]),...nav('admin'),
    ]);return true;
  }
  const jobAction=/^(confirm|send|halt|job):([0-9a-f-]{36})$/.exec(data);
  if(jobAction){
    const [,action,jobId]=jobAction;
    const job=await one(env.BOT_DB,'SELECT * FROM bot_broadcasts WHERE id=?',jobId);
    if(!job){await text(env,id,'Рассылка не найдена.',nav('admin'));return true;}
    if(action==='confirm'){
      const d=await draft(env.BOT_DB,id);
      if(job.created_by!==id||d?.step!=='newsletter:preview'||d.data.jobId!==jobId){await text(env,id,'Для отправки откройте собственный черновик рассылки.',nav('admin'));return true;}
      await env.BOT_DB.batch([
        env.BOT_DB.prepare("INSERT OR IGNORE INTO bot_deliveries(broadcast_id,chat_id,status) SELECT ?,chat_id,'pending' FROM bot_subscribers WHERE subscribed=1 AND EXISTS(SELECT 1 FROM bot_broadcasts WHERE id=? AND status='draft')").bind(jobId,jobId),
        env.BOT_DB.prepare("UPDATE bot_broadcasts SET status='sending' WHERE id=? AND status='draft'").bind(jobId),
        env.BOT_DB.prepare('DELETE FROM bot_admin_drafts WHERE actor_id=?').bind(id),
      ]);
    }
    if(action==='halt'){
      await run(env.BOT_DB,"UPDATE bot_broadcasts SET status='cancelled' WHERE id=? AND status IN ('sending','paused')",jobId);
      await text(env,id,'Рассылка остановлена. Уже доставленные сообщения остаются у получателей.',nav('admin'));return true;
    }
    const state=await progress(env,jobId);
    if((action==='confirm'||action==='send')&&['sending','paused'].includes(state.job.status)){
      if(state.job.not_before>Date.now()){await text(env,id,'Telegram попросил подождать ещё '+Math.ceil((state.job.not_before-Date.now())/1000)+' сек.',[[button('Продолжить','send:'+jobId)],...nav('admin')]);return true;}
      await text(env,id,'Отправляю сообщения. Результат появится здесь. Повторное нажатие не создаст вторую рассылку.',nav('admin'));
      ctx.waitUntil(drain(env,jobId,id).catch(()=>text(env,id,'Отправка прервалась. Проверьте прогресс в разделе «Рассылки и статистика».',nav('admin'))));return true;
    }
    await text(env,id,'<b>Рассылка</b>\n\nДоставлено: '+(state.counts.sent||0)+' / '+state.total+'\nОсталось: '+state.remaining+'\nНе доставлено: '+(state.counts.failed||0),[
      ...(state.remaining&&state.job.status!=='cancelled'?[[button('Продолжить','send:'+jobId),button('Остановить','halt:'+jobId)]]:[]),...nav('admin'),
    ]);return true;
  }
  return false;
}
