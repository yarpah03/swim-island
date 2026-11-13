const APP_ORIGIN = 'https://yarpah03.github.io';
const MINI_APP_BOT_ID = '9271382179';
const TELEGRAM_KEY = 'e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d';
const TICKET_LIFETIME = 15 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const MAX_BODY = 120_000;
const encoder = new TextEncoder();
const moscowCalendar = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
});
let telegramKey;

class RequestError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}

function monthOf(timestamp) {
  const parts = moscowCalendar.formatToParts(timestamp);
  return parts.find(part => part.type === 'year').value + '-' +
    parts.find(part => part.type === 'month').value;
}

function previousMonth(month) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 2, 1)).toISOString().slice(0, 7);
}

function response(data, status = 200) {
  return new Response(data === null ? null : JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': APP_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function authenticate(request, now) {
  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('tma ') || authorization.length > 8192) return null;
  const data = new URLSearchParams(authorization.slice(4));
  const authDate = Number(data.get('auth_date'));
  const signature = data.get('signature') ?? '';
  if (!Number.isInteger(authDate) || authDate * 1000 < now - DAY || authDate * 1000 > now + 120_000 ||
      !/^[A-Za-z0-9_-]{86}(?:==)?$/.test(signature)) return null;

  const fields = [...data.keys()];
  if (new Set(fields).size !== fields.length) return null;
  const signedFields = fields.filter(field => field !== 'hash' && field !== 'signature').sort();
  const signed = MINI_APP_BOT_ID + ':WebAppData\n' +
    signedFields.map(field => field + '=' + data.get(field)).join('\n');
  const bytes = Uint8Array.from(atob(signature.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  telegramKey ??= crypto.subtle.importKey(
    'raw',
    Uint8Array.from(TELEGRAM_KEY.match(/../g), byte => parseInt(byte, 16)),
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
  if (!await crypto.subtle.verify('Ed25519', await telegramKey, bytes, encoder.encode(signed))) return null;

  let user;
  try {
    user = JSON.parse(data.get('user'));
  } catch {
    return null;
  }
  if (!Number.isSafeInteger(user?.id) || user.id <= 0 || user.is_bot) return null;
  const username = typeof user.username === 'string' ? user.username : '';
  const firstName = typeof user.first_name === 'string'
    ? [...user.first_name.replace(/[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu, '').trim()].slice(0, 40).join('')
    : '';
  return { id: user.id, name: /^[A-Za-z0-9_]{1,32}$/.test(username) ? '@' + username : firstName || 'Пловец' };
}

async function readResult(request) {
  if (!request.body || Number(request.headers.get('Content-Length')) > MAX_BODY) {
    throw new RequestError(413, 'result_too_large');
  }
  const reader = request.body.getReader();
  const bytes = new Uint8Array(MAX_BODY);
  let offset = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (offset + value.length > MAX_BODY) {
      await reader.cancel();
      throw new RequestError(413, 'result_too_large');
    }
    bytes.set(value, offset);
    offset += value.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes.subarray(0, offset)));
  } catch {
    throw new RequestError(400, 'invalid_result');
  }
}

async function startRun(db, player, now, context) {
  const id = crypto.randomUUID();
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  const inserted = await db.prepare(`
    INSERT INTO game_runs (id, player_id, seed, issued_ms)
    SELECT ?, ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM game_runs WHERE player_id = ? AND issued_ms > ?)
  `).bind(id, player.id, seed, now, player.id, now - 750).run();
  if (!inserted.meta.changes) throw new RequestError(429, 'wait_before_retry');
  if (seed % 16 === 0) {
    context.waitUntil(db.prepare(`
      DELETE FROM game_runs WHERE id IN (
        SELECT id FROM game_runs WHERE issued_ms < ? ORDER BY issued_ms LIMIT 64
      )
    `).bind(now - DAY).run().catch(() => {}));
  }
  return { id, seed };
}

async function finishRun(db, player, now, request) {
  const result = await readResult(request);
  const id = result?.id;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) {
    throw new RequestError(400, 'invalid_result');
  }
  const ticket = await db.prepare(`
    SELECT seed, issued_ms, finished_ms, meters, month FROM game_runs
    WHERE id = ? AND player_id = ?
  `).bind(id, player.id).first();
  if (!ticket) throw new RequestError(410, 'expired_run');
  if (ticket.finished_ms !== null) return { meters: ticket.meters, month: ticket.month };
  if (now - ticket.issued_ms > TICKET_LIFETIME) throw new RequestError(410, 'expired_run');

  const ticks = result.ticks;
  if (!Number.isInteger(ticks) || ticks * SwimGameEngine.STEP * 1000 > now - ticket.issued_ms + 350) {
    throw new RequestError(422, 'invalid_run');
  }
  const meters = SwimGameEngine.replay(ticket.seed, ticks, result.taps);
  if (meters === null) throw new RequestError(422, 'invalid_run');

  const month = monthOf(now);
  const saved = await db.prepare(`
    UPDATE game_runs SET finished_ms = ?, month = ?, meters = ?, display_name = ?
    WHERE id = ? AND player_id = ? AND finished_ms IS NULL
    RETURNING meters, month
  `).bind(now, month, meters, player.name, id, player.id).first();
  if (saved) return saved;
  return db.prepare('SELECT meters, month FROM game_runs WHERE id = ? AND player_id = ?')
    .bind(id, player.id).first();
}

