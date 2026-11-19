import { createTributeChecker } from './paid-access.mjs';

const VIP_PUBLIC = 'https://vip.swimisland.ru';
const VIP_PORTAL = '/v1/client/vip';
const VIP_COOKIE = '__Host-swim-client';
const VIP_SESSION_MS = 30 * 86400000;
const VIP_LINK_MS = 15 * 60000;
const VIP_CHECKOUT = 'https://t.me/tribute/app?startapp=sXk3';
const vipHex = bytes => Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const vipToken = () => vipHex(crypto.getRandomValues(new Uint8Array(32)));
const vipHash = async value => vipHex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
const vipCookie = value => value ? VIP_COOKIE+'='+value+'; Path=/; Max-Age='+VIP_SESSION_MS/1000+'; Secure; HttpOnly; SameSite=Strict' : VIP_COOKIE+'=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict';
function vipEqual(a,b) {
  if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;
}
function vipCookieToken(request) {
  const raw=request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(VIP_COOKIE+'='))?.slice(VIP_COOKIE.length+1);
  return /^[a-f0-9]{64}$/.test(raw||'')?raw:null;
}
function vipJson(data,status=200,cookie){
  return Response.json(data,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',...(cookie?{'Set-Cookie':cookie}:{})}});
}
class VipWebError extends Error {constructor(code,status=400){super(code);this.status=status;}}
async function vipInput(request,max=8192) {
  if(Number(request.headers.get('Content-Length'))>max)throw new VipWebError('too_large',413);
  if(!request.body)throw new VipWebError('invalid_input');
  const reader=request.body.getReader(),buffer=new Uint8Array(max);let length=0;
  for(;;){const{done,value}=await reader.read();if(done)break;if(length+value.length>max){await reader.cancel();throw new VipWebError('too_large',413);}buffer.set(value,length);length+=value.length;}
  try{const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,length)));if(data&&typeof data==='object'&&!Array.isArray(data))return data;}catch{}
  throw new VipWebError('invalid_input');
}
function vipCredentials(data){
  const login=typeof data.login==='string'?data.login.trim().toLowerCase():'';
  if(!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(login))throw new VipWebError('web_login_format');
  if(typeof data.proof!=='string'||!/^[a-f0-9]{64}$/.test(data.proof))throw new VipWebError('web_password_format');
  return {login,proof:data.proof};
}
function vipDisplay(value){
  const text=typeof value==='string'?value.normalize('NFC').replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu,' ').replace(/\s+/g,' ').trim():'';
  if([...text].length<2||[...text].length>40)throw new VipWebError('invalid_name');
  return text;
}
function vipSubscription(access,lastPaid=0,now=Date.now()) {
  return {active:access.allowed===true,reason:access.reason,expiresAt:access.reason==='staff'?null:access.expiresAt||lastPaid||null,
    expired:!access.allowed&&access.reason!=='unavailable'&&lastPaid>0&&lastPaid<=now,checkout:VIP_CHECKOUT};
}
async function vipRemember(db,account,paid){
  if(paid.allowed&&paid.expiresAt&&paid.reason!=='staff')await db.prepare('UPDATE chat_tribute_accounts SET paid_until_ms=? WHERE id=? AND paid_until_ms<>?').bind(paid.expiresAt,account,paid.expiresAt).run();
}
export function createTributeWeb({checkPaid=createTributeChecker(),fetcher=(...args)=>fetch(...args)}={}){
  async function accessFor(env,id,now){
    const owners=(env.CHAT_OWNER_IDS||'').split(',').map(x=>x.trim());
    if(owners.includes(String(id))||await env.CHAT_DB.prepare('SELECT 1 FROM chat_coaches WHERE telegram_id=?').bind(id).first()){
      return {allowed:true,reason:'staff',expiresAt:now+VIP_SESSION_MS};
    }
    return checkPaid({...env,TRIBUTE_VIP_SUBSCRIPTION_IDS:env.TRIBUTE_WEB_SUBSCRIPTION_IDS||env.TRIBUTE_VIP_SUBSCRIPTION_IDS||'228039'},id,now);
  }
  async function session(env,request,now=Date.now()){
    const token=vipCookieToken(request);
    if(!token)return {known:false,active:false};
    const account=await env.CHAT_DB.prepare('SELECT a.*,s.expires_ms FROM chat_tribute_sessions s JOIN chat_tribute_accounts a ON a.id=s.account_id WHERE s.token_hash=?').bind(await vipHash(token)).first();
    if(!account)return {known:false,active:false};
    if(account.disabled_ms!==null||account.expires_ms<=now)return {known:true,active:false,reason:'web_auth_required'};
    const access=await accessFor(env,account.telegram_id,now);
    await vipRemember(env.CHAT_DB,account.id,access);
    const subscription=vipSubscription(access,account.paid_until_ms,now);
    return {known:true,active:access.allowed===true,subscription,login:account.login,name:account.display_name,
      ...(access.allowed?{player:{id:account.telegram_id,name:account.display_name,account:account.id,room:null,paidWeb:true,expires:access.expiresAt}}:{})};
  }
  async function issue(env,data,now=Date.now()){
    if(!Number.isSafeInteger(data.telegramId)||data.telegramId<=0||data.reset!==undefined&&typeof data.reset!=='boolean')throw new VipWebError('invalid_input');
    const id=data.telegramId,db=env.CHAT_DB;
    const access=await accessFor(env,id,now);
    if(!access.allowed)return vipJson({ok:false,error:access.reason==='unavailable'?'payment_check_unavailable':'paid_subscription_required',subscription:vipSubscription(access)},access.reason==='unavailable'?503:403);
    let account=await db.prepare('SELECT * FROM chat_tribute_accounts WHERE telegram_id=?').bind(id).first();
    if(account?.disabled_ms!==null&&account?.disabled_ms!==undefined)throw new VipWebError('web_access_ended',403);
    if(account?.password_hash&&!data.reset){
      await vipRemember(db,account.id,access);
      return vipJson({ok:true,registered:true,staff:access.reason==='staff',login:account.login,url:VIP_PUBLIC+VIP_PORTAL,expiresAt:access.expiresAt});
    }
    const token=vipToken(),hash=await vipHash(token);
    const name=typeof data.name==='string'&&data.name.trim().length>=2?[...data.name.trim()].slice(0,40).join(''):'Участник клуба';
    if(!account){
      const accountId='vip-web-'+crypto.randomUUID(),profileCode=vipToken().slice(0,12);
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO chat_profiles(telegram_id,code,name,level) VALUES(?,?,?,'n')").bind(id,profileCode,name),
        db.prepare('INSERT INTO chat_tribute_accounts(id,telegram_id,display_name,activation_hash,activation_expires_ms,created_ms,paid_until_ms) VALUES(?,?,?,?,?,?,?)').bind(accountId,id,name,hash,now+VIP_LINK_MS,now,access.reason==='staff'?0:access.expiresAt),
      ]);
      account={id:accountId};
    }else{
      // Recovery does not revoke an existing password until the new one is successfully saved.
      await db.prepare('UPDATE chat_tribute_accounts SET activation_hash=?,activation_expires_ms=?,paid_until_ms=? WHERE id=? AND disabled_ms IS NULL').bind(hash,now+VIP_LINK_MS,access.reason==='staff'?0:access.expiresAt,account.id).run();
    }
    return vipJson({ok:true,registered:false,staff:access.reason==='staff',recovery:data.reset===true,url:VIP_PUBLIC+VIP_PORTAL+'#invite='+token,expiresAt:access.expiresAt,linkExpiresAt:now+VIP_LINK_MS});
  }
  async function inviteState(env,token,now){
    if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return vipJson({active:false,invite:'invalid'});
    const account=await env.CHAT_DB.prepare('SELECT * FROM chat_tribute_accounts WHERE activation_hash=?').bind(await vipHash(token)).first();
    if(!account||account.disabled_ms!==null)return vipJson({active:false,invite:'invalid'});
    if(account.activation_expires_ms<=now)return vipJson({active:false,invite:'expired'});
    const access=await accessFor(env,account.telegram_id,now);
    return vipJson({active:false,invite:access.allowed?'register':'subscription',subscription:vipSubscription(access,account.paid_until_ms,now),suggestedName:account.display_name,login:account.login,recovery:Boolean(account.password_hash)});
  }
  async function register(env,data,now){
    const{login,proof}=vipCredentials(data),name=vipDisplay(data.name),db=env.CHAT_DB;
    if(typeof data.invite!=='string'||!/^[a-f0-9]{64}$/.test(data.invite))throw new VipWebError('web_invite_invalid',403);
    const inviteHash=await vipHash(data.invite);
    const account=await db.prepare('SELECT * FROM chat_tribute_accounts WHERE activation_hash=? AND activation_expires_ms>? AND disabled_ms IS NULL').bind(inviteHash,now).first();
    if(!account)throw new VipWebError('web_invite_invalid',403);
    const access=await accessFor(env,account.telegram_id,now);
    if(!access.allowed)return vipJson({error:access.reason==='unavailable'?'payment_check_unavailable':'paid_subscription_required',subscription:vipSubscription(access,account.paid_until_ms,now)},access.reason==='unavailable'?503:403);
    const legacy=await db.prepare('SELECT 1 FROM chat_web_accounts WHERE login=?').bind(login).first();
    const used=await db.prepare('SELECT 1 FROM chat_tribute_accounts WHERE login=? AND id<>?').bind(login,account.id).first();
    if(legacy||used)throw new VipWebError('web_login_taken',409);
    const salt=vipToken(),passwordHash=await vipHash('password:'+salt+':'+proof),token=vipToken(),sessionHash=await vipHash(token);
    let saved;
    try {
      saved=await db.batch([
        db.prepare('UPDATE chat_tribute_accounts SET login=?,display_name=?,password_salt=?,password_hash=?,activation_hash=NULL,activation_expires_ms=0,paid_until_ms=?,login_attempts=0 WHERE id=? AND activation_hash=? AND activation_expires_ms>? AND disabled_ms IS NULL AND NOT EXISTS(SELECT 1 FROM chat_web_accounts WHERE login=?)').bind(login,name,salt,passwordHash,access.reason==='staff'?0:access.expiresAt,account.id,inviteHash,now,login),
        db.prepare('DELETE FROM chat_tribute_sessions WHERE account_id=? AND EXISTS(SELECT 1 FROM chat_tribute_accounts WHERE id=? AND password_salt=?)').bind(account.id,account.id,salt),
        db.prepare('INSERT INTO chat_tribute_sessions(token_hash,account_id,expires_ms) SELECT ?,id,? FROM chat_tribute_accounts WHERE id=? AND password_salt=?').bind(sessionHash,now+VIP_SESSION_MS,account.id,salt),
      ]);
    }catch(e){if(await db.prepare('SELECT 1 FROM chat_tribute_accounts WHERE login=? AND id<>?').bind(login,account.id).first())throw new VipWebError('web_login_taken',409);throw e;}
    if(!saved[0].meta.changes||!saved[2].meta.changes){
      if(await db.prepare('SELECT 1 FROM chat_web_accounts WHERE login=?').bind(login).first())throw new VipWebError('web_login_taken',409);
      throw new VipWebError('web_invite_used',409);
    }
    return vipJson({ok:true,subscription:vipSubscription(access)},200,vipCookie(token));
  }
  async function login(env,data,now){
    const{login,proof}=vipCredentials(data),db=env.CHAT_DB;
    const account=await db.prepare('SELECT * FROM chat_tribute_accounts WHERE login=?').bind(login).first();
    if(!account?.password_hash||account.disabled_ms!==null)throw new VipWebError('web_login_invalid',401);
    const attempt=await db.prepare('UPDATE chat_tribute_accounts SET login_attempts=CASE WHEN login_window_ms>? THEN login_attempts+1 ELSE 1 END,login_window_ms=CASE WHEN login_window_ms>? THEN login_window_ms ELSE ? END WHERE id=? AND (login_window_ms<=? OR login_attempts<7) RETURNING id').bind(now-600000,now-600000,now,account.id,now-600000).first();
    if(!attempt)throw new VipWebError('web_login_wait',429);
    if(!vipEqual(account.password_hash,await vipHash('password:'+account.password_salt+':'+proof)))throw new VipWebError('web_login_invalid',401);
    await db.prepare('UPDATE chat_tribute_accounts SET login_attempts=0 WHERE id=?').bind(account.id).run();
    const access=await accessFor(env,account.telegram_id,now);
    if(!access.allowed)return vipJson({error:access.reason==='unavailable'?'payment_check_unavailable':'paid_subscription_required',subscription:vipSubscription(access,account.paid_until_ms,now)},access.reason==='unavailable'?503:403);
    await vipRemember(db,account.id,access);
    const token=vipToken();
    const [saved]=await db.batch([
      db.prepare('INSERT INTO chat_tribute_sessions(token_hash,account_id,expires_ms) SELECT ?,id,? FROM chat_tribute_accounts WHERE id=? AND password_salt=? AND disabled_ms IS NULL').bind(await vipHash(token),now+VIP_SESSION_MS,account.id,account.password_salt),
      db.prepare('DELETE FROM chat_tribute_sessions WHERE account_id=? AND expires_ms<=?').bind(account.id,now),
    ]);
    if(!saved.meta.changes)throw new VipWebError('web_login_invalid',401);
    return vipJson({ok:true,subscription:vipSubscription(access)},200,vipCookie(token));
  }
  async function rpc(request,env,now=Date.now()){
    if(request.method!=='POST')return vipJson({error:'method_not_allowed'},405);
    if(!env.TRIBUTE_WEB_BRIDGE_SECRET||!vipEqual(request.headers.get('Authorization'),'Bearer '+env.TRIBUTE_WEB_BRIDGE_SECRET))return vipJson({error:'unauthorized'},401);
    try{
      const data=await vipInput(request,4096);
      if(data.operation==='health'){
        try{
          const response=await fetcher('https://swim-island-entry-bot.pages.dev/media/logo.jpg',{headers:{'Accept-Encoding':'identity'},redirect:'manual',signal:AbortSignal.timeout(18000)});
          return vipJson({ok:response.ok,entryStatus:response.status,type:response.headers.get('Content-Type'),...(response.ok?{}:{detail:(await response.text()).slice(0,300)})});
        }catch(error){return vipJson({ok:false,networkError:error.name,detail:String(error.message).slice(0,300)});}
      }
      return await issue(env,data,now);
    }catch(e){return vipJson({error:e instanceof VipWebError?e.message:'unavailable'},e.status||503);}
  }
  async function entryProxy(request,env,url){
    const rest=url.pathname.slice('/v1/client/entry'.length);
    const routes={'/menu':'/menu','/menu.js':'/menu.js','/menu.css':'/menu.css','/telegram-web-app.js':'/telegram-web-app.js','/bootstrap':'/menu/bootstrap','/action':'/menu/action'};
    const media=/^\/media\/[a-z0-9-]+\.(?:jpg|png|webp)$/.test(rest);
    const target=media?rest:routes[rest];
    if(!target)return vipJson({error:'not_found'},404);
    const post=rest==='/bootstrap'||rest==='/action';
    if(request.method!==(post?'POST':'GET'))return vipJson({error:'method_not_allowed'},405);
    const options={method:request.method,headers:{'Content-Type':'application/json','Accept-Encoding':'identity'},redirect:'manual',signal:AbortSignal.timeout(18000)};
    if(post)options.body=JSON.stringify(await vipInput(request,16384));
    const response=await fetcher('https://swim-island-entry-bot.pages.dev'+target,options);
    if(response.status>=300&&response.status<400)return vipJson({error:'unavailable'},503);
    const headers={'Cache-Control':post?'no-store':'private, max-age=60','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Type':response.headers.get('Content-Type')||'application/octet-stream'};
    return new Response(response.body,{status:response.status,headers});
  }
  async function routes(request,env,url,now=Date.now()){
    if(url.pathname.startsWith('/v1/client/entry/')){
      try{return await entryProxy(request,env,url);}catch(e){return vipJson({error:'unavailable'},e.status||503);}
    }
    if(url.pathname!==VIP_PORTAL&&!url.pathname.startsWith(VIP_PORTAL+'/'))return null;
    const part=url.pathname.slice(VIP_PORTAL.length);
    if(request.method==='GET'&&['','/','/portal.js','/portal.css','/chat.js'].includes(part)){
      const file=part==='/portal.js'?'portal.js':part==='/portal.css'?'portal.css':part==='/chat.js'?'chat.js':'index.html';
      const response=await env.ASSETS.fetch(new Request(new URL(file==='index.html'?'/vip/':'/vip/'+file,url.origin)));
      return new Response(response.body,{status:response.status,headers:{'Content-Type':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
    }
    if(request.method==='GET'&&part==='/manifest.webmanifest')return new Response(JSON.stringify({name:'Плавательный остров VIP',short_name:'Остров VIP',lang:'ru',start_url:VIP_PORTAL,scope:VIP_PORTAL,display:'standalone',background_color:'#08191f',theme_color:'#08191f',icons:[{src:'/client/vip-icon-512.png',sizes:'512x512',type:'image/png',purpose:'any maskable'}]}),{headers:{'Content-Type':'application/manifest+json'}});
    try{
      if(part==='/session'&&request.method==='GET'){
        const state=await session(env,request,now);
        return vipJson(state.active?{active:true,subscription:state.subscription,login:state.login,name:state.name}:{active:false,subscription:state.subscription,known:state.known});
      }
      if(part==='/invite'&&request.method==='POST')return inviteState(env,(await vipInput(request,1024)).invite,now);
      if(part==='/register'&&request.method==='POST')return register(env,await vipInput(request,4096),now);
      if(part==='/login'&&request.method==='POST')return login(env,await vipInput(request,1024),now);
      if(part==='/logout'&&request.method==='POST'){
        const token=vipCookieToken(request);
        if(token)await env.CHAT_DB.prepare('DELETE FROM chat_tribute_sessions WHERE token_hash=?').bind(await vipHash(token)).run();
        return vipJson({ok:true},200,vipCookie(''));
      }
      return vipJson({error:'not_found'},404);
    }catch(e){return vipJson({error:e instanceof VipWebError?e.message:'unavailable'},e.status||503);}
  }
  return {session,issue,register,login,rpc,routes,password:async(env,data,now)=>{try{return await login(env,data,now);}catch(e){return vipJson({error:e instanceof VipWebError?e.message:'unavailable'},e.status||503);}}};
}
export const tributeWeb = createTributeWeb();
