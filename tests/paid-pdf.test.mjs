import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { relayApi } from '../deploy/timeweb/relay.mjs';
import { createTributeChecker, decideTribute, pdfEntitlement, tributeConfiguration } from '../chats/paid-access.mjs';
import { createPdfService, createRenderer, validateCard } from '../deploy/timeweb/pdf.mjs';
import worker from '../chats/worker.mjs';

const now = Date.now();
const id = 42;
const ids = [100];
const env = { TRIBUTE_API_KEY: 'test-only-credential', TRIBUTE_VIP_SUBSCRIPTION_IDS: '100' };
const row = {
  telegramUserId: id, subscriptionId: 100, status: 'active', period: 'monthly',
  activatedAt: new Date(now - 86400_000).toISOString(), expireAt: new Date(now + 86400_000).toISOString(),
};
const paid = extra => ({ ...row, ...extra });

test('payment, trial, expired and unrelated memberships remain distinct', () => {
  assert.equal(decideTribute([paid({})], id, ids, now).allowed, true);
  assert.equal(decideTribute([paid({ period: 'trial' })], id, ids, now).reason, 'trial');
  assert.equal(decideTribute([paid({ type: 'trial' })], id, ids, now).allowed, false);
  assert.equal(decideTribute([paid({ period: 'monthly', type: 'gift' })], id, ids, now).allowed, true);
  assert.equal(decideTribute([paid({ expireAt: new Date(now).toISOString() })], id, ids, now).allowed, false);
  assert.equal(decideTribute([paid({ activatedAt: new Date(now + 1000).toISOString() })], id, ids, now).allowed, false);
  for (const changed of [{ telegramUserId: 43 }, { subscriptionId: 101 }, { status: 'pending' },
    { period: 'unknown' }, { type: 'unknown' }, { expireAt: 'invalid' }]) {
    assert.equal(decideTribute([paid(changed)], id, ids, now).allowed, false);
  }
  for (const status of ['cancelled', 'pre_cancelled']) {
    assert.equal(decideTribute([paid({ status })], id, ids, now).allowed, true);
  }
  assert.equal(decideTribute([paid({ period: 'trial' }), paid({})], id, ids, now).allowed, true);
});

test('configuration refuses empty or malformed product IDs', () => {
  for (const value of ['', '0', '-1', '100,', '1e2', '100&other=1', '100.0']) {
    assert.equal(tributeConfiguration({ ...env, TRIBUTE_VIP_SUBSCRIPTION_IDS: value }), null);
  }
  assert.deepEqual(tributeConfiguration({ ...env, TRIBUTE_VIP_SUBSCRIPTION_IDS: '100, 100, 101' }).ids, [100, 101]);
  assert.equal(tributeConfiguration({ ...env, TRIBUTE_API_KEY: '' }), null);
});

test('API filter is checked again, cache is brief, expiry is checked on every use', async () => {
  let calls = 0;
  const ends = Date.now() + 1500;
  const check = createTributeChecker(async (url, options) => {
    calls++;
    assert.equal(url.origin, 'https://tribute.tg');
    assert.equal(url.search, '?subscriptionID=100');
    assert.equal(options.headers['Api-Key'], env.TRIBUTE_API_KEY);
    assert.equal(options.redirect, 'manual');
    return Response.json({ result: [paid({ expireAt: new Date(ends).toISOString() }), paid({ subscriptionId: 999 })] });
  });
  const [a, b] = await Promise.all([check(env, id, now), check(env, id, now)]);
  assert(a.allowed && b.allowed);
  assert.equal(calls, 1);
  assert.equal((await check(env, id, ends)).allowed, false);
  assert.equal(calls, 1);
  await check(env, id, now + 10_000);
  assert.equal(calls, 2);
});

test('known VIP links work without numeric IDs, while other creator subscriptions never grant PDF', async () => {
  const check = createTributeChecker(async url => {
    assert.equal(url.search, '');
    return Response.json({ result: [paid({ link: 'https://t.me/tribute/app?startapp=sOther' }),
      paid({ telegramUserId: 43, link: 'https://t.me/tribute/app?startapp=sXk3' })] });
  });
  const config = { TRIBUTE_API_KEY: env.TRIBUTE_API_KEY };
  assert.equal((await check(config, id, now)).allowed, false);
  assert.equal((await check(config, 43, now)).allowed, true);
});