async function leaderboard(db, player, now) {
  const month = monthOf(now);
  const lastMonth = previousMonth(month);
  const leaders = `
    SELECT player_id, display_name, meters FROM game_month WHERE month = ?
    ORDER BY meters DESC, reached_ms, player_id
  `;
  const [top, personal, previous] = await db.batch([
    db.prepare(leaders + ' LIMIT 30').bind(month),
    db.prepare(`
      SELECT me.meters, 1 + (
        SELECT COUNT(*) FROM game_month AS rival
        WHERE rival.month = me.month AND (
          rival.meters > me.meters OR
          (rival.meters = me.meters AND (rival.reached_ms, rival.player_id) < (me.reached_ms, me.player_id))
        )
      ) AS place FROM game_month AS me WHERE me.month = ? AND me.player_id = ?
    `).bind(month, player.id),
    db.prepare(leaders + ' LIMIT 1').bind(lastMonth),
  ]);
  const winner = previous.results[0];
  return {
    month,
    top: top.results.map((row, index) => ({
      place: index + 1, name: row.display_name, meters: row.meters, you: row.player_id === player.id,
    })),
    you: personal.results[0] ?? null,
    lastMonth: { month: lastMonth, leader: winner ? { name: winner.display_name, meters: winner.meters } : null },
  };
}

export default {
  async fetch(request, env, context) {
    const { pathname } = new URL(request.url);
    const origin = request.headers.get('Origin');
    if (origin && origin !== APP_ORIGIN) return response({ error: 'forbidden_origin' }, 403);
    const routes = { '/health': 'GET', '/v1/leaderboard': 'GET', '/v1/start': 'POST', '/v1/finish': 'POST' };
    const method = routes[pathname];
    if (!method) return response({ error: 'not_found' }, 404);
    if (request.method === 'OPTIONS') return response(null, 204);
    if (request.method !== method) return response({ error: 'method_not_allowed' }, 405);

    const db = env.GAME_DB;
    if (!db) return response({ error: 'game_unconfigured' }, 503);
    try {
      if (pathname === '/health') {
        await db.prepare('SELECT 1 FROM game_month LIMIT 1').first();
        await db.prepare('SELECT 1 FROM game_runs LIMIT 1').first();
        return response({ ok: true, version: 1 });
      }
      const now = Date.now();
      const player = await authenticate(request, now);
      if (!player) return response({ error: 'telegram_auth_required' }, 401);
      if (pathname === '/v1/start') return response(await startRun(db, player, now, context));
      if (pathname === '/v1/finish') return response(await finishRun(db, player, now, request));
      return response(await leaderboard(db, player, now));
    } catch (error) {
      if (error instanceof RequestError) return response({ error: error.message }, error.status);
      console.error('Game request failed', pathname, error.name);
      return response({ error: 'unavailable' }, 503);
    }
  },
};

export { authenticate };
