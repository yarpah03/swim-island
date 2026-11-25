import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, constants } from 'node:http2';
import { setTimeout as delay } from 'node:timers/promises';
import { http2Transport } from '../deploy/timeweb/relay.mjs';

async function until(predicate, message) {
  const deadline = Date.now() + 1500;
  while (!predicate() && Date.now() < deadline) await delay(10);
  assert(predicate(), message);
}
async function fixture(handle) {
  const sessions = new Set();
  const state = { opened: 0, closed: 0, requests: 0, received: [] };
  const server = createServer();
  server.on('session', session => {
    sessions.add(session); state.opened++; session.fixtureId=state.opened;
    session.on('error', () => {});
    session.once('close', () => { sessions.delete(session); state.closed++; });
  });
  server.on('stream', (stream, headers) => {
    state.requests++; state.received.push(headers);
    stream.on('error', () => {});
    handle(stream, headers, state);
  });
  server.on('sessionError', () => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const transport = http2Transport(origin);
  const request = (method = 'GET', path = '/health', extra = {}) => transport(new URL(path, origin), {
    method, headers: new Headers({ Cookie: 'fixture-cookie', ...extra.headers }),
    signal: extra.signal ?? AbortSignal.timeout(2000),
    ...(extra.body ? { body: extra.body } : {}),
  });
  return { state, sessions, request,
    clientSockets: () => process._getActiveHandles().filter(handle => handle.remotePort === server.address()?.port && !handle.destroyed),
    async idle() { try { await until(() => sessions.size === 0, 'Completed request left an HTTP/2 session open'); } catch(error) { console.error('HTTP2 fixture pending sessions', JSON.stringify({state, open:Array.from(sessions,x=>({id:x.fixtureId,closed:x.closed,destroyed:x.destroyed,socketDestroyed:x.socket?.destroyed,socketReadable:x.socket?.readable,socketWritable:x.socket?.writable,state:x.state}))})); throw error; } },
    async close() {
      for (const session of sessions) session.destroy();
      await new Promise(resolve => server.close(resolve));
    } };
}
function body(text) {
  return new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } });
}

test('GET relays the body, query and separate Set-Cookie headers, then closes its session', async t => {
  const f = await fixture((stream, headers) => {
    stream.respond({ ':status': 200, 'content-type': 'application/json',
      'set-cookie': ['fixture-a=one; Secure', 'fixture-b=two; Secure'] });
    stream.end(JSON.stringify({ path: headers[':path'], cookie: headers.cookie }));
  });
  t.after(() => f.close());
  const response = await f.request('GET', '/health?fixture=1');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { path: '/health?fixture=1', cookie: 'fixture-cookie' });
  assert.deepEqual(response.headers.getSetCookie(), ['fixture-a=one; Secure', 'fixture-b=two; Secure']);
  await f.idle();
  assert.equal(f.state.opened, 1);
});

test('successive and concurrent requests use independent sessions and clean each one up', async t => {
  const f = await fixture((stream, headers) => { stream.respond({ ':status': 200 }); stream.end(headers[':path']); });
  t.after(() => f.close());
  assert.equal(await (await f.request('GET', '/first')).text(), '/first');
  await f.idle();
  const responses = await Promise.all(['/second', '/third', '/fourth'].map(path => f.request('GET', path)));
  assert.deepEqual(await Promise.all(responses.map(response => response.text())), ['/second', '/third', '/fourth']);
  await f.idle();
  assert.equal(f.state.requests, 4);
  assert.equal(f.state.opened, 4);
  assert.equal(f.state.closed, 4);
});

test('GET retries once when its first session closes before response headers', async t => {
  const f = await fixture((stream, _headers, state) => {
    if (state.requests === 1) return stream.session.destroy();
    stream.respond({ ':status': 200 }); stream.end('retried once');
  });
  t.after(() => f.close());
  assert.equal(await (await f.request()).text(), 'retried once');
  await f.idle();
  assert.equal(f.state.requests, 2);
  assert.equal(f.state.opened, 2);
});

