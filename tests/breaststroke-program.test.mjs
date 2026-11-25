import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createPdfService, loadApprovedProgram } from '../deploy/timeweb/pdf.mjs';

const ORIGIN = 'https://vip.swimisland.ru';
const TELEGRAM = 'https://yarpah03.github.io';
const EPOCH = 1_800_000_000_000;
const fixturePdf = Buffer.from('%PDF-1.7\nPrivate program unit-test fixture only\n%%EOF');
const document = { program: 'breaststroke-beginner-8', title: 'Брасс с нуля', volume: '8 тренировок' };
const dynamicCard = { title: 'Existing workout', sections: [{ items: [{ text: '200 m easy', task: true }] }], notes: [] };

function fixture(options = {}) {
  const state = { time: EPOCH, allowed: true, reason: 'unpaid', expiresAt: EPOCH + 600_000,
    checks: [], programReads: 0, renders: 0, ...options.state };
  const service = createPdfService({ origin: ORIGIN, now: () => state.time,
    api: async request => {
      state.checks.push({ path: new URL(request.url).pathname, headers: request.headers });
      const authorization = request.headers.get('Authorization');
      const cookie = request.headers.get('Cookie');
      if (authorization !== 'tma signed-test' && cookie !== '__Host-swim-client=fixture') {
        return Response.json({ error: 'auth_required' }, { status: 401 });
      }
      if (state.providerUnavailable) return Response.json({ error: 'unavailable' }, { status: 503 });
      return Response.json(state.allowed ? { allowed: true, expiresAt: state.expiresAt }
        : { allowed: false, reason: state.reason });
    },
    render: () => { state.renders++; return Buffer.from('%PDF-1.7\nExisting generated workout\n%%EOF'); },
    readProgram: () => { state.programReads++; return options.readProgram ? options.readProgram(state) : fixturePdf; },
  });
  return { state, service };
}

function issue(body = document, { auth = 'telegram', headers = {}, raw = false } = {}) {
  const h = { Origin: auth === 'telegram' ? TELEGRAM : ORIGIN, 'Content-Type': 'application/json', ...headers };
  if (auth === 'telegram') h.Authorization = 'tma signed-test';
  if (auth === 'cookie') h.Cookie = '__Host-swim-client=fixture';
  return new Request(ORIGIN + '/v1/pdf', { method: 'POST', headers: h, body: raw ? body : JSON.stringify(body) });
}

async function errorResponse(response, status, error) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('Content-Type'), /application\/json/);
  if (error) assert.equal((await response.json()).error, error);
  assert.equal(response.headers.get('X-Swim-PDF-Url'), null);
}

test('paid Telegram and web sessions receive exactly the fixed private PDF, through current payment checks', async () => {
  for (const auth of ['telegram', 'cookie']) {
    const { service, state } = fixture();
    const response = await service(issue(document, { auth }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'application/pdf');
    assert.match(response.headers.get('Cache-Control'), /private.*no-store/);
    assert.match(response.headers.get('Content-Disposition'), /attachment;.*filename\*=UTF-8''/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), fixturePdf);
    assert.equal(state.programReads, 1);
    assert.equal(state.renders, 0);
    assert.equal(state.checks[0].path, auth === 'telegram' ? '/v1/chats/pdf-access' : '/v1/client/pdf-access');
    const ticket = response.headers.get('X-Swim-PDF-Url');
    assert.match(ticket, /^https:\/\/vip\.swimisland\.ru\/v1\/pdf\/download\/[a-f0-9]{64}$/);
    const download = await service(new Request(ticket));
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), fixturePdf);
    assert.equal(state.checks.length, 2, 'Browser fallback must recheck the issuing subscriber');
  }
});

test('trial, unpaid, expired and anonymous sessions never read or issue the private PDF', async () => {
  for (const scenario of [
    { state: { allowed: false, reason: 'trial' }, auth: 'telegram', status: 403 },
    { state: { allowed: false, reason: 'unpaid' }, auth: 'cookie', status: 403 },
    { state: { expiresAt: EPOCH }, auth: 'telegram', status: 403 },
    { state: {}, auth: 'none', status: 401 },
  ]) {
    const { service, state } = fixture({ state: scenario.state });
    const response = await service(issue(document, { auth: scenario.auth }));
    await errorResponse(response, scenario.status);
    assert.equal(state.programReads, 0);
    assert.equal(state.renders, 0);
  }
});

