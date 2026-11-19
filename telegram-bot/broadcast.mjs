import { rows, one, run } from './store.mjs';
import { telegram, text } from './telegram.mjs';
import { sendPost } from './posts.mjs';
import { button, nav } from './catalog.mjs';

const BATCH = 200;
export async function progress(env, id) {
  const job = await one(env.BOT_DB, 'SELECT * FROM bot_broadcasts WHERE id=?', id);
  const counts = await rows(env.BOT_DB, 'SELECT status,count(*) AS n FROM bot_deliveries WHERE broadcast_id=? GROUP BY status', id);
  const c = Object.fromEntries(counts.map(x => [x.status, x.n]));
  return { job, counts: c, total: counts.reduce((n,x) => n+x.n,0), remaining: (c.pending || 0) + (c.sending || 0) };
}
async function setStates(db, id, state, ids) {
  for (let i=0;i<ids.length;i+=90) {
    const part = ids.slice(i,i+90);
    await run(db, 'UPDATE bot_deliveries SET status=?,updated_ms=? WHERE broadcast_id=? AND chat_id IN (' + part.map(() => '?').join(',') + ')', state, Date.now(), id, ...part);
  }
}
export async function drain(env, id, adminId) {
  const now=Date.now(), db=env.BOT_DB;
  const job=await db.prepare("UPDATE bot_broadcasts SET lease_until=? WHERE id=? AND status IN ('sending','paused') AND lease_until<? AND not_before<=? RETURNING *").bind(now+45000,id,now,now).first();
  if (!job) return;
  // A crashed send has an unknown delivery result; never duplicate it automatically.
  await run(db, "UPDATE bot_deliveries SET status='failed' WHERE broadcast_id=? AND status='sending' AND updated_ms<?", id, now-45000);
  const selected=await rows(db, "UPDATE bot_deliveries SET status='sending',updated_ms=? WHERE broadcast_id=? AND chat_id IN (SELECT chat_id FROM bot_deliveries WHERE broadcast_id=? AND status='pending' ORDER BY chat_id LIMIT ?) RETURNING chat_id",now,id,id,BATCH);
  const outcomes={sent:[],failed:[],skipped:[],pending:[]}, blocked=[];
  let retry=0, cursor=0, started=Date.now();
  for (;cursor<selected.length;cursor+=20) {
    if (Date.now()-started>18000 || retry) break;
    // /stop is rechecked before every small group, including queued recipients.
    const part=selected.slice(cursor,cursor+20).map(x=>x.chat_id);
    const active=new Set((await rows(db,'SELECT chat_id FROM bot_subscribers WHERE subscribed=1 AND chat_id IN ('+part.map(()=>'?').join(',')+')',...part)).map(x=>x.chat_id));
    const current=await one(db,'SELECT status FROM bot_broadcasts WHERE id=?',id);
    if(current?.status==='cancelled') break;
    await Promise.all(part.map(async (chat,index)=>{
      if(!active.has(chat)){outcomes.skipped.push(chat);return;}
      await new Promise(resolve=>setTimeout(resolve,index*80));
      try {
        await sendPost(env,chat,job,[
          [button('🎁 Полезные материалы','materials'),button('💎 VIP','buy')],
          [button('🔕 Отключить новости','news:off')],
        ]);
        outcomes.sent.push(chat);
      } catch(e) {
        if(e.status===403){blocked.push(chat);outcomes.skipped.push(chat);}
        else if(e.status===429){retry=Math.max(retry,e.retryAfter||5);outcomes.pending.push(chat);}
        // Ambiguous transport failures are not automatically re-sent.
        else outcomes.failed.push(chat);
      }
    }));
  }
  outcomes.pending.push(...selected.slice(cursor).map(x=>x.chat_id));
  for(const [state,ids] of Object.entries(outcomes)) await setStates(db,id,state,ids);
  for(let i=0;i<blocked.length;i+=90){
    const part=blocked.slice(i,i+90);
    await run(db,'UPDATE bot_subscribers SET subscribed=0,updated_ms=? WHERE chat_id IN ('+part.map(()=>'?').join(',')+')',Date.now(),...part);
  }
  const state=await progress(env,id);
  await run(db,"UPDATE bot_broadcasts SET status=CASE WHEN status='cancelled' THEN status ELSE ? END,lease_until=0,not_before=? WHERE id=?",state.remaining?'paused':'done',retry?Date.now()+retry*1000:0,id);
  const fresh=await progress(env,id);
  const message='<b>Рассылка '+(fresh.job.status==='done'?'завершена':fresh.job.status==='cancelled'?'остановлена':'сохранена')+'</b>\n\nДоставлено: '+(fresh.counts.sent||0)+' из '+fresh.total+
    '\nНе получают новости: '+(fresh.counts.skipped||0)+'\nНе доставлено: '+(fresh.counts.failed||0)+
    (fresh.remaining?'\nОсталось: '+fresh.remaining+'\n'+(retry?'Telegram попросил паузу. Продолжите через '+retry+' сек.':'Нажмите «Продолжить», чтобы отправить следующий пакет.'):'');
  await text(env,adminId,message,[
    ...(fresh.remaining&&fresh.job.status!=='cancelled'?[[button('Продолжить рассылку','send:'+id),button('Остановить','halt:'+id)]]:[]),
    ...nav('admin'),
  ]);
}
