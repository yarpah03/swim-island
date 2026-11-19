import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert(process.argv[2], 'Usage: node chats/build-pages.mjs <output-directory>');
const output = resolve(process.argv[2]);
const source = path => fileURLToPath(new URL(path, import.meta.url));
const game = readFileSync(source('../game/worker.mjs'), 'utf8');
const authEnd = game.indexOf('async function readResult(');
const script = readFileSync(source('worker.mjs'), 'utf8');
const importLine = "import { authenticate } from '../game/worker.mjs';";
assert(authEnd > 0 && game.slice(0, authEnd).includes('async function authenticate(') && script.startsWith(importLine));

mkdirSync(resolve(output, 'client'), { recursive: true });
mkdirSync(resolve(output, 'partner'), { recursive: true });
mkdirSync(resolve(output, 'vip'), { recursive: true });
for(const file of ['index.html','portal.js','portal.css']) copyFileSync(source('vip/'+file),resolve(output,'vip',file));
const vipChat = readFileSync(source('chat.js'),'utf8')
  .replace("web ? 'Ведение по ' + date.format(room.expires - 1) : roomDetails(room)",'roomDetails(room)')
  .replace("const subscriber = !web && !staff && data.vip === 'active';","const subscriber = (!web || launch.fullWeb === true) && !staff && data.vip === 'active';")
  .replace("web ? 'Введите имя тренера' : 'Имя или название группы'","'Имя или название чата'");
writeFileSync(resolve(output,'vip/chat.js'),vipChat);
const auth = 'const authenticate = (() => {\n' + game.slice(0, authEnd) + 'return authenticate;\n})();\n';
const paidImport = "import { pdfEntitlement, tributeConfiguration } from './paid-access.mjs';";
assert(script.includes(paidImport));
const paid = readFileSync(source('paid-access.mjs'), 'utf8').replace(/^export /gm, '');
const tributeImport = "import { tributeWeb } from './tribute-web.mjs';";
const tribute = readFileSync(source('tribute-web.mjs'),'utf8').replace("import { createTributeChecker } from './paid-access.mjs';", '').replace(/^export /gm,'');
assert(script.includes(tributeImport));
writeFileSync(resolve(output, '_worker.js'), auth + paid + tribute + script.slice(importLine.length).replace(paidImport, '').replace(tributeImport, ''));
writeFileSync(resolve(output, '_routes.json'), JSON.stringify({
  version: 1, include: ['/health', '/v1/internal/tribute-web', '/v1/chats', '/v1/chats/*', '/v1/client/*', '/v1/partner/*'], exclude: [],
}));
writeFileSync(resolve(output, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
const securityHeaders = `  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src https://yarpah03.github.io/swim-island/; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Robots-Tag: noindex, nofollow
`;
writeFileSync(resolve(output, '_headers'), '/client/*\n' + securityHeaders + '/partner/*\n' + securityHeaders);
const client = readFileSync(source('client/index.html'), 'utf8');
const partner = client
  .replace('  <link rel="manifest" href="/client/manifest.webmanifest">\n', '')
  .replaceAll('Кабинет ученика', 'Кабинет тренера');
writeFileSync(resolve(output, 'partner/index.html'), partner);
for (const [role, label, page] of [['client', 'ученика', client], ['partner', 'тренера', partner]]) {
  const registration = resolve(output, role, 'register');
  mkdirSync(registration, { recursive: true });
  writeFileSync(resolve(registration, 'index.html'), page
    .replaceAll('Кабинет ' + label, 'Регистрация ' + label)
    .replace('Проверяем вход…', 'Проверяем приглашение…'));
}
for (const [from, to] of [
  ['client/index.html', 'index.html'], ['client/client.js', 'client.js'], ['client/client.css', 'client.css'],
  ['chat.js', 'chat.js'], ['chat.css', 'chat.css'], ['partners.js', 'partners.js'],
  ['../vip-icon-192.png', 'vip-icon.png'], ['../vip-icon-512.png', 'vip-icon-512.png'],
  ['client/manifest.webmanifest', 'manifest.webmanifest'],
]) {
  copyFileSync(source(from), resolve(output, 'client', to));
}