test('payment is checked before parsing a program body and provider failures fail closed', async () => {
  const trial = fixture({ state: { allowed: false, reason: 'trial' } });
  await errorResponse(await trial.service(issue('{', { raw: true })), 403, 'paid_subscription_required');
  assert.equal(trial.state.programReads, 0);
  const offline = fixture({ state: { providerUnavailable: true } });
  await errorResponse(await offline.service(issue()), 503, 'payment_check_unavailable');
  assert.equal(offline.state.programReads, 0);
});

test('fixed programs reject other identifiers, asset paths, extra payload fields and malformed JSON', async () => {
  for (const body of [
    { ...document, program: 'another-program' },
    { ...document, program: '../private/other.pdf' },
    { ...document, program: null },
    { ...document, program: ['breaststroke-beginner-8'] },
    { ...document, path: '/etc/passwd' },
    { ...document, sections: dynamicCard.sections },
  ]) {
    const { service, state } = fixture();
    await errorResponse(await service(issue(body)), 400, 'invalid_workout');
    assert.equal(state.programReads, 0);
  }
  const f = fixture();
  await errorResponse(await f.service(issue('{', { raw: true })), 400, 'invalid_workout');
  await errorResponse(await f.service(issue(document, { headers: { 'Content-Type': 'text/plain' } })), 415, 'json_required');
  assert.equal(f.state.programReads, 0);
});

test('cross-origin requests and malformed authentication cannot reach private program bytes', async () => {
  const { service, state } = fixture();
  await errorResponse(await service(issue(document, { headers: { Origin: 'https://attacker.invalid' } })), 403, 'forbidden_origin');
  const forged = new Request(ORIGIN + '/v1/pdf', { method: 'POST', headers: {
    Origin: ORIGIN, Authorization: 'Bearer forged', 'Content-Type': 'application/json' }, body: JSON.stringify(document) });
  await errorResponse(await service(forged), 401, 'telegram_auth_required');
  assert.equal(state.programReads, 0);
});

test('revoking a paid subscription also revokes a previously issued browser fallback ticket', async () => {
  const { service, state } = fixture();
  const response = await service(issue());
  const ticket = response.headers.get('X-Swim-PDF-Url');
  state.allowed = false;
  state.reason = 'trial';
  await errorResponse(await service(new Request(ticket)), 403, 'paid_subscription_required');
  state.allowed = true;
  await errorResponse(await service(new Request(ticket)), 410, 'pdf_expired');
  assert.equal(state.programReads, 1);
});

test('program fallback lifetime is capped by both the current paid expiry and the short ticket TTL', async () => {
  for (const expiry of [EPOCH + 1000, EPOCH + 600_000]) {
    const { service, state } = fixture({ state: { expiresAt: expiry } });
    const response = await service(issue());
    const ticket = response.headers.get('X-Swim-PDF-Url');
    state.time = Math.min(expiry, EPOCH + 120_000);
    await errorResponse(await service(new Request(ticket)), 410, 'pdf_expired');
  }
});

test('no direct, encoded, ranged or HEAD path provides a public program PDF', async () => {
  const { service, state } = fixture();
  for (const path of [
    '/v1/pdf?program=breaststroke-beginner-8',
    '/v1/pdf/program/breaststroke-beginner-8.pdf',
    '/v1/pdf/%70rogram/breaststroke-beginner-8.pdf',
    '/v1/pdf/../private/breaststroke-beginner-8.pdf',
    '/private/breaststroke-beginner-8.pdf',
  ]) {
    const response = await service(new Request(ORIGIN + path, { headers: { Range: 'bytes=0-20' } }));
    assert(response === null || (response.status !== 200 && response.status !== 206));
    if (response) assert(!response.headers.get('Content-Type')?.startsWith('application/pdf'));
  }
  await errorResponse(await service(new Request(ORIGIN + '/v1/pdf/download/' + '0'.repeat(64))), 410);
  assert.equal(state.programReads, 0);
  const paid = await service(issue());
  const ticket = paid.headers.get('X-Swim-PDF-Url');
  await errorResponse(await service(new Request(ticket, { method: 'HEAD' })), 404);
  state.allowed = false;
  await errorResponse(await service(new Request(ticket, { headers: { Range: 'bytes=0-20' } })), 403);
});

