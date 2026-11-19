import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import { menuUser } from './menu-auth.mjs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { handleUpdate, tariffs, setup } from './worker.mjs';
import { SEED, publicCard } from './catalog.mjs';
import { adminCallback } from './admin.mjs';
import { drain } from './broadcast.mjs';
import { rows, one, run } from './store.mjs';

function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  const prepare=sql=>{
    const statement=sqlite.prepare(sql);
    const bind=(...args)=>({
      first:async()=>statement.get(...args)??null,
      all:async()=>({results:statement.all(...args)}),
      run:async()=>({meta:{changes:statement.run(...args).changes}}),
      exec:()=>statement.columns().length?{results:statement.all(...args)}:{meta:{changes:statement.run(...args).changes}},
      bind,
    });return bind();
  };
  const db={prepare,batch:async statements=>{
    sqlite.exec('BEGIN');try{const r=statements.map(x=>x.exec());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}
  }};
  for(const item of SEED)sqlite.prepare('INSERT INTO bot_materials(id,category,title,description,kind,payload,photo,created_ms) VALUES(?,?,?,?,?,?,?,?)').run(item.id,item.category,item.title,item.description,item.kind,item.payload,item.photo,1);
  const env={BOT_DB:db,BOT_ADMIN_IDS:'1,2',TELEGRAM_BOT_TOKEN:'test-only',TELEGRAM_WEBHOOK_SECRET:'webhook-test-only',BOT_CONTROL_TOKEN:'control-test-only',TRIBUTE_API_KEY:'tribute-test-only',TRIBUTE_VIP_SUBSCRIPTION_IDS:'228039',ASSETS:{fetch:async()=>new Response('test-only-file',{headers:{'Content-Type':'image/jpeg'}})}};
  const calls=[],tasks=[];
  let updateId=0,messageId=100,menuButton={type:'commands'};
  const ctx={waitUntil:p=>tasks.push(p)};
  const request=new Request('https://bot.test/telegram');
  const mockFetch=async (url,options)=>{
    if(String(url).startsWith('https://tribute.tg/'))return Response.json({result:[{subscriptionId:228039,currency:'rub',periods:[{period:'monthly',price:1290},{period:'halfyearly',price:5990},{period:'yearly',price:9990}]}]});
    assert(String(url).startsWith('https://api.telegram.org/bottest-only/'));
    const method=String(url).split('/').at(-1);
    const body=options.body instanceof FormData?Object.fromEntries(options.body.entries()):JSON.parse(options.body);
    calls.push({method,body});
    if(['copyMessage','sendMessage'].includes(method)&&body.chat_id===88)return Response.json({ok:false,error_code:403},{status:403});
    let result=true;
    if(method==='sendPhoto'||method==='editMessageMedia')result={message_id:++messageId,photo:[{file_id:'cached-photo'}]};
    if(method==='sendMessage'||method==='copyMessage')result={message_id:++messageId};
    if(method==='getMe')result={id:9155572612,username:'swim_island_entry_bot'};
    if(method==='getWebhookInfo')result={url:'https://bot.test/telegram',pending_update_count:0};
    if(method==='getMyCommands')result=[{command:'menu'}];
    if(method==='setChatMenuButton'&&!body.chat_id)menuButton=JSON.parse(body.menu_button);
    if(method==='getChatMenuButton')result=menuButton;
    if(method==='getUserProfilePhotos')result={total_count:1,photos:[]};
    return Response.json({ok:true,result});
  };
  const message=(id,value,extra={})=>({update_id:++updateId,message:{from:{id,is_bot:false},chat:{id,type:'private'},message_id:++messageId,text:value,...extra}});
  const callback=(id,data)=>({update_id:++updateId,callback_query:{id:'q-'+updateId,from:{id,is_bot:false},data,message:{chat:{id,type:'private'},message_id:100,photo:[{file_id:'existing-photo'}]}}});
  return{sqlite,db,env,calls,tasks,ctx,request,mockFetch,message,callback};
}
async function mocked(f,fn){
  const original=globalThis.fetch;globalThis.fetch=f.mockFetch;
  try{return await fn();}finally{globalThis.fetch=original;}
}
test('unsigned hooks and control calls never register users or send messages',async()=>{
  const f=fixture();
  for(const path of ['/telegram','/control/setup']){
    const r=await worker.fetch(new Request('https://bot.test'+path,{method:'POST',body:JSON.stringify(f.message(42,'/start'))}),f.env,f.ctx);
    assert.equal(r.status,401);
  }
  assert.equal((await one(f.db,'SELECT count(*) AS n FROM bot_subscribers')).n,0);
  assert.equal(f.calls.length,0);
});
test('start opens a photo menu; stop persists after restarting; updates are deduplicated',async()=>{
  const f=fixture();
  await mocked(f,async()=>{
    const update=f.message(42,'/start instagram');
    const send=u=>worker.fetch(new Request('https://bot.test/telegram',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':f.env.TELEGRAM_WEBHOOK_SECRET},body:JSON.stringify(u)}),f.env,f.ctx);
    assert.equal((await send(update)).status,200);
    const n=f.calls.length;
    assert.equal((await send(update)).status,200);assert.equal(f.calls.length,n);
    const first=f.calls.find(x=>x.method==='sendPhoto');
    assert(first.body.caption.includes('Плавательный остров'));
    const keyboard=JSON.parse(first.body.reply_markup).inline_keyboard.flat();
    assert(keyboard.some(x=>x.callback_data==='materials')&&keyboard.some(x=>x.callback_data==='buy'));
    await send(f.message(42,'/stop'));
    await send(f.message(42,'/start'));
    assert.equal((await one(f.db,'SELECT subscribed FROM bot_subscribers WHERE chat_id=42')).subscribed,0);
    assert.equal((await one(f.db,'SELECT source FROM bot_subscribers WHERE chat_id=42')).source,'instagram');
  });
});
test('all public sections keep photos, return navigation and working catalogue files',async()=>{
  const f=fixture();
  await mocked(f,async()=>{
    await handleUpdate(f.request,f.env,f.message(42,'/start'),f.ctx);
    for(const data of ['materials','about','tariffs','buy','access','news','help','cat:lessons','cat:checklists','cat:plans','mat:breaststroke8']){
      await handleUpdate(f.request,f.env,f.callback(42,data),f.ctx);
      const photo=f.calls.at(-1);assert.equal(photo.method,'editMessageMedia');
      const media=JSON.parse(photo.body.media);
      assert(media.caption.length<1500&&media.media);
      assert(JSON.parse(photo.body.reply_markup).inline_keyboard.flat().some(x=>['home','materials','cat:plans'].includes(x.callback_data)));
    }
    await handleUpdate(f.request,f.env,f.callback(42,'file:breaststroke8'),f.ctx);
    assert.equal(f.calls.at(-1).method,'sendDocument');
    assert(f.calls.at(-1).body.document instanceof Blob);
    const card=await tariffs(f.env);
    assert(card.caption.includes('1 290')||card.caption.includes('1 290'));
    assert(!card.caption.includes('590 ₽ за первый'));
  });
});
test('fake admin handles and forged callback buttons cannot publish or broadcast',async()=>{
  const f=fixture();
  await mocked(f,async()=>{
    await handleUpdate(f.request,f.env,f.message(42,'/admin',{from:{id:42,username:'rese1go'}}),f.ctx);
    await handleUpdate(f.request,f.env,f.callback(42,'admin:add'),f.ctx);
    await handleUpdate(f.request,f.env,f.callback(42,'publish:forged'),f.ctx);
    assert.equal((await one(f.db,'SELECT count(*) AS n FROM bot_materials')).n,3);
    assert.equal((await one(f.db,'SELECT count(*) AS n FROM bot_admin_drafts')).n,0);
    assert.equal(f.tasks.length,0);
  });
});
test('trainer can publish a PDF with a photo; publishing never sends a newsletter',async()=>{
  const f=fixture();
  await mocked(f,async()=>{
    await handleUpdate(f.request,f.env,f.callback(1,'admin:category:lessons'),f.ctx);
    await handleUpdate(f.request,f.env,f.message(1,'Мой урок'),f.ctx);
    await handleUpdate(f.request,f.env,f.message(1,'Короткое описание'),f.ctx);
    await handleUpdate(f.request,f.env,f.message(1,undefined,{document:{file_id:'new-document',mime_type:'application/pdf'}}),f.ctx);
    await handleUpdate(f.request,f.env,f.callback(1,'admin:defaultphoto'),f.ctx);
    const d=await one(f.db,'SELECT nonce FROM bot_admin_drafts WHERE actor_id=1');
    await handleUpdate(f.request,f.env,f.callback(1,'publish:'+d.nonce),f.ctx);
    await handleUpdate(f.request,f.env,f.callback(1,'publish:'+d.nonce),f.ctx);
    const item=await one(f.db,"SELECT * FROM bot_materials WHERE title='Мой урок'");
    assert.equal(item.kind,'document');assert.equal(item.payload,'new-document');assert(item.photo);
    assert.equal((await one(f.db,'SELECT count(*) AS n FROM bot_materials')).n,4);
    assert.equal((await one(f.db,'SELECT count(*) AS n FROM bot_broadcasts')).n,0);
    assert.equal(f.tasks.length,0);
  });
});
test('newsletter is only sent after confirmation, honors opt-out and does not duplicate',async()=>{
  const f=fixture();
  await mocked(f,async()=>{
    for(const id of [42,43,88])await handleUpdate(f.request,f.env,f.message(id,'/start'),f.ctx);
    await handleUpdate(f.request,f.env,f.message(43,'/stop'),f.ctx);
    await handleUpdate(f.request,f.env,f.callback(1,'admin:newsletter'),f.ctx);
    await handleUpdate(f.request,f.env,f.message(1,'Новый материал в клубе'),f.ctx);
    assert(!f.calls.some(x=>x.method==='copyMessage'&&x.body.chat_id!==1));
    const job=await one(f.db,'SELECT id FROM bot_broadcasts');
    await handleUpdate(f.request,f.env,f.callback(2,'confirm:'+job.id),f.ctx);
    assert.equal(f.tasks.length,0);
    await handleUpdate(f.request,f.env,f.callback(1,'confirm:'+job.id),f.ctx);
    await Promise.all(f.tasks);
    const sent=()=>f.calls.filter(x=>x.method==='sendMessage'&&x.body.chat_id===42&&x.body.text==='Новый материал в клубе').length;
    assert.equal(sent(),1);
    assert(!f.calls.some(x=>x.method==='sendMessage'&&x.body.chat_id===43));
    assert.equal((await one(f.db,'SELECT subscribed FROM bot_subscribers WHERE chat_id=88')).subscribed,0);
    await drain(f.env,job.id,1);
    assert.equal(sent(),1);
    assert.equal((await one(f.db,'SELECT status FROM bot_broadcasts WHERE id=?',job.id)).status,'done');
  });
});
test('profile setup verifies the target bot and configures avatar and scoped commands',async()=>{
  const f=fixture();
  await mocked(f,async()=>{
    const result=await setup(f.env,'https://bot.test');
    assert.equal(result.username,'swim_island_entry_bot');assert(result.avatarConfigured);
    assert(f.calls.some(x=>x.method==='setMyProfilePhoto'&&x.body.avatar instanceof Blob));
    const scoped=f.calls.filter(x=>x.method==='setMyCommands');
    assert(scoped.some(x=>!x.body.scope&&!x.body.commands.some(c=>c.command==='admin')));
    assert(scoped.some(x=>x.body.scope?.chat_id===1&&x.body.commands.some(c=>c.command==='admin')));
    assert(!f.calls.some(x=>['sendMessage','sendPhoto','copyMessage'].includes(x.method)));
  });
});
test('invalid callback identities and group updates cannot create subscriber records',async()=>{
  const f=fixture();
  const wrong=f.callback(42,'materials');wrong.callback_query.from.id=43;
  await handleUpdate(f.request,f.env,wrong,f.ctx);
  const group=f.message(42,'/start');group.message.chat.type='group';
  await handleUpdate(f.request,f.env,group,f.ctx);
  assert.equal((await one(f.db,'SELECT count(*) AS n FROM bot_subscribers')).n,0);
});
test('growing material catalogues paginate without hiding older lessons',async()=>{
  const f=fixture();
  for(let i=0;i<12;i++)await run(f.db,'INSERT INTO bot_materials(id,category,title,description,kind,payload,photo,created_ms) VALUES(?,?,?,?,?,?,?,?)','lesson-'+i,'lessons','Урок '+i,'Описание','url','https://example.test/lesson','/media/learning.jpg',i);
  await mocked(f,async()=>{
    await handleUpdate(f.request,f.env,f.callback(42,'cat:lessons'),f.ctx);
    let keys=JSON.parse(f.calls.at(-1).body.reply_markup).inline_keyboard.flat();
    assert.equal(keys.filter(x=>x.callback_data?.startsWith('mat:')).length,8);
    assert(keys.some(x=>x.callback_data==='cat:lessons:1'));
    await handleUpdate(f.request,f.env,f.callback(42,'cat:lessons:1'),f.ctx);
    keys=JSON.parse(f.calls.at(-1).body.reply_markup).inline_keyboard.flat();
    assert.equal(keys.filter(x=>x.callback_data?.startsWith('mat:')).length,4);
    assert(keys.some(x=>x.callback_data==='cat:lessons:0'));
  });
});
function initData(env,id=42,date=Math.floor(Date.now()/1000)){
  const params=new URLSearchParams({auth_date:String(date),query_id:'test-query',signature:'test-third-party-signature',user:JSON.stringify({id,first_name:'Пловец',is_bot:false})});
  params.sort();
  const key=createHmac('sha256','WebAppData').update(env.TELEGRAM_BOT_TOKEN).digest();
  params.set('hash',createHmac('sha256',key).update([...params].map(([k,v])=>k+'='+v).join('\n')).digest('hex'));
  return params.toString();
}
test('tile menu verifies Telegram data, rejects replayed identity changes and expired signatures',async()=>{
  const f=fixture(),valid=initData(f.env);
  assert.equal((await menuUser(f.env,valid)).id,42);
  assert.equal(await menuUser(f.env,valid.replace('test-query','forged-query')),null);
  assert.equal(await menuUser(f.env,initData(f.env,42,Math.floor(Date.now()/1000)-3601)),null);
  assert.equal(await menuUser(f.env,valid+'&user=forged'),null);
});
test('native Menu opens the tile web app and role-protected actions are delivered only once',async()=>{
  const f=fixture();
  await mocked(f,async()=>{
    await setup(f.env,'https://bot.test');
    const configured=JSON.parse(f.calls.find(x=>x.method==='setChatMenuButton').body.menu_button);
    assert.equal(configured.type,'web_app');
    assert.equal(configured.web_app.url,'https://vip.swimisland.ru/v1/client/entry/menu');
    const call=(id,path,extra={})=>worker.fetch(new Request('https://bot.test/menu/'+path,{method:'POST',body:JSON.stringify({initData:initData(f.env,id),...extra})}),f.env,f.ctx);
    assert.equal((await(await call(42,'bootstrap')).json()).admin,false);
    assert.equal((await(await call(1,'bootstrap')).json()).admin,true);
    assert.equal((await call(42,'action',{action:'admin',nonce:crypto.randomUUID()})).status,403);
    const nonce=crypto.randomUUID();
    const r=await call(42,'action',{action:'materials',nonce});
    assert.equal(r.status,200);
    const n=f.calls.filter(x=>x.method==='sendPhoto').length;
    await call(42,'action',{action:'materials',nonce});
    assert.equal(f.calls.filter(x=>x.method==='sendPhoto').length,n);
  });
});
