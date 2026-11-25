import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BREASTSTROKE_PROGRAM } from './programs.mjs';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [checkout, output, privatePdf = process.env.SWIM_BREASTSTROKE_PROGRAM_PDF] = process.argv.slice(2);
assert(checkout && output && privatePdf, 'Usage: node build.mjs <GitHub checkout> <new output directory> <private approved PDF outside checkout>');
const privateSource = resolve(privatePdf);
const checkoutRoot = resolve(checkout);
assert(privateSource !== checkoutRoot && !privateSource.startsWith(checkoutRoot + '/'), 'Keep paid PDF outside the public GitHub checkout');
const approvedProgramBytes = readFileSync(privateSource);
assert.equal(createHash('sha256').update(approvedProgramBytes).digest('hex'), BREASTSTROKE_PROGRAM.sha256, 'Use the approved eight-workout PDF');
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
  copyAssets(join(source, folder), join(library, folder), name => assets.has(extname(name)) && (folder !== 'workout-print' || name === 'card.js'));
}
for (const file of ['server.mjs', 'database.mjs', 'relay.mjs', 'pdf.mjs', 'pdf-template.mjs', 'programs.mjs']) copyFileSync(join(here, file), join(bundle, file));
copyFileSync(join(source, 'chats/schema.sql'), join(bundle, 'schema.sql'));
mkdirSync(join(bundle, 'pdf'));
for (const file of ['LiberationSans-Regular.ttf', 'LiberationSans-Bold.ttf', 'JSPDF-LICENSE.txt', 'LIBERATION-LICENSE.txt']) {
  copyFileSync(join(source, 'workout-print', file), join(bundle, 'pdf', file));
}
copyFileSync(join(source, 'workout-print/jspdf-4.2.1.min.js'), join(bundle, 'pdf/jspdf.cjs'));
mkdirSync(dirname(join(bundle, BREASTSTROKE_PROGRAM.path)), { recursive: true });
writeFileSync(join(bundle, BREASTSTROKE_PROGRAM.path), approvedProgramBytes, { mode: 0o640 });


const catalog = join(publicRoot, 'client/client.js');
replaceFile(catalog, "  const catalog = new URL('https://yarpah03.github.io/swim-island/');",
  "  const catalog = new URL('/library/', location.origin);\n  const materialOrigin = 'https://yarpah03.github.io/swim-island/';");
replaceFile(catalog, "    const prefix = catalog.href + '#';", "    const prefix = materialOrigin + '#';");

const index = join(library, 'index.html');
replaceFile(index, '<script src="https://telegram.org/js/telegram-web-app.js"></script>\n', '');
replaceFile(index, 'const materialBase = new URL("./", location.href).href;',
  'const materialBase = "https://yarpah03.github.io/swim-island/";');
replaceFile(index, 'window.parent.postMessage(message, "https://swim-island-chats.pages.dev");',
  'window.parent.postMessage(message, location.origin);');
replaceFile(index, 'href="https://swim-island-chats.pages.dev/partner/"', 'href="/partner/"');
console.log(bundle);
