import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, posix, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import { createPdfService } from './pdf.mjs';
import { relayApi } from './relay.mjs';

const origin = new URL(process.env.SWIM_PUBLIC_ORIGIN ?? '');
assert.equal(origin.href, origin.origin + '/', 'Set SWIM_PUBLIC_ORIGIN to a site origin');
assert(origin.protocol === 'https:' || (origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)),
  'Use HTTPS for a public origin');
process.env.SWIM_PUBLIC_ORIGIN = origin.origin;
async function transport() {
  if (process.env.SWIM_UPSTREAM_ORIGIN) return relayApi(process.env.SWIM_UPSTREAM_ORIGIN, origin);
  assert(process.env.SWIM_DB, 'Set SWIM_DB to the existing SQLite database file');
  const { openDatabase } = await import('./database.mjs');
  const { default: worker } = await import('./worker.mjs');
  const env = { ...process.env, CHAT_DB: openDatabase(process.env.SWIM_DB) };
  const ctx = { waitUntil: task => task.catch(error => console.error('Background job:',error.name)) };
  return request => worker.fetch(request, env, ctx);
}
const api = await transport();
const pdfApi = createPdfService({ origin: origin.origin, api });
const root = fileURLToPath(new URL('./public/', import.meta.url));
const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
};
const security = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};
const portalCsp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
const libraryCsp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src https://kinescope.io https://*.kinescope.io https://kinescope.ru https://*.kinescope.ru https://www.youtube.com https://www.youtube-nocookie.com; frame-ancestors 'self'; base-uri 'none'; object-src 'none'";

function httpResponse(response, status, headers = {}) {
  response.writeHead(status, { ...security, ...headers }).end();
}

function pathFor(url) {
  const decoded = decodeURIComponent(url.pathname);
  assert(!decoded.includes('\\') && !decoded.includes('\0'), 'invalid path');
  const path = posix.normalize(decoded);
  if (/^\/(?:client|partner)\/register$/.test(path)) return path + '/index.html';
  return path.endsWith('/') ? path + 'index.html' : path;
}

function rangeFor(request, size) {
  const range = request.headers.range;
  if (!range || request.method === 'HEAD') return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2]) || size === 0) return false;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  return Number.isSafeInteger(start) && start >= 0 && start <= end ? { start, end } : false;
}

async function sendFile(request, response, path, library) {
  const type = mime[extname(path)];
  if (!type) return httpResponse(response, 404);
  const diskPath = resolve(root, '.' + path);
  const info = await stat(diskPath).catch(() => null);
  if (!info?.isFile()) return httpResponse(response, 404);
  const range = rangeFor(request, info.size);
  if (range === false) return httpResponse(response, 416, { 'Content-Range': 'bytes */' + info.size });
  const headers = {
    ...security,
    'Content-Type': type,
    'Content-Length': range ? range.end - range.start + 1 : info.size,
    'Content-Security-Policy': library ? libraryCsp : portalCsp,
    'Referrer-Policy': library ? 'strict-origin-when-cross-origin' : security['Referrer-Policy'],
    'Accept-Ranges': 'bytes',
  };
  if (range) headers['Content-Range'] = 'bytes ' + range.start + '-' + range.end + '/' + info.size;
  response.writeHead(range ? 206 : 200, headers);
  if (request.method === 'HEAD') return response.end();
  await pipeline(createReadStream(diskPath, range ?? {}), response);
}

async function route(request, response) {
  if (!request.url?.startsWith('/') || request.url.startsWith('//')) return httpResponse(response, 400);
  const url = new URL(request.url, origin);
  if (url.origin !== origin.origin) return httpResponse(response, 400);
  if (url.pathname === '/health' || url.pathname.startsWith('/v1/')) {
    const headers = Object.fromEntries(Object.entries(request.headers).filter(([key]) =>
      ['authorization', 'content-type', 'content-length', 'cookie', 'origin'].includes(key)));
    const options = { method: request.method, headers, signal: AbortSignal.timeout(30_000) };
    if (!['GET', 'HEAD'].includes(request.method)) {
      options.body = Readable.toWeb(request);
      options.duplex = 'half';
    }
    const incoming = new Request(url, options);
    const result = await pdfApi(incoming) ?? await api(incoming);
    const outgoing = Object.fromEntries(result.headers);
    const cookies = result.headers.getSetCookie();
    if (cookies.length) outgoing['set-cookie'] = cookies;
    response.writeHead(result.status, outgoing);
    if (!result.body || request.method === 'HEAD') {
      await result.body?.cancel();
      return response.end();
    }
    await pipeline(Readable.fromWeb(result.body), response);
    return;
  }
  if (!['GET', 'HEAD'].includes(request.method)) return httpResponse(response, 405, { Allow: 'GET, HEAD' });
  if (url.pathname === '/') return httpResponse(response, 302, { Location: '/client/' });
  if (['/client', '/partner', '/library'].includes(url.pathname)) {
    return httpResponse(response, 308, { Location: url.pathname + '/' });
  }

  let path;
  try {
    path = pathFor(url);
  } catch {
    return httpResponse(response, 400);
  }
  const library = path.startsWith('/library/');
  if (library) {
    const session = await api(new Request(new URL('/v1/client/session', origin), {
      headers: { Cookie: request.headers.cookie ?? '' },
    }));
    if (!session.ok || !(await session.json()).active) return httpResponse(response, 401);
  } else if (!path.startsWith('/client/') &&
      !['/partner/index.html', '/partner/register/index.html', '/robots.txt'].includes(path)) {
    return httpResponse(response, 404);
  }
  return sendFile(request, response, path, library);
}

if (!process.env.SWIM_UPSTREAM_ORIGIN) {
  const check = await api(new Request(new URL('/health', origin)));
  assert(check.ok, 'Database schema failed its health check');
}
const port = Number(process.env.PORT ?? 8080);
assert(Number.isInteger(port) && port > 0 && port <= 65535, 'PORT must be a valid port');
const host = process.env.HOST || '127.0.0.1';
const server = createServer((request, response) => {
  route(request, response).catch(error => {
    console.error('Request:', error.name);
    if (response.headersSent) response.destroy();
    else httpResponse(response, 500);
  });
});
server.listen(port, host, () => console.log('Swim Island server listening on ' + host + ':' + port));