test('missing, corrupt and oversized private program bytes fail closed', async () => {
  const oversized = Buffer.alloc(1024 * 1024 + 1);
  oversized.write('%PDF-');
  for (const readProgram of [
    () => { throw new Error('ENOENT fixture'); },
    () => Buffer.from('not a PDF'),
    () => Buffer.alloc(0),
    () => new Uint8Array([1, 2, 3]),
    () => oversized,
  ]) {
    const { service } = fixture({ readProgram });
    await errorResponse(await service(issue()), 503, 'pdf_unavailable');
  }
});

test('existing generated workout PDFs still use their renderer rather than the fixed program loader', async () => {
  const { service, state } = fixture();
  const response = await service(issue(dynamicCard));
  assert.equal(response.status, 200);
  assert.match(Buffer.from(await response.arrayBuffer()).toString(), /Existing generated workout/);
  assert.equal(state.renders, 1);
  assert.equal(state.programReads, 0);
});

test('subscription expiry during fixed program loading prevents issuing a download ticket', async () => {
  const { service, state } = fixture({ state: { expiresAt: EPOCH + 1 },
    readProgram: state => { state.time += 2; return fixturePdf; } });
  await errorResponse(await service(issue()), 403, 'paid_subscription_required');
  assert.equal(state.programReads, 1);
});

test('default private loader rejects an asset whose checksum differs from the approved PDF', () => {
  assert.throws(() => loadApprovedProgram(new URL(import.meta.url)), /Approved program checksum mismatch/);
});

function course() {
  return vm.runInNewContext(readFileSync(new URL('../breaststroke-plan.js', import.meta.url), 'utf8') + '\nBreaststrokeProgram;');
}
const plain = html => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

test('all eight visible workouts preserve the approved distances, including corrected 700 m session seven', () => {
  const p = course();
  assert.deepEqual(Array.from(p.data.workouts, w => w.metres), [400, 600, 650, 550, 600, 650, 700, 900]);
  assert.equal(p.data.totalMetres, 5050);
  for (const w of p.data.workouts) {
    assert.equal(w.sets.filter(x => x.type === 'swim').reduce((sum, x) => sum + x.repetitions * x.distance, 0), w.metres);
  }
  const seventh = p.data.workouts[6];
  assert.deepEqual(Array.from(seventh.sets, x => x.repetitions), [4, 4, 4, 16]);
  const pages = {}, parents = {};
  p.register(pages, parents);
  assert.equal(pages.br0_plan.kids.length, 8);
  for (let i = 1; i <= 8; i++) {
    assert.equal(pages['br0_plan_' + i].breaststrokeWorkout, i);
    assert.equal(parents['br0_plan_' + i], 'br0_plan');
  }
  assert.equal(parents.br0_plan, 'br0');
});

test('dry preparation and wall repetitions remain visible, and duplicate preparation was removed', () => {
  const p = course();
  const second = p.data.workouts[1], fifth = p.data.workouts[4];
  assert.equal(second.prep.length, 1);
  assert.equal(second.prep[0].sets, 3);
  assert.equal(fifth.prep.length, 2);
  assert.equal(fifth.prep[0].sets, 2);
  const secondText = plain(p.render({ breaststrokeWorkout: 2 }));
  assert.match(secondText, /3 × 15[-–]20 повторений/);
  assert.match(secondText, /3 × 20 толчков/);
  assert.match(secondText, /20[-–]30 секунд/);
  const fourth = p.render({ breaststrokeWorkout: 4 });
  assert.match(fourth, /href="#br0\/lesson-3"/);
  assert.equal(p.data.workouts[3].sets[0].afterEach.totalRepetitions, 30);
});

test('exercise demonstrations stay in app routes and every workout offers the protected full-course PDF', () => {
  const p = course();
  const seen = new Set();
  for (const w of p.data.workouts) {
    const html = p.render({ breaststrokeWorkout: w.number });
    assert.match(html, /Скачать 8 тренировок/);
    assert(!/kinescope\.(?:io|ru)/.test(html));
    for (const x of [...w.prep, ...w.sets]) {
      if (!x.exercise) continue;
      const route = p.routeFor(x.exercise);
      assert.match(route, /^(?:br0\/lesson-[1-6]|dr_br_(?:[1-9]|1[0-2]))$/);
      seen.add(route);
      assert(html.includes('href="#' + route + '"'));
    }
  }
  for (const route of ['dr_br_5', 'dr_br_7', 'dr_br_9', 'dr_br_11']) assert(seen.has(route));
});

