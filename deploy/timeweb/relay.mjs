import { connect } from 'node:http2';
import { Readable } from 'node:stream';

export function http2Transport(origin) {
  // A session belongs to one request: an idle/half-closed Cloudflare connection
  // must never poison later authentication or entitlement checks.
  const attempt = (url, options) => new Promise((resolve, reject) => {
    const active = connect(origin, { family: 4, settings: { enablePush: false } });
    const signal = options.signal;
    let stream;
    let socket;
    let responded = false;
    let finished = false;
    let responseTimer;
    const cleanup = () => {
      clearTimeout(responseTimer);
      signal?.removeEventListener('abort', abort);
    };
    const dispose = () => {
      active.destroy();
      // After GOAWAY, Node's graceful socket.end can wait for a peer FIN.
      // This session is request-owned, so also release its actual TCP socket.
      socket?.destroy();
    };
    active.once('connect', (_session, connected) => {
      socket = connected;
      if (finished) dispose();
    });
    const fail = error => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(error);
      stream?.destroy(error);
      dispose();
    };
    const abort = () => fail(signal.reason ?? new Error('Upstream request aborted'));
    active.on('error', fail);
    active.once('close', () => {
      if (!responded) fail(new Error('Upstream session closed before response'));
    });
    active.once('goaway', () => {
      if (!responded) fail(new Error('Upstream session received GOAWAY before response'));
    });
    active.setTimeout(45000, () => fail(new Error('Upstream session timed out')));

    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    // Leave room within the relay's overall 9s deadline for one fresh GET.
    if (options.method === 'GET') {
      responseTimer = setTimeout(() => fail(new Error('Upstream response timed out')), 4000);
      responseTimer.unref();
    }
    try {
      const headers = {
        ':method': options.method,
        ':path': url.pathname + url.search,
        ...Object.fromEntries(options.headers),
        'accept-encoding': 'identity',
      };
      stream = active.request(headers, { endStream: !options.body });
      stream.once('error', fail);
      stream.once('close', () => {
        if (!responded) fail(new Error('Upstream stream closed before response'));
        finished = true;
        cleanup();
        dispose();
      });
      stream.once('response', fields => {
        try {
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
          const result = new Response(body, { status, headers: responseHeaders });
          responded = true;
          clearTimeout(responseTimer);
          resolve(result);
        } catch (error) {
          fail(error);
        }
      });
      if (options.body) {
        const body = Readable.fromWeb(options.body);
        body.on('error', error => stream.destroy(error));
        stream.on('close', () => body.destroy());
        body.pipe(stream);
      }
    } catch (error) {
      fail(error);
    }
  });
  return async (url, options) => {
    try {
      return await attempt(url, options);
    } catch (error) {
      // Never replay a login, payment or other POST. No retry after headers,
      // caller cancellation or the overall request deadline.
      if (options.method !== 'GET' || options.body || options.signal?.aborted) throw error;
      return attempt(url, options);
    }
  };
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
    const telegramPdf = pathname === '/v1/chats/pdf-access';
    if (!health && !telegramPdf && !/^\/v1\/(?:client|partner)\//.test(pathname)) {
      return jsonError('not_found', 404);
    }
    const method = health && request.method === 'HEAD' ? 'GET' : request.method;
    if (!['GET', 'POST'].includes(method) || ((health || telegramPdf) && method !== 'GET')) {
      return jsonError('method_not_allowed', 405);
    }

    const suppliedOrigin = request.headers.get('origin');
    if ((suppliedOrigin && suppliedOrigin !== origin.origin && !(telegramPdf && suppliedOrigin === 'https://yarpah03.github.io')) ||
        (method === 'POST' && suppliedOrigin !== origin.origin)) {
      return jsonError('forbidden_origin', 403);
    }

    const headers = new Headers();
    const cookies = (request.headers.get('cookie') ?? '').split(';')
      .map(value => value.trim()).filter(value => browserCookie.test(value));
    if (telegramPdf) {
      const authorization = request.headers.get('Authorization') ?? '';
      if (!authorization.startsWith('tma ') || authorization.length > 8192) return jsonError('telegram_auth_required', 401);
      headers.set('Authorization', authorization);
      headers.set('Origin', 'https://yarpah03.github.io');
    } else {
      if (cookies.length) headers.set('cookie', cookies.join('; '));
      if (suppliedOrigin) headers.set('origin', upstream.origin);
    }
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
