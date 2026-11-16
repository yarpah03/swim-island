import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [checkout, output] = process.argv.slice(2);
assert(checkout && output, 'Usage: node build.mjs <GitHub checkout> <new output directory>');
const source = resolve(checkout);
const bundle = resolve(output);
const here = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(bundle, 'public');
const library = join(publicRoot, 'library');
function replaceFile(path, oldCode, newCode) {
  const text = readFileSync(path, 'utf8');
  assert.equal(text.split(oldCode).length, 2, 'Review upstream change in ' + path);
  writeFileSync(path, text.replace(oldCode, newCode));
}

mkdirSync(bundle);
execFileSync(process.execPath, [join(source, 'chats/build-pages.mjs'), publicRoot], { stdio: 'inherit' });
const worker = join(bundle, 'worker.mjs');
renameSync(join(publicRoot, '_worker.js'), worker);
for (const file of ['_headers', '_routes.json']) rmSync(join(publicRoot, file));
replaceFile(worker, "const WEB_ORIGIN = 'https://swim-island-chats.pages.dev';",
  "const WEB_ORIGIN = process.env.SWIM_PUBLIC_ORIGIN;");

const assets = new Set(['.css', '.html', '.jpg', '.js', '.pdf', '.png', '.svg', '.ttf', '.txt', '.webmanifest', '.webp']);
function copyAssets(from, to, include) {
  mkdirSync(to, { recursive: true });
  for (const file of readdirSync(from, { withFileTypes: true })) {
    if (file.isFile() && include(file.name)) copyFileSync(join(from, file.name), join(to, file.name));
  }
}
copyAssets(source, library, name => assets.has(extname(name)) &&
  (!name.endsWith('.html') || name === 'index.html') && !name.endsWith('.txt'));
for (const folder of ['chats', 'game', 'workout-print']) {
  copyAssets(join(source, folder), join(library, folder), name => assets.has(extname(name)));
}
for (const file of ['server.mjs', 'database.mjs', 'relay.mjs']) copyFileSync(join(here, file), join(bundle, file));
copyFileSync(join(source, 'chats/schema.sql'), join(bundle, 'schema.sql'));

const catalog = join(publicRoot, 'client/client.js');
replaceFile(catalog, "  const catalog = new URL('https://yarpah03.github.io/swim-island/');",
  "  const catalog = new URL('/library/', location.origin);\n  const materialOrigin = 'https://yarpah03.github.io/swim-island/';");
replaceFile(catalog, "    const prefix = catalog.href + '#';", "    const prefix = materialOrigin + '#';");

const index = join(library, 'index.html');
replaceFile(index, '<script src="https://telegram.org/js/telegram-web-app.js"></script>\n', '');
replaceFile(index, 'const materialBase = new URL("./", location.href).href;',
  'const materialBase = "https://yarpah03.github.io/swim-island/";');
replaceFile(index, 'window.parent.postMessage({ type:"swim-forward", material }, "https://swim-island-chats.pages.dev");',
  'window.parent.postMessage({ type:"swim-forward", material }, location.origin);');
replaceFile(index, 'href="https://swim-island-chats.pages.dev/partner/"', 'href="/partner/"');
console.log(bundle);
