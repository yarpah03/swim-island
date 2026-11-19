import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createPdf } from './pdf-template.mjs';

const TELEGRAM_ORIGIN = 'https://yarpah03.github.io';
const MAX_BODY = 96 * 1024;
const TOKEN_TTL = 120_000;
const MAX_DOWNLOADS = 32;

class PdfError extends Error {
  constructor(status, code) { super(code); this.status = status; }
}

export function validateCard(value) {
  let total = 0;
  const text = (input, max, required = false) => {
    if (input === undefined && !required) return '';
    if (typeof input !== 'string' || input.length > max || (required && !input.trim())) {
      throw new PdfError(400, 'invalid_workout');
    }
    total += input.length;
    return input.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '');
  };
  if (!value || typeof value !== 'object' || !Array.isArray(value.sections) ||
      value.sections.length < 1 || value.sections.length > 16 ||
      !Array.isArray(value.notes) || value.notes.length > 20) throw new PdfError(400, 'invalid_workout');
  let items = 0;
  const card = {
    title: text(value.title, 140, true),
    context: text(value.context, 600),
    volume: text(value.volume, 60),
    sections: value.sections.map(section => {
      if (!section || !Array.isArray(section.items) || !section.items.length ||
          (items += section.items.length) > 120) throw new PdfError(400, 'invalid_workout');
      return {
        label: text(section.label, 160),
        items: section.items.map(item => {
          if (!item || typeof item !== 'object') throw new PdfError(400, 'invalid_workout');
          return { text: text(item.text, 2000, true), dose: text(item.dose, 250), task: item.task === true };
        }),
      };
    }),
    notes: value.notes.map(note => text(note, 1500)),
  };
  if (total > 24_000) throw new PdfError(413, 'workout_too_large');
  return card;
}

export function createRenderer(assetRoot = new URL('./pdf/', import.meta.url)) {
  const { jsPDF } = createRequire(import.meta.url)(fileURLToPath(new URL('jspdf.cjs', assetRoot)));
  const fonts = [['normal', 'LiberationSans-Regular.ttf'], ['bold', 'LiberationSans-Bold.ttf']]
    .map(([style, file]) => [style, file, readFileSync(new URL(file, assetRoot)).toString('latin1')]);
  return card => Buffer.from(createPdf(jsPDF, fonts, card).output('arraybuffer'));
}

async function readCard(request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') {
    throw new PdfError(415, 'json_required');
  }
  if (!request.body || Number(request.headers.get('Content-Length')) > MAX_BODY) {
    throw new PdfError(413, 'workout_too_large');
  }
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if ((size += value.length) > MAX_BODY) throw new PdfError(413, 'workout_too_large');
      chunks.push(value);
    }
    return validateCard(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof PdfError) throw error;
    throw new PdfError(400, 'invalid_workout');
  }
}