test('provider errors and missing settings fail closed without leaking credentials', async () => {
  for (const mock of [
    () => new Response('', { status: 503 }),
    () => new Response('', { status: 302, headers: { Location: 'https://example.invalid' } }),
    () => Response.json({ result: {} }),
    () => { throw new Error('provider test failure'); },
    () => new Response('x'.repeat(2 * 1024 * 1024 + 1)),
  ]) {
    const result = await createTributeChecker(mock)(env, id, now);
    assert.deepEqual(result, { allowed: false, reason: 'unavailable' });
    assert(!JSON.stringify(result).includes(env.TRIBUTE_API_KEY));
  }
  const result = await createTributeChecker(() => { assert.fail('must not call provider'); })({}, id, now);
  assert.equal(result.allowed, false);
});

function databaseFixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../chats/schema.sql', import.meta.url), 'utf8'));
  const prepare = sql => {
    const statement = sqlite.prepare(sql);
    const bind = (...params) => ({
      first: async () => statement.get(...params) ?? null,
      all: async () => ({ results: statement.all(...params) }),
      run: async () => ({ meta: { changes: statement.run(...params).changes } }),
      exec: () => statement.columns().length ? { results: statement.all(...params) } : { meta: { changes: statement.run(...params).changes } },
      bind,
    });
    return bind();
  };
  const db = { prepare, batch: async statements => {
    sqlite.exec('BEGIN');
    try { const result = statements.map(s => s.exec()); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  const coach = 1;
  const guest = -5;
  const room = 'lesson-12345678-1234-1234-1234-123456789abc';
  sqlite.prepare("INSERT INTO chat_profiles VALUES (?, ?, ?, 'n')").run(coach, '111111111111', 'Coach');
  sqlite.prepare("INSERT INTO chat_profiles VALUES (?, ?, ?, 'n')").run(guest, '222222222222', 'Guest');
  sqlite.prepare('INSERT INTO chat_coaches VALUES (?, ?, ?)').run(coach, 'coach', 'Coach');
  sqlite.prepare('INSERT INTO chat_coaching VALUES (?, ?, ?, ?)').run(room, guest, coach, now + 86400_000);
  const token = 'f'.repeat(64);
  const hash = createHash('sha256').update(token).digest('hex');
  sqlite.prepare("INSERT INTO chat_web_accounts (id, role, owner_id, room_id, label, invite_hash) VALUES (?, 'client', ?, ?, ?, ?)")
    .run(room, coach, room, 'Guest', '0'.repeat(64));
  sqlite.prepare('INSERT INTO chat_web_account_sessions VALUES (?, ?, ?)').run(hash, room, now + 86400_000);
  return { db, sqlite, guest, room, coach, token };
}

test('a web invitation alone does not grant PDF; explicit payment and expiry are enforced', async () => {
  const { db, sqlite, guest, room, coach } = databaseFixture();
  try {
    assert.equal((await pdfEntitlement({ CHAT_DB: db }, { id: guest, room }, now)).allowed, false);
    sqlite.prepare('INSERT INTO chat_pdf_access VALUES (?, ?, ?, ?)').run(room, now + 5000, coach, now);
    assert.equal((await pdfEntitlement({ CHAT_DB: db }, { id: guest, room }, now)).allowed, true);
    assert.equal((await pdfEntitlement({ CHAT_DB: db }, { id: guest, room: 'other' }, now)).allowed, false);
    assert.equal((await pdfEntitlement({ CHAT_DB: db }, { id: guest, room }, now + 5000)).allowed, false);
    sqlite.prepare('UPDATE chat_pdf_access SET paid_until_ms = ?').run(now + 86400_000);
    sqlite.prepare('UPDATE chat_coaching SET expires_ms = ?').run(now + 1000);
    assert.equal((await pdfEntitlement({ CHAT_DB: db }, { id: guest, room }, now + 1000)).allowed, false);
    assert.equal((await pdfEntitlement({ CHAT_DB: db }, { id: coach }, now)).reason, 'staff');
  } finally { sqlite.close(); }
});

test('real worker rejects unauthenticated PDF checks and honours a web paid marker', async () => {
  const { db, sqlite, token, room, coach } = databaseFixture();
  const ctx = { waitUntil() {} };
  const origin = 'https://swim-island-chats.pages.dev';
  try {
    assert.equal((await worker.fetch(new Request(origin + '/v1/client/pdf-access'), { CHAT_DB: db }, ctx)).status, 401);
    assert.equal((await worker.fetch(new Request(origin + '/v1/chats/pdf-access', {
      headers: { Authorization: 'tma user=%7B%22id%22%3A1%7D' },
    }), { CHAT_DB: db }, ctx)).status, 401);
    const request = () => new Request(origin + '/v1/client/pdf-access', {
      headers: { Cookie: '__Host-swim-client=' + token },
    });
    assert.equal((await (await worker.fetch(request(), { CHAT_DB: db }, ctx)).json()).allowed, false);
    sqlite.prepare('INSERT INTO chat_pdf_access VALUES (?, ?, ?, ?)').run(room, now + 5000, coach, now);
    assert.equal((await (await worker.fetch(request(), { CHAT_DB: db }, ctx)).json()).allowed, true);
  } finally { sqlite.close(); }
});

test('only the owning coach can confirm a web payment, and confirmation never exceeds access expiry', async () => {
  const { db, sqlite, room, coach, guest } = databaseFixture();
  sqlite.prepare("INSERT INTO chat_profiles VALUES (2, '333333333333', 'Other coach', 'n')").run();
  sqlite.prepare("INSERT INTO chat_coaches VALUES (2, 'othercoach', 'Other coach')").run();
  // Substitute only Telegram signature verification in this isolated module fixture.
  // The real verifier is covered above by rejection of fabricated initData.
  const source = readFileSync(new URL('../chats/worker.mjs', import.meta.url), 'utf8')
    .replace("import { authenticate } from '../game/worker.mjs';",
      "const authenticate = async request => ({ id: Number(request.headers.get('x-test-user')) });")
    .replace("from './paid-access.mjs'", "from " + JSON.stringify(new URL('../chats/paid-access.mjs', import.meta.url).href))
    .replace("from './tribute-web.mjs'", "from " + JSON.stringify(new URL('../chats/tribute-web.mjs', import.meta.url).href));
  const { default: fixture } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const ctx = { waitUntil() {} };
  const send = (user, data) => fixture.fetch(new Request('https://swim-island-chats.pages.dev/v1/chats/clients', {
    method: 'POST', headers: { Origin: 'https://yarpah03.github.io', 'Content-Type': 'application/json', 'x-test-user': String(user) },
    body: JSON.stringify(data),
  }), { CHAT_DB: db }, ctx);
  try {
    const grant = { action: 'pdfAccess', id: room, paid: true, paidUntil: now + 5000 };
    assert.equal((await send(2, grant)).status, 403);
    assert.equal((await send(guest, grant)).status, 403);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM chat_pdf_access').get().n, 0);
    assert.equal((await send(coach, { ...grant, paidUntil: now + 2 * 86400_000 })).status, 400);
    assert.equal((await send(coach, grant)).status, 200);
    assert.equal((await pdfEntitlement({ CHAT_DB: db }, { id: guest, room }, now)).allowed, true);
    assert.equal((await send(coach, { ...grant, paid: false })).status, 200);
    assert.equal((await pdfEntitlement({ CHAT_DB: db }, { id: guest, room }, now)).allowed, false);
    const listing = await fixture.fetch(new Request('https://swim-island-chats.pages.dev/v1/chats/clients', {
      headers: { 'x-test-user': String(coach) },
    }), { CHAT_DB: db }, ctx);
    assert.equal(listing.status, 200);
    assert.equal((await listing.json()).clients[0].pdfPaidUntil, 0);
    for (const pdfPaid of [false, true]) {
      const created = await send(coach, { action: 'invite', label: 'Test invite', expires: now + 86400_000, pdfPaid });
      assert.equal(created.status, 200);
      const account = await created.json();
      const payment = sqlite.prepare('SELECT * FROM chat_pdf_access WHERE room_id = ?').get(account.id);
      assert.equal(Boolean(payment), pdfPaid);
    }
  } finally { sqlite.close(); }
});

const card = {
  title: 'Тренировка 1', context: 'Выносливость · Ноги и инвентарь', volume: '4 800 м',
  sections: [{ items: [
    { text: '600 м разминка: 200 м кроль в трубке + 200 м спина + 200 м упражнение на спину', task: true },
    { text: '10 × 100 м ноги дельфин на спине в ластах, i40, p: 22–24', task: true },
    { text: '16 × 50 м на руках с колобашкой в маленьких лопатках, i30', task: true },
    { text: '10 × 200 м кроль / комплекс по 200 м, i35, p: 24', task: true },
    { text: '400 м откупка: 200 м кроль + 200 м на спине', task: true },
  ] }], notes: ['i — отдых в секундах.'],
};

test('protected endpoint checks payment before generation; download tokens expire and recheck access', async () => {
  let time = now;
  let allowed = true;
  let trial = false;
  let generated = 0;
  const origin = 'https://vip.swimisland.ru';
  const service = createPdfService({ origin, now: () => time,
    api: async request => {
      const auth = request.headers.get('Authorization');
      assert.equal(new URL(request.url).pathname, auth ? '/v1/chats/pdf-access' : '/v1/client/pdf-access');
      if (!auth && !request.headers.get('Cookie')) return Response.json({ error: 'auth_required' }, { status: 401 });
      return Response.json(allowed ? { allowed: true, expiresAt: time + 60_000 } : { allowed: false, reason: trial ? 'trial' : 'unpaid' });
    },
    render: () => { generated++; return Buffer.from('%PDF-1.7 test'); },
  });
  const request = (body = card, headers = {}) => new Request(origin + '/v1/pdf', {
    method: 'POST', headers: { Origin: 'https://yarpah03.github.io', Authorization: 'tma signed-test',
      'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const result = await service(request());
  assert.equal(result.status, 200);
  const url = result.headers.get('X-Swim-PDF-Url');
  assert.match(url, /^https:\/\/vip.swimisland.ru\/v1\/pdf\/download\/[a-f0-9]{64}$/);
  assert.equal((await service(new Request(url))).status, 200);
  allowed = false; trial = true;
  assert.equal((await service(request())).status, 403);
  assert.equal(generated, 1);
  assert.equal((await service(new Request(url))).status, 403);
  allowed = true;
  const next = await service(request());
  time += 60_000;
  assert.equal((await service(new Request(next.headers.get('X-Swim-PDF-Url')))).status, 410);
  assert.equal((await service(request(card, { Origin: 'https://attacker.test' }))).status, 403);
  assert.equal((await service(request(card, { Authorization: 'Bearer forged' }))).status, 401);
  assert.equal((await service(request({ ...card, title: '' }))).status, 400);
  const anon = new Request(origin + '/v1/pdf/access');
  assert.equal((await service(anon)).status, 401);
});

test('unavailable payment check never produces PDF', async () => {
  const origin = 'https://vip.swimisland.ru';
  const service = createPdfService({ origin,
    api: async () => Response.json({ error: 'unavailable' }, { status: 503 }),
    render: () => assert.fail('must not render'),
  });
  const response = await service(new Request(origin + '/v1/pdf', { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(card) }));
  assert.equal(response.status, 503);
});

test('Timeweb relay forwards signed Telegram auth only for the PDF check route', async () => {
  const received = [];
  const upstream = createServer((req, res) => {
    received.push({ path: req.url, headers: req.headers });
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ allowed: true, expiresAt: now + 1000 }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const origin = new URL('http://127.0.0.1:9999');
  const relay = relayApi('http://127.0.0.1:' + upstream.address().port, origin);
  try {
    const tg = path => new Request(origin.origin + path, {
      headers: { Origin: 'https://yarpah03.github.io', Authorization: 'tma signed-test' },
    });
    assert.equal((await relay(tg('/v1/chats/pdf-access'))).status, 200);
    assert.equal(received[0].headers.authorization, 'tma signed-test');
    assert.equal(received[0].headers.origin, 'https://yarpah03.github.io');
    assert.equal((await relay(tg('/v1/chats/clients'))).status, 404);
    assert.equal((await relay(tg('/v1/client/pdf-access'))).status, 403);
    assert.equal((await relay(new Request(origin.origin + '/v1/chats/pdf-access', {
      headers: { Origin: 'https://attacker.test', Authorization: 'tma signed-test' },
    }))).status, 403);
    assert.equal((await relay(new Request(origin.origin + '/v1/chats/pdf-access'))).status, 401);
    const cookie = '__Host-swim-client=' + 'a'.repeat(64);
    const response = await relay(new Request(origin.origin + '/v1/client/pdf-access', {
      headers: { Origin: origin.origin, Cookie: 'unrelated=secret; ' + cookie, Authorization: 'Bearer ignored' },
    }));
    assert.equal(response.status, 200);
    assert.equal(received[1].headers.cookie, cookie);
    assert.equal(received[1].headers.authorization, undefined);
    assert.equal(received.length, 2);
  } finally { await new Promise(resolve => upstream.close(resolve)); }
});

test('compact A4 PDF is rendered by the existing template on the server', () => {
  const temp = mkdtempSync(join(tmpdir(), 'swim-pdf-test-'));
  for (const file of ['LiberationSans-Regular.ttf', 'LiberationSans-Bold.ttf', 'jspdf-4.2.1.min.js']) {
    copyFileSync(new URL('../workout-print/' + file, import.meta.url), join(temp, file.endsWith('.js') ? 'jspdf.cjs' : file));
  }
  const render = createRenderer(pathToFileURL(temp + '/'));
  const bytes = render(validateCard(card));
  assert(bytes.subarray(0, 5).equals(Buffer.from('%PDF-')));
  assert(bytes.length < 300_000);
  rmSync(temp, { recursive: true });
});