function portal({ material = '', active = true, pathname = '/client/', invitation = '' } = {}) {
  const elements = new Map();
  function element(key) {
    if (!elements.has(key)) elements.set(key, {
      hidden: false, value: '', disabled: false, dataset: {}, listeners: new Map(),
      addEventListener(type, listener) { this.listeners.set(type, listener); },
      replaceChildren() {}, close() {}, removeAttribute(name) { delete this[name]; },
      querySelector(selector) { return element(key + ' ' + selector); },
      showModal() {}, focus() {}, append() {},
    });
    return elements.get(key);
  }
  const params = new URLSearchParams();
  if (material) params.set('material', material);
  if (invitation) params.set('invite', invitation);
  const location = { pathname, search: params.size ? '?' + params : '', hash: '' };
  const calls = [], history = [];
  const sandbox = {
    location, URL, URLSearchParams, TextEncoder, AbortSignal,
    crypto: { subtle: { importKey: async () => ({}), deriveBits: async () => new ArrayBuffer(32) } },
    history: { replaceState(_state, _title, url) { history.push(url); location.search = location.hash = ''; location.pathname = url; } },
    document: { title: '', body: { dataset: {} }, hidden: false,
      querySelector: element, getElementById: element, addEventListener() {}, createElement: element },
    window: { addEventListener() {}, setInterval() {} },
    SwimChats: { mount() {} }, SwimPartners: { desk() {} },
    setTimeout: () => 1, clearTimeout() {},
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => url.endsWith('/session')
        ? active ? { active: true } : invitation ? { active: false, invite: 'register' } : { active: false }
        : { active: true } };
    },
  };
  vm.runInNewContext(readFileSync(new URL('../chats/client/client.js', import.meta.url), 'utf8'), sandbox);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  return { elements, element, calls, history, settle,
    frame: element('client-catalog'), location,
    async login() {
      element('client-login').value = 'swim.fixture';
      element('client-password').value = 'fixture-password-1234';
      element('client-name').value = 'Fixture';
      await element('client-password-form').listeners.get('submit')({ preventDefault() {} });
      await settle();
    } };
}

test('PDF exercise links keep their requested route through an existing authenticated web session', async () => {
  for (const material of ['br0/lesson-3', 'dr_br_7', 'br0_plan_7']) {
    const p = portal({ material }); await p.settle();
    assert.equal(new URL(p.frame.src).hash, '#' + material);
    assert.deepEqual(p.history, ['/client/']);
    assert.equal(p.location.search, '', 'Invite/material query should be removed after its route was captured');
  }
});

test('PDF exercise links survive login and registration without changing the ordinary invite destination', async () => {
  const login = portal({ material: 'dr_br_11', active: false });
  await login.settle(); await login.login();
  assert.equal(new URL(login.frame.src).hash, '#dr_br_11');
  assert(login.calls.some(x => x.url === '/v1/client/password'));
  const invitation = 'a'.repeat(64);
  const registration = portal({ material: 'br0/lesson-2', active: false,
    pathname: '/client/register/', invitation });
  await registration.settle(); await registration.login();
  assert.equal(new URL(registration.frame.src).hash, '#br0/lesson-2');
  assert(registration.calls.some(x => x.url === '/v1/client/register'));
  const ordinaryInvite = portal({ active: false, pathname: '/client/register/', invitation });
  await ordinaryInvite.settle(); await ordinaryInvite.login();
  assert.equal(new URL(ordinaryInvite.frame.src).hash, '#home');
});

test('unrecognized external or script material targets are ignored and normal web entry stays at home', async () => {
  for (const material of ['', 'https://attacker.invalid/', 'javascript:alert(1)', 'br0/lesson-99', 'dr_br_999', '../private/file']) {
    const p = portal({ material }); await p.settle();
    assert.equal(new URL(p.frame.src).hash, '#home');
  }
});
