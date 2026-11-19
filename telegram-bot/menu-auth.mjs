export async function menuUser(env,value,now=Date.now()){
  if(typeof value!=='string'||value.length>12000||!env.TELEGRAM_BOT_TOKEN)return null;
  const params=new URLSearchParams(value),keys=[...params.keys()];
  if(keys.length>32||new Set(keys).size!==keys.length)return null;
  const raw=params.get('hash')||'',date=Number(params.get('auth_date'));
  if(!/^[a-f0-9]{64}$/i.test(raw)||!Number.isSafeInteger(date)||date<=0||date*1000>now+30000||date*1000<now-3600000)return null;
  params.delete('hash');params.sort();
  const text=[...params].map(([key,value])=>key+'='+value).join('\n'),bytes=new TextEncoder();
  const seed=await crypto.subtle.importKey('raw',bytes.encode('WebAppData'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const secret=await crypto.subtle.sign('HMAC',seed,bytes.encode(env.TELEGRAM_BOT_TOKEN));
  const key=await crypto.subtle.importKey('raw',secret,{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const signature=Uint8Array.from(raw.match(/../g),x=>parseInt(x,16));
  if(!await crypto.subtle.verify('HMAC',key,signature,bytes.encode(text)))return null;
  try{
    const user=JSON.parse(params.get('user'));
    if(!Number.isSafeInteger(user.id)||user.id<=0||user.id>=2**52||user.is_bot)return null;
    return user;
  }catch{return null;}
}
