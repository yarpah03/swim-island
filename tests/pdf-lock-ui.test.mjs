import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source=readFileSync(new URL('../workout-print/card.js',import.meta.url),'utf8');
function fixture(telegram,allowed){
 const opened=[];
 const node=()=>({children:[],listeners:{},appendChild(child){this.children.push(child);},addEventListener(name,fn){this.listeners[name]=fn;},remove(){}});
 const button={innerHTML:'Скачать 8 тренировок · PDF',disabled:true},status={textContent:''};
 const container={...node(),isConnected:true,matches:()=>true,querySelectorAll:()=>[],querySelector(selector){
  return selector==='.workout-print-button'?button:selector==='[data-print-status]'?status:selector==='.workout-print-actions'?this.children.find(n=>n.className==='workout-print-actions'):null;
 }};
 const window={open:(...args)=>opened.push(args),...(telegram?{Telegram:{WebApp:{initData:'test-only-signed-data',openTelegramLink:url=>opened.push([url])}}}:{})};
 const document={createElement:node,addEventListener(){}};
 const app=runInNewContext(source+'; WorkoutPrint;', {window,document,location:{hostname:'localhost',origin:'http://localhost'},Headers,URL,AbortSignal,WeakMap,Date,Intl,fetch:async()=>({ok:true,json:async()=>allowed?{allowed:true,expiresAt:Date.now()+60000}:{allowed:false,reason:'trial'}})});
 return {app,container,button,status,opened};
}
for(const telegram of [false,true]){
 test('trial PDF lock offers the existing Tribute checkout in '+(telegram?'Telegram':'web'),async()=>{
  const f=fixture(telegram,false);await f.app.mount(f.container);
  assert.equal(f.button.disabled,true);assert.match(f.status.textContent,/пробном режиме/);
  const actions=f.container.children.find(n=>n.className==='workout-print-actions');
  assert(actions);assert.deepEqual(actions.children.map(n=>n.textContent),['Проверить оплату','Оформить подписку']);
  const subscribe=actions.children[1];subscribe.listeners.click();
  assert.equal(f.opened.length,1);assert.equal(f.opened[0][0],'https://t.me/tribute/app?startapp=sXk3');
  if(!telegram)assert.deepEqual(f.opened[0].slice(1),['_blank','noopener,noreferrer']);
 });
}
test('paid PDF control unlocks without renewal prompts',async()=>{
 const f=fixture(false,true);await f.app.mount(f.container);assert.equal(f.button.disabled,false);assert.equal(f.status.textContent,'');assert.equal(f.container.children.length,0);assert.equal(f.opened.length,0);
});
