import { mkdir, copyFile, writeFile, readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'..');
const require=createRequire(import.meta.url);
const esbuild=require(process.env.BOT_ESBUILD || 'esbuild');
const output=resolve(process.argv[2]||resolve(root,'dist/bot'));
await mkdir(output,{recursive:true});
await esbuild.build({entryPoints:[resolve(here,'worker.mjs')],outfile:resolve(output,'_worker.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:false});
await mkdir(resolve(output,'media'),{recursive:true});
for(const [to,from] of Object.entries({'club.jpg':'hero.jpg','learning.jpg':'tile-snulya.jpg','pool.jpg':'tile-voda.jpg','live.jpg':'tile-efir.jpg','breaststroke.jpg':'tile-br.jpg'}))await copyFile(resolve(root,from),resolve(output,'media',to));
await writeFile(resolve(output,'media/logo.jpg'),Buffer.from((await readFile(resolve(here,'logo.base64'),'utf8')).trim(),'base64'));
for(const name of await readdir(resolve(here,'design'))){
  if(/\.(?:jpg|png)$/.test(name))await copyFile(resolve(here,'design',name),resolve(output,'media',name));
}
await mkdir(resolve(output,'menu'),{recursive:true});
await copyFile(resolve(here,'web/menu.html'),resolve(output,'menu/index.html'));
for(const name of ['menu.js','menu.css','telegram-web-app.js'])await copyFile(resolve(here,'web',name),resolve(output,name));
await mkdir(resolve(output,'free'),{recursive:true});
const materials=process.env.BOT_FREE_MATERIALS;
const hashes=JSON.parse(await readFile(resolve(here,'free-assets.json'),'utf8'));
for(const file of ['breaststroke-8.pdf','pool-checklist.pdf','technique-checklist.pdf']){
  if(materials)await copyFile(resolve(materials,file),resolve(output,'free',file));
  else{
    const response=await fetch('https://swim-island-entry-bot.pages.dev/free/'+file);
    if(!response.ok)throw new Error('Free material missing: '+file);
    await writeFile(resolve(output,'free',file),new Uint8Array(await response.arrayBuffer()));
  }
  const bytes=await readFile(resolve(output,'free',file));
  if(createHash('sha256').update(bytes).digest('hex')!==hashes[file])throw new Error('Free material hash mismatch: '+file);
}
await writeFile(resolve(output,'_routes.json'),JSON.stringify({version:1,include:['/telegram','/control/*','/health','/menu','/menu/*'],exclude:[]}));
await writeFile(resolve(output,'_headers'),'/free/*\n  Cache-Control: public, max-age=3600\n  X-Content-Type-Options: nosniff\n  Content-Disposition: attachment\n/media/*\n  Cache-Control: public, max-age=3600\n');
await writeFile(resolve(output,'index.html'),'<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Плавательный остров</title><body style="background:#071519;color:#e9d195;font-family:system-ui;padding:40px"><h1>Плавательный остров</h1><p>Полезные материалы и новости по плаванию.</p><a style="color:inherit" href="https://t.me/swim_island_entry_bot">Открыть бота в Telegram</a></body></html>');
console.log('Bot Pages build complete');