test('GET failure is bounded to one retry even if both sessions fail before headers', async t => {
  const f = await fixture(stream => stream.session.destroy());
  t.after(() => f.close());
  await assert.rejects(f.request());
  await f.idle();
  assert.equal(f.state.requests, 2);
  assert.equal(f.state.opened, 2);
});

test('POST is never retried after an upstream failure, including after request body receipt', async t => {
  const f = await fixture(stream => {
    let received = '';
    stream.on('data', chunk => { received += chunk; });
    stream.once('end', () => {
      assert.equal(received, 'one payment-like mutation');
      stream.session.destroy();
    });
  });
  t.after(() => f.close());
  await assert.rejects(f.request('POST', '/v1/client/fixture', { body: body('one payment-like mutation') }));
  await f.idle();
  assert.equal(f.state.requests, 1);
  assert.equal(f.state.opened, 1);
});

test('caller abort before headers cancels the request and destroys its session without retry', async t => {
  const f = await fixture(() => {});
  t.after(() => f.close());
  const controller = new AbortController();
  const pending = f.request('GET', '/waiting', { signal: controller.signal });
  const rejected = assert.rejects(pending, error => error.name === 'AbortError');
  await until(() => f.state.requests === 1, 'Server never received abort fixture');
  controller.abort(new DOMException('fixture abort', 'AbortError'));
  await rejected;
  await f.idle();
  assert.equal(f.state.opened, 1);
  assert.equal(f.state.requests, 1);
});

test('caller abort after headers rejects the body read and destroys the session', async t => {
  const f = await fixture(stream => { stream.respond({ ':status': 200 }); stream.write('partial'); });
  t.after(() => f.close());
  const controller = new AbortController();
  const response = await f.request('GET', '/slow-body', { signal: controller.signal });
  const reading = assert.rejects(response.text());
  controller.abort(new DOMException('fixture abort', 'AbortError'));
  await reading;
  await f.idle();
  assert.equal(f.state.requests, 1, 'Responses with headers must not be retried');
});

test('cancelling a response body also cleans its session and does not retry', async t => {
  const f = await fixture(stream => { stream.respond({ ':status': 200 }); stream.write('partial'); });
  t.after(() => f.close());
  const response = await f.request('GET', '/cancel-body');
  await response.body.cancel();
  await f.idle();
  assert.equal(f.state.requests, 1);
});

test('GOAWAY before headers is handled as a bounded GET failure and can recover on a fresh session', async t => {
  const f = await fixture((stream, _headers, state) => {
    if (state.requests === 1) {
      stream.session.goaway(constants.NGHTTP2_NO_ERROR, 0);
      stream.close(constants.NGHTTP2_REFUSED_STREAM);
      return;
    }
    stream.respond({ ':status': 200 }); stream.end('recovered after goaway');
  });
  t.after(() => f.close());
  assert.equal(await (await f.request()).text(), 'recovered after goaway');
  // Node's synthetic cleartext server can retain its own half-closed session
  // after issuing GOAWAY+REFUSED_STREAM. Check the transport's actual TCP
  // handles instead: no live client socket may still target this server port.
  await until(() => f.clientSockets().length === 0, 'GOAWAY left a live client TCP socket');
  assert.equal(f.state.requests, 2);
  assert.equal(f.state.opened, 2);
});

test('an upstream body error after headers rejects the reader, closes the session and never retries GET', async t => {
  const f = await fixture(stream => {
    stream.respond({ ':status': 200 }); stream.write('partial');
    setTimeout(() => stream.destroy(new Error('fixture body failed')), 30);
  });
  t.after(() => f.close());
  const response = await f.request('GET', '/body-error');
  assert.equal(response.status, 200);
  await assert.rejects(response.text());
  await f.idle();
  assert.equal(f.state.requests, 1);
  assert.equal(f.state.opened, 1);
});

test('empty 204 responses release their stream and session without waiting for a body consumer', async t => {
  const f = await fixture(stream => { stream.respond({ ':status': 204 }); stream.end(); });
  t.after(() => f.close());
  const response = await f.request();
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  await f.idle();
  assert.equal(f.state.opened, 1);
});