export function createPdfService({ origin, api, render = createRenderer(), now = Date.now }) {
  const downloads = new Map();
  const limits = new Map();
  function headers(request) {
    const h = new Headers({
      'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow',
    });
    const supplied = request.headers.get('Origin');
    if (supplied === TELEGRAM_ORIGIN || supplied === origin) {
      h.set('Access-Control-Allow-Origin', supplied);
      h.set('Vary', 'Origin');
      h.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      h.set('Access-Control-Expose-Headers', 'X-Swim-PDF-Url');
    }
    return h;
  }
  function json(request, body, status = 200) {
    const h = headers(request);
    h.set('Content-Type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(body), { status, headers: h });
  }
  function credentials(request) {
    const authorization = request.headers.get('Authorization');
    if (authorization !== null && (!authorization.startsWith('tma ') || authorization.length > 8192)) {
      throw new PdfError(401, 'telegram_auth_required');
    }
    const cookie = request.headers.get('Cookie') ?? '';
    if (cookie.length > 8192) throw new PdfError(401, 'web_auth_required');
    return authorization ? { authorization } : { cookie };
  }
  async function access(auth) {
    const telegram = Boolean(auth.authorization);
    const h = telegram
      ? { Authorization: auth.authorization, Origin: TELEGRAM_ORIGIN }
      : { Cookie: auth.cookie, Origin: origin };
    const path = telegram ? '/v1/chats/pdf-access' : '/v1/client/pdf-access';
    let result;
    let data;
    try {
      result = await api(new Request(origin + path, { headers: h, signal: AbortSignal.timeout(10_000) }));
      data = await result.json();
    } catch { throw new PdfError(503, 'payment_check_unavailable'); }
    if (!result.ok) {
      if (result.status === 401) throw new PdfError(401, telegram ? 'telegram_auth_required' : 'web_auth_required');
      throw new PdfError(503, 'payment_check_unavailable');
    }
    if (data.allowed !== true) {
      if (!['trial', 'unpaid'].includes(data.reason)) throw new PdfError(503, 'payment_check_unavailable');
      return { allowed: false, reason: data.reason };
    }
    if (!Number.isSafeInteger(data.expiresAt) || data.expiresAt <= now()) {
      return { allowed: false, reason: 'unpaid' };
    }
    return { allowed: true, expiresAt: data.expiresAt };
  }
  function cleanup(time) {
    for (const [key, entry] of downloads) if (entry.until <= time) downloads.delete(key);
    for (const [key, entry] of limits) if (entry.until <= time) limits.delete(key);
  }
  function rateLimit(auth) {
    const time = now();
    cleanup(time);
    const key = createHash('sha256').update(auth.authorization ?? auth.cookie).digest('hex');
    const limit = limits.get(key) ?? { count: 0, until: time + 60_000 };
    if (++limit.count > 12) throw new PdfError(429, 'pdf_wait');
    if (limits.size >= 512 && !limits.has(key)) throw new PdfError(429, 'pdf_wait');
    limits.set(key, limit);
  }
  function fileResponse(request, entry, url) {
    const h = headers(request);
    h.set('Content-Type', 'application/pdf');
    h.set('Content-Disposition', "attachment; filename=workout.pdf; filename*=UTF-8''" + encodeURIComponent(entry.filename));
    if (url) h.set('X-Swim-PDF-Url', url);
    return new Response(entry.bytes, { headers: h });
  }
  return async request => {
    const path = new URL(request.url).pathname;
    if (path !== '/v1/pdf' && !path.startsWith('/v1/pdf/')) return null;
    try {
      const supplied = request.headers.get('Origin');
      if ((supplied && ![origin, TELEGRAM_ORIGIN].includes(supplied)) ||
          (request.method === 'POST' && ![origin, TELEGRAM_ORIGIN].includes(supplied))) {
        throw new PdfError(403, 'forbidden_origin');
      }
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(request) });
      const download = /^\/v1\/pdf\/download\/([a-f0-9]{64})$/.exec(path);
      if (download && request.method === 'GET') {
        cleanup(now());
        const entry = downloads.get(download[1]);
        if (!entry) throw new PdfError(410, 'pdf_expired');
        const entitlement = await access(entry.auth);
        if (!entitlement.allowed || entry.until <= now()) {
          downloads.delete(download[1]);
          throw new PdfError(403, 'paid_subscription_required');
        }
        return fileResponse(request, entry);
      }
      if (!(path === '/v1/pdf/access' && request.method === 'GET') &&
          !(path === '/v1/pdf' && request.method === 'POST')) throw new PdfError(404, 'not_found');
      const auth = credentials(request);
      const entitlement = await access(auth);
      if (path === '/v1/pdf/access') return json(request, entitlement);
      if (!entitlement.allowed) return json(request, { error: 'paid_subscription_required', reason: entitlement.reason }, 403);
      rateLimit(auth);
      const card = await readCard(request);
      const bytes = await render(card);
      if (!Buffer.isBuffer(bytes) || bytes.length > 1024 * 1024) throw new PdfError(503, 'pdf_unavailable');
      if (entitlement.expiresAt <= now()) throw new PdfError(403, 'paid_subscription_required');
      const filename = [card.title, card.volume, 'Плавательный остров VIP'].filter(Boolean)
        .join(' - ').slice(0, 140).replace(/[<>:"/\\|?*\r\n]/g, '-') + '.pdf';
      const token = randomBytes(32).toString('hex');
      cleanup(now());
      if (downloads.size >= MAX_DOWNLOADS) downloads.delete(downloads.keys().next().value);
      const entry = { auth, bytes, filename, until: Math.min(now() + TOKEN_TTL, entitlement.expiresAt) };
      downloads.set(token, entry);
      return fileResponse(request, entry, origin + '/v1/pdf/download/' + token);
    } catch (error) {
      if (error instanceof PdfError) return json(request, { error: error.message }, error.status);
      console.error('PDF request failed:', error.name);
      return json(request, { error: 'pdf_unavailable' }, 503);
    }
  };
}
