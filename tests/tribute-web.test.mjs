import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createTributeWeb} from '../chats/tribute-web.mjs';
import appWorker from '../chats/worker.mjs';

function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../chats/schema.sql',import.meta.url),'utf8'));
  const prepare=sql=>{
    const statement=sqlite.prepare(sql);
    const bind=(...args)=>({first:async()=>statement.get(...args)??null,all:async()=>({results:statement.all(...args)}),run:async()=>({meta:{changes:statement.run(...args).changes}}),exec:()=>statement.columns().length?{results:statement.all(...args)}:{meta:{changes:statement.run(...args).changes}},bind});
    return bind();
  };
  const db={prepare,batch:async statements=>{sqlite.exec('BEGIN');try{const r=statements.map(x=>x.exec());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  const now=Date.now(),paid=new Map([[42,{until:now+5000,reason:'paid'}]]);
  const check=async(env,id,at)=>{
    const value=paid.get(id);
    if(value?.reason==='unavailable')return{allowed:false,reason:'unavailable'};
    if(value?.reason==='trial')return{allowed:false,reason:'trial'};
    return value?.until>at?{allowed:true,reason:'paid',expiresAt:value.until}:{allowed:false,reason:'unpaid'};
  };
  const service=createTributeWeb({checkPaid:check});
  const env={CHAT_DB:db,TRIBUTE_WEB_BRIDGE_SECRET:'test-only-bridge-secret'};
  return{sqlite,db,now,paid,service,env};
}
const stateRequest=cookie=>new Request('https://swim-island-chats.pages.dev/v1/client/session',{headers:{Cookie:cookie||''}});
async function signup(f,id=42,login='test_swimmer',proof='a'.repeat(64)){
  const invitation=await (await f.service.issue(f.env,{telegramId:id,name:'Тестовый пловец'},f.now)).json();
  const token=new URLSearchParams(new URL(invitation.url).hash.slice(1)).get('invite');
  const registered=await f.service.register(f.env,{invite:token,login,proof,name:'Мой ник'},f.now);
  const cookie=registered.headers.get('Set-Cookie').split(';')[0];
  return {invitation,token,registered,cookie,login,proof};
}
test('only the trusted entry bot can issue web activation links',async()=>{
  const f=fixture();
  for(const header of [undefined,'Bearer forged']){
    const r=await f.service.rpc(new Request('https://swim-island-chats.pages.dev/v1/internal/tribute-web',{method:'POST',headers:header?{Authorization:header}:{},body:JSON.stringify({telegramId:42})}),f.env,f.now);
    assert.equal(r.status,401);
  }
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM chat_tribute_accounts').get().n,0);
});
test('trial, unpaid and provider-error states cannot create paid web accounts',async()=>{
  for(const reason of ['trial','unpaid','unavailable']){
    const f=fixture();f.paid.set(42,{reason,until:0});
    const r=await f.service.issue(f.env,{telegramId:42,name:'Пловец'},f.now);
    assert.equal(r.status,reason==='unavailable'?503:403);
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM chat_tribute_accounts').get().n,0);
  }
});
test('activation is one use, creates no coaching agreement and stores only salted proof hashes',async()=>{
  const f=fixture(),s=await signup(f);
  assert.equal(s.registered.status,200);
  assert.match(s.cookie,/^__Host-swim-client=[a-f0-9]{64}$/);
  const row=f.sqlite.prepare('SELECT * FROM chat_tribute_accounts').get();
  assert.equal(row.telegram_id,42);assert.equal(row.login,s.login);assert.notEqual(row.password_hash,s.proof);assert.equal(row.activation_hash,null);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM chat_coaching').get().n,0);
  await assert.rejects(()=>f.service.register(f.env,{invite:s.token,login:s.login,proof:s.proof,name:'Другой'},f.now),/web_invite_invalid/);
  const again=await(await f.service.issue(f.env,{telegramId:42},f.now)).json();
  assert(again.registered);assert.equal(again.login,s.login);assert(!again.url.includes('invite'));
});
test('expired subscription blocks an existing session; renewal restores the same account and password',async()=>{
  const f=fixture(),s=await signup(f),before=f.sqlite.prepare('SELECT password_hash FROM chat_tribute_accounts').get();
  assert((await f.service.session(f.env,stateRequest(s.cookie),f.now)).active);
  const ended=await f.service.session(f.env,stateRequest(s.cookie),f.now+5000);
  assert.equal(ended.active,false);assert(ended.subscription.expired);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM chat_tribute_accounts').get().n,1);
  f.paid.set(42,{until:f.now+86400000,reason:'paid'});
  assert((await f.service.session(f.env,stateRequest(s.cookie),f.now+6000)).active);
  assert.equal(f.sqlite.prepare('SELECT password_hash FROM chat_tribute_accounts').get().password_hash,before.password_hash);
});
test('temporary verification failure blocks content without falsely calling the subscription expired',async()=>{
  const f=fixture(),s=await signup(f);f.paid.set(42,{reason:'unavailable'});
  const state=await f.service.session(f.env,stateRequest(s.cookie),f.now+1000);
  assert.equal(state.active,false);assert.equal(state.subscription.reason,'unavailable');assert.equal(state.subscription.expired,false);
});
test('password recovery preserves the old password until completion and then revokes old sessions',async()=>{
  const f=fixture(),s=await signup(f);
  const reset=await(await f.service.issue(f.env,{telegramId:42,reset:true},f.now+1000)).json();
  const token=new URLSearchParams(new URL(reset.url).hash.slice(1)).get('invite');
  assert.equal((await f.service.password(f.env,{login:s.login,proof:s.proof},f.now+1000)).status,200);
  const changed=await f.service.register(f.env,{invite:token,login:s.login,proof:'b'.repeat(64),name:'Мой ник'},f.now+1000);
  assert.equal(changed.status,200);
  assert.equal((await f.service.session(f.env,stateRequest(s.cookie),f.now+1001)).active,false);
  assert.equal((await f.service.password(f.env,{login:s.login,proof:s.proof},f.now+1001)).status,401);
  assert.equal((await f.service.password(f.env,{login:s.login,proof:'b'.repeat(64)},f.now+1001)).status,200);
});
test('expired activation and username collisions cannot overwrite another account',async()=>{
  const f=fixture();
  const invitation=await(await f.service.issue(f.env,{telegramId:42},f.now)).json();
  const token=new URLSearchParams(new URL(invitation.url).hash.slice(1)).get('invite');
  await assert.rejects(()=>f.service.register(f.env,{invite:token,login:'swimmer',proof:'a'.repeat(64),name:'Пловец'},f.now+15*60000),/web_invite_invalid/);
  await signup(f,42,'occupied');
  f.paid.set(43,{until:f.now+5000,reason:'paid'});
  const other=await(await f.service.issue(f.env,{telegramId:43},f.now)).json();
  const second=new URLSearchParams(new URL(other.url).hash.slice(1)).get('invite');
  await assert.rejects(()=>f.service.register(f.env,{invite:second,login:'occupied',proof:'b'.repeat(64),name:'Другой'},f.now),/web_login_taken/);
});
test('staff access depends on existing server roles and is identified separately from a paid subscription',async()=>{
  const f=fixture();
  f.sqlite.prepare("INSERT INTO chat_profiles VALUES(1,'123456789abc','Тренер','n')").run();
  f.sqlite.prepare("INSERT INTO chat_coaches VALUES(1,'coach','Тренер')").run();
  const s=await signup(f,1,'coach');
  const state=await f.service.session(f.env,stateRequest(s.cookie),f.now);
  assert(state.active);assert.equal(state.subscription.reason,'staff');assert.equal(state.subscription.expiresAt,null);
});
test('real web routes preserve Telegram identity and enforce subscription on chats and library-session checks',async()=>{
  const f=fixture(),originalFetch=globalThis.fetch;
  const env={...f.env,TRIBUTE_API_KEY:'integration-test-only',TRIBUTE_VIP_SUBSCRIPTION_IDS:'228039'};
  const until=Date.now()+4000;
  globalThis.fetch=async url=>{
    assert(String(url).startsWith('https://tribute.tg/api/v1/subscribers'));
    return Response.json({result:[{telegramUserId:42,subscriptionId:228039,status:'active',period:'monthly',activatedAt:new Date(until-10000).toISOString(),expireAt:new Date(until).toISOString()}]});
  };
  try{
    const ctx={waitUntil(){}};
    const rpc=await appWorker.fetch(new Request('https://swim-island-chats.pages.dev/v1/internal/tribute-web',{method:'POST',headers:{Authorization:'Bearer '+env.TRIBUTE_WEB_BRIDGE_SECRET},body:JSON.stringify({telegramId:42,name:'Пловец'})}),env,ctx);
    assert.equal(rpc.status,200);
    const token=new URLSearchParams(new URL((await rpc.json()).url).hash.slice(1)).get('invite');
    const send=(path,data,cookie)=>appWorker.fetch(new Request('https://swim-island-chats.pages.dev'+path,{method:data?'POST':'GET',headers:{Origin:'https://swim-island-chats.pages.dev',...(cookie?{Cookie:cookie}:{}),'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined}),env,ctx);
    const register=await send('/v1/client/vip/register',{invite:token,login:'route_swimmer',proof:'c'.repeat(64),name:'Пловец'});
    assert.equal(register.status,200);const cookie=register.headers.get('Set-Cookie').split(';')[0];
    assert((await(await send('/v1/client/session',null,cookie)).json()).active);
    const chats=await(await send('/v1/client/chats',null,cookie)).json();
    assert(chats.rooms.some(x=>x.id==='club-training'));assert(chats.profile.code);
    const message=await send('/v1/client/chats/rooms/club-training',{text:'Тестовая тренировка',clientId:crypto.randomUUID()},cookie);
    assert.equal(message.status,200);
    const list=await(await send('/v1/client/chats/rooms/club-training',null,cookie)).json();
    assert(list.messages.some(x=>x.text==='Тестовая тренировка'&&x.own));
    f.sqlite.prepare("INSERT INTO chat_profiles VALUES(1,'111111111111','Первый','n'),(2,'222222222222','Второй','n')").run();
    const privateRoom='direct-'+crypto.randomUUID();f.sqlite.prepare('INSERT INTO chat_direct VALUES(?,?,?)').run(privateRoom,1,2);
    assert.equal((await send('/v1/client/chats/rooms/'+privateRoom,null,cookie)).status,403);
    const originalNow=Date.now;Date.now=()=>until+1;
    try{
      assert.equal((await(await send('/v1/client/session',null,cookie)).json()).active,false);
      assert.equal((await send('/v1/client/chats/rooms/club-training',null,cookie)).status,401);
      const expired=await(await send('/v1/client/vip/session',null,cookie)).json();
      assert(expired.subscription.expired);
    }finally{Date.now=originalNow;}
  }finally{globalThis.fetch=originalFetch;}
});
test('an in-flight login using the old password cannot create a session after password recovery',async()=>{
  const f=fixture(),s=await signup(f);
  const reset=await(await f.service.issue(f.env,{telegramId:42,reset:true},f.now+1000)).json();
  const token=new URLSearchParams(new URL(reset.url).hash.slice(1)).get('invite');
  let release,ready;
  const gate=new Promise(r=>release=r),entered=new Promise(r=>ready=r);
  const delayed=createTributeWeb({checkPaid:async()=>{ready();await gate;return{allowed:true,reason:'paid',expiresAt:f.now+5000};}});
  const oldLogin=delayed.password(f.env,{login:s.login,proof:s.proof},f.now+1000);
  await entered;
  await f.service.register(f.env,{invite:token,login:s.login,proof:'b'.repeat(64),name:'Мой ник'},f.now+1000);
  release();
  assert.equal((await oldLogin).status,401);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM chat_tribute_sessions').get().n,1);
});
test('a legacy login claimed concurrently cannot be overwritten or shadowed by VIP registration',async()=>{
  const f=fixture();
  const invitation=await(await f.service.issue(f.env,{telegramId:42},f.now)).json();
  const token=new URLSearchParams(new URL(invitation.url).hash.slice(1)).get('invite');
  const original=f.db.batch;
  f.db.batch=async statements=>{
    f.sqlite.prepare("INSERT INTO chat_web_accounts(id,role,owner_id,room_id,label,invite_hash,login) VALUES(?,'partner',42,NULL,'Trainer',?,?)").run('partner-'+crypto.randomUUID(),'f'.repeat(64),'shared_login');
    f.db.batch=original;return original(statements);
  };
  await assert.rejects(()=>f.service.register(f.env,{invite:token,login:'shared_login',proof:'a'.repeat(64),name:'Пловец'},f.now),/web_login_taken/);
  assert.equal(f.sqlite.prepare('SELECT password_hash FROM chat_tribute_accounts').get().password_hash,null);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM chat_tribute_sessions').get().n,0);
});
test('ordinary web activation accepts only the configured public VIP subscription, even if provider filtering is ignored',async()=>{
  const f=fixture(),original=globalThis.fetch;
  globalThis.fetch=async value=>{
    const url=new URL(value);assert.equal(url.searchParams.get('subscriptionID'),'228039');
    return Response.json({result:[{telegramUserId:42,subscriptionId:999999,status:'active',period:'monthly',link:'https://t.me/tribute/app?startapp=sXk3',activatedAt:new Date(f.now-1000).toISOString(),expireAt:new Date(f.now+86400000).toISOString()}]});
  };
  try{
    const service=createTributeWeb();
    const r=await service.issue({...f.env,TRIBUTE_API_KEY:'allowlist-test-only'},{telegramId:42},f.now);
    assert.equal(r.status,403);
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM chat_tribute_accounts').get().n,0);
  }finally{globalThis.fetch=original;}
});
