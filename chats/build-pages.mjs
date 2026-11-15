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
const auth = 'const authenticate = (() => {\n' + game.slice(0, authEnd) + 'return authenticate;\n})();\n';
writeFileSync(resolve(output, '_worker.js'), auth + script.slice(importLine.length));
writeFileSync(resolve(output, '_routes.json'), JSON.stringify({
  version: 1, include: ['/health', '/v1/chats', '/v1/chats/*', '/v1/client/*', '/v1/partner/*'], exclude: [],
}));
writeFileSync(resolve(output, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
const securityHeaders = `  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Robots-Tag: noindex, nofollow
`;
writeFileSync(resolve(output, '_headers'), '/client/*\n' + securityHeaders + '/partner/*\n' + securityHeaders);
const client = readFileSync(source('client/index.html'), 'utf8');
writeFileSync(resolve(output, 'partner/index.html'), client
  .replace('  <link rel="manifest" href="/client/manifest.webmanifest">\n', '')
  .replaceAll('Кабинет ученика', 'Кабинет тренера'));
for (const [from, to] of [
  ['client/index.html', 'index.html'], ['client/client.js', 'client.js'], ['client/client.css', 'client.css'],
  ['chat.js', 'chat.js'], ['chat.css', 'chat.css'], ['partners.js', 'partners.js'],
  ['../vip-icon-192.png', 'vip-icon.png'], ['../vip-icon-512.png', 'vip-icon-512.png'],
  ['client/manifest.webmanifest', 'manifest.webmanifest'],
]) {
  copyFileSync(source(from), resolve(output, 'client', to));
}
