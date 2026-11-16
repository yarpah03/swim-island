import { connect, constants } from 'node:http2';
import { Readable } from 'node:stream';

export function http2Transport(origin) {
  let session;
  return (url, options) => new Promise((resolve, reject) => {
    if (!session || session.closed || session.destroyed) {
      session = connect(origin, { family: 4, settings: { enablePush: false } });
      const active = session;
      active.on('error', error => active.destroy(error));
      active.setTimeout(45000, () => active.close());
    }

    const headers = {
      ':method': options.method,
      ':path': url.pathname + url.search,
      ...Object.fromEntries(options.headers),
      'accept-encoding': 'identity',
    };
    const stream = session.request(headers, { endStream: !options.body });
    const abort = () => {
      stream.close(constants.NGHTTP2_CANCEL);
      reject(options.signal.reason);
    };
    stream.once('error', reject);
    stream.once('close', () => {
      options.signal.removeEventListener('abort', abort);
      reject(new Error('Upstream stream closed before response'));
    });
    stream.once('response', fields => {
      const status = fields[':status'];
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(fields)) {
        if (key.startsWith(':')) continue;
        for (const part of Array.isArray(value) ? value : [value]) {
          responseHeaders.append(key, part);
        }
      }
      const body = [204, 205, 304].includes(status) ? null : Readable.toWeb(stream);
      if (!body) stream.resume();
      resolve(new Response(body, { status, headers: responseHeaders }));
    });
    if (options.signal.aborted) {
      abort();
      return;
    }
    options.signal.addEventListener('abort', abort, { once: true });
    if (options.body) {
      const body = Readable.fromWeb(options.body);
      body.on('error', error => stream.destroy(error));
      stream.on('close', () => body.destroy());
      body.pipe(stream);
    }
  });
}

const defaultUpstream = 'https://swim-island-chats.pages.dev';
const browserCookie = /^__Host-swim-(?:client|partner)=[a-f0-9]{64}$/;

function jsonError(error, status) {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function relayApi(source, origin) {
  const upstream = new URL(source);
  const local = origin.protocol === 'http:' && upstream.hostname === '127.0.0.1' &&
    upstream.protocol === 'http:';
  if ((!local && upstream.origin !== defaultUpstream) || upstream.href !== upstream.origin + '/') {
    throw new Error('Use the configured Cloudflare chat service as the upstream origin');
  }

  const fetchUpstream = local ? fetch : http2Transport(upstream.origin);
  return async request => {
    const { pathname, search } = new URL(request.url);
    const health = pathname === '/health';
    if (!health && !/^\/v1\/(?:client|partner)\//.test(pathname)) {
      return jsonError('not_found', 404);
    }
    const method = health && request.method === 'HEAD' ? 'GET' : request.method;
    if (!['GET', 'POST'].includes(method) || (health && method !== 'GET')) {
      return jsonError('method_not_allowed', 405);
    }

    const suppliedOrigin = request.headers.get('origin');
    if ((suppliedOrigin && suppliedOrigin !== origin.origin) ||
        (method === 'POST' && suppliedOrigin !== origin.origin)) {
      return jsonError('forbidden_origin', 403);
    }

    const headers = new Headers();
    const cookies = (request.headers.get('cookie') ?? '').split(';')
      .map(value => value.trim()).filter(value => browserCookie.test(value));
    if (cookies.length) headers.set('cookie', cookies.join('; '));
    if (suppliedOrigin) headers.set('origin', upstream.origin);
    for (const field of ['content-type', 'content-length']) {
      const value = request.headers.get(field);
      if (method === 'POST' && value !== null) headers.set(field, value);
    }
    const options = {
      method, headers, redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(method === 'POST' ? 25000 : 9000)]),
    };
    if (method === 'POST') {
      options.body = request.body;
      options.duplex = 'half';
    }

    try {
      const result = await fetchUpstream(new URL(pathname + search, upstream), options);
      if (result.status >= 300 && result.status < 400) {
        await result.body?.cancel();
        return jsonError('unavailable', 503);
      }
      const output = new Headers({
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      });
      const type = result.headers.get('content-type');
      if (type) output.set('content-type', type);
      for (const cookie of result.headers.getSetCookie()) {
        if (/^__Host-swim-(?:client|partner)=/.test(cookie)) output.append('Set-Cookie', cookie);
      }
      return new Response(result.body, { status: result.status, headers: output });
    } catch {
      return jsonError('unavailable', 503);
    }
  };
}
