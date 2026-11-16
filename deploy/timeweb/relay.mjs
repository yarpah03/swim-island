const defaultUpstream = 'https://swim-island-chats.pages.dev';
const browserCookie = /^__Host-swim-(?:client|partner)=[a-f0-9]{64}$/;

function jsonError(error, status) {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function relayApi(source, origin, fetchImpl = fetch) {
  const upstream = new URL(source);
  const local = origin.protocol === 'http:' && upstream.hostname === '127.0.0.1' &&
    upstream.protocol === 'http:';
  if ((!local && upstream.origin !== defaultUpstream) || upstream.href !== upstream.origin + '/') {
    throw new Error('Use the configured Cloudflare chat service as the upstream origin');
  }

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
      const result = await fetchImpl(new URL(pathname + search, upstream), options);
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
