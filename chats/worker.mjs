import { authenticate } from '../game/worker.mjs';

const APP_ORIGIN = 'https://yarpah03.github.io';
const PAGE_SIZE = 40;
const levels = new Set(['n', 's', 'p']);
const vipCache = new Map();

class ChatError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}

function reply(data, status = 200) {
  const headers = {
    'Access-Control-Allow-Origin': APP_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  return data === null ? new Response(null, { status, headers }) : Response.json(data, { status, headers });
}

async function input(request) {
  const maxBytes = 12288;
  if (!request.body || Number(request.headers.get('Content-Length')) > maxBytes) {
    throw new ChatError(413, 'message_too_long');
  }
  const reader = request.body.getReader();
  const bytes = new Uint8Array(maxBytes);
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (length + value.length > maxBytes) {
      await reader.cancel();
      throw new ChatError(413, 'message_too_long');
    }
    bytes.set(value, length);
    length += value.length;
  }
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {
    // Invalid UTF-8 and invalid JSON are both rejected.
  }
  throw new ChatError(400, 'invalid_input');
}

function cleanName(value, max = 40) {
  if (typeof value !== 'string') throw new ChatError(400, 'invalid_name');
  const name = value.normalize('NFC').replace(/[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu, ' ').replace(/\s+/gu, ' ').trim();
  if ([...name].length < 2 || [...name].length > max) throw new ChatError(400, 'invalid_name');
  return name;
}

async function profileForCode(db, value) {
  const code = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-f0-9]{12}$/.test(code)) throw new ChatError(400, 'invalid_account');
  const profile = await db.prepare(`
    SELECT p.telegram_id, COALESCE(c.name, p.name) AS name, p.level
    FROM chat_profiles p
    LEFT JOIN chat_coaches c ON c.telegram_id = p.telegram_id
    WHERE p.code = ?
  `).bind(code).first();
  if (!profile) throw new ChatError(400, 'account_not_found');
  return profile;
}

function ownerConfigured(env, id) {
  return (env.CHAT_OWNER_IDS ?? '').split(',').map(value => value.trim()).includes(String(id));
}

async function channelStatus(env, id, fresh = false) {
  if (!env.VIP_CHANNEL_ID || !env.VIP_BOT_TOKEN) return 'unavailable';
  const key = env.VIP_CHANNEL_ID + ':' + id;
  const cached = vipCache.get(key);
  if (!fresh && cached?.until > Date.now()) return cached.status;
  try {
    const response = await fetch('https://api.telegram.org/bot' + env.VIP_BOT_TOKEN + '/getChatMember', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.VIP_CHANNEL_ID, user_id: id }),
      signal: AbortSignal.timeout(4500),
    });
    const { ok, result } = await response.json();
    if (!response.ok || !ok) return 'unavailable';
    const role = result?.status;
    let status = 'inactive';
    if (role === 'creator') status = 'owner';
    else if (role === 'administrator' || role === 'member' || (role === 'restricted' && result.is_member)) status = 'active';
    if (vipCache.size >= 512) vipCache.delete(vipCache.keys().next().value);
    vipCache.set(key, { status, until: Date.now() + 25000 });
    return status;
  } catch {
    return 'unavailable';
  }
}

function isVip(status) {
  return status === 'owner' || status === 'active';
}

async function profileOf(db, id) {
  return db.prepare('SELECT code, name, level FROM chat_profiles WHERE telegram_id = ?').bind(id).first();
}

async function overview(env, player, now) {
  const db = env.CHAT_DB;
  const [profile, vip, coaching, direct, coachProfile] = await Promise.all([
    profileOf(db, player.id),
    channelStatus(env, player.id),
    db.prepare(`
      SELECT c.id, c.expires_ms, COALESCE(coach.name, other.name) AS name, c.coach_id = ? AS coaching
      FROM chat_coaching c
      JOIN chat_profiles other ON other.telegram_id = CASE WHEN c.coach_id = ? THEN c.student_id ELSE c.coach_id END
      LEFT JOIN chat_coaches coach ON coach.telegram_id = other.telegram_id AND other.telegram_id = c.coach_id
      WHERE (c.student_id = ? OR c.coach_id = ?) AND c.expires_ms > ?
      ORDER BY name, c.id
    `).bind(player.id, player.id, player.id, player.id, now).all(),
    db.prepare(`
      SELECT d.id, COALESCE(c.name, p.name) AS title
      FROM chat_direct d
      JOIN chat_profiles p ON p.telegram_id = CASE WHEN d.first_id = ? THEN d.second_id ELSE d.first_id END
      LEFT JOIN chat_coaches c ON c.telegram_id = p.telegram_id
      WHERE d.first_id = ? OR d.second_id = ?
      ORDER BY title, d.id
    `).bind(player.id, player.id, player.id).all(),
    db.prepare('SELECT name, handle FROM chat_coaches WHERE telegram_id = ?').bind(player.id).first(),
  ]);
  const manager = ownerConfigured(env, player.id) || vip === 'owner';
  const groups = profile && isVip(vip) ? (await db.prepare(`
    SELECT id, title, level FROM chat_groups WHERE level IS NULL OR level = ?
    ORDER BY id NOT LIKE 'level-%', title
  `).bind(profile.level).all()).results : [];
  return {
    profile, suggestedName: coachProfile?.name ?? player.name,
    coach: coachProfile,
    vip: isVip(vip) ? 'active' : vip, manager,
    rooms: [
      ...groups.map(room => ({ ...room, kind: 'group' })),
      ...coaching.results.map(row => ({
        id: row.id, title: row.name, kind: 'coaching', coaching: Boolean(row.coaching), expires: row.expires_ms,
      })),
      ...direct.results.map(row => ({ ...row, kind: 'direct' })),
    ],
  };
}

async function contact(db, player, now, request, open) {
  const coach = await db.prepare('SELECT 1 FROM chat_coaches WHERE telegram_id = ?').bind(player.id).first();
  if (!coach) throw new ChatError(403, 'coach_required');
  if (!await profileOf(db, player.id)) throw new ChatError(403, 'profile_required');
  const { code } = await input(request);
  const profile = await profileForCode(db, code);
  const target = profile.telegram_id;
  if (target === player.id) throw new ChatError(400, 'self_contact');
  if (!open) return { name: profile.name, level: profile.level };

  const first = Math.min(player.id, target);
  const second = Math.max(player.id, target);
  const existing = await db.prepare(`
    SELECT id, 'direct' AS kind, 1 AS priority FROM chat_direct WHERE first_id = ? AND second_id = ?
    UNION ALL
    SELECT id, 'coaching' AS kind, 2 AS priority FROM chat_coaching
    WHERE student_id = ? AND coach_id = ? AND expires_ms > ?
    ORDER BY priority LIMIT 1
  `).bind(first, second, target, player.id, now).first();
  if (existing) return { id: existing.id, kind: existing.kind, title: profile.name };

  const [, selected] = await db.batch([
    db.prepare(`
      INSERT INTO chat_direct (id, first_id, second_id) VALUES (?, ?, ?)
      ON CONFLICT (first_id, second_id) DO NOTHING
    `).bind('direct-' + crypto.randomUUID(), first, second),
    db.prepare('SELECT id FROM chat_direct WHERE first_id = ? AND second_id = ?').bind(first, second),
  ]);
  return { id: selected.results[0].id, kind: 'direct', title: profile.name };
}

async function requireRoom(env, id, player, now) {
  const db = env.CHAT_DB;
  const profile = await profileOf(db, player.id);
  if (!profile) throw new ChatError(403, 'profile_required');
  if (id.startsWith('lesson-')) {
    const room = await db.prepare(`
      SELECT coach_id FROM chat_coaching
      WHERE id = ? AND expires_ms > ? AND (student_id = ? OR coach_id = ?)
    `).bind(id, now, player.id, player.id).first();
    if (room) return room;
    throw new ChatError(403, 'room_forbidden');
  }
  if (id.startsWith('direct-')) {
    const room = await db.prepare('SELECT 1 FROM chat_direct WHERE id = ? AND (first_id = ? OR second_id = ?)')
      .bind(id, player.id, player.id).first();
    if (room) return { direct: true };
    throw new ChatError(403, 'room_forbidden');
  }
  const group = await db.prepare('SELECT level FROM chat_groups WHERE id = ?').bind(id).first();
  if (!group || (group.level && group.level !== profile.level)) throw new ChatError(403, 'room_forbidden');
  const vip = await channelStatus(env, player.id);
  if (vip === 'unavailable') throw new ChatError(503, 'vip_unavailable');
  if (!isVip(vip)) throw new ChatError(403, 'room_forbidden');
  return {};
}

async function messages(db, room, roomId, playerId, params) {
  const before = params.get('before');
  const after = params.get('after');
  for (const cursor of [before, after]) {
    if (cursor !== null && (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor)))) {
      throw new ChatError(400, 'invalid_cursor');
    }
  }
  if (before !== null && after !== null) throw new ChatError(400, 'invalid_cursor');
  const ascending = after !== null;
  const cursor = Number(after ?? before ?? Number.MAX_SAFE_INTEGER);
  const result = await db.prepare(`
    SELECT m.id, m.sender_id, COALESCE(coach.name, p.name) AS name, m.body, m.video_url, m.sent_ms,
      coach.telegram_id IS NOT NULL AS registered_coach
    FROM chat_messages m JOIN chat_profiles p ON p.telegram_id = m.sender_id
    LEFT JOIN chat_coaches coach ON coach.telegram_id = m.sender_id AND (coach.telegram_id = ? OR ? = 1)
    WHERE m.room_id = ? AND m.id ${ascending ? '>' : '<'} ?
    ORDER BY m.id ${ascending ? 'ASC' : 'DESC'} LIMIT ?
  `).bind(room.coach_id ?? 0, Number(Boolean(room.direct)), roomId, cursor, PAGE_SIZE + 1).all();
  const page = result.results.slice(0, PAGE_SIZE);
  if (!ascending) page.reverse();
  return {
    more: result.results.length > PAGE_SIZE,
    messages: page.map(row => ({
      id: row.id, name: row.name, text: row.body, video: row.video_url, sent: row.sent_ms,
      own: row.sender_id === playerId, coach: row.sender_id === room.coach_id || Boolean(row.registered_coach),
    })),
  };
}

function videoLink(value) {
  if (!value) return null;
  if (typeof value === 'string' && value.length <= 2000) {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
    } catch {
      // Only an HTTPS link is stored. The server does not load it.
    }
  }
  throw new ChatError(400, 'invalid_video');
}

async function send(env, id, player, request) {
  const { text, video, clientId } = await input(request);
  if (typeof clientId !== 'string' || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(clientId)) {
    throw new ChatError(400, 'invalid_input');
  }
  const body = typeof text === 'string' ? text.replace(/\r\n?/g, '\n').trim() : '';
  const link = videoLink(video);
  if ((!body && !link) || [...body].length > 2000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u.test(body)) {
    throw new ChatError(400, 'invalid_message');
  }
  const db = env.CHAT_DB;
  const now = Date.now();
  const room = await requireRoom(env, id, player, now);
  if (link && !room.coach_id && !room.direct) throw new ChatError(400, 'invalid_video');
  // One atomic insert prevents duplicate retries and concurrent bursts.
  const inserted = await db.prepare(`
    INSERT OR IGNORE INTO chat_messages (room_id, sender_id, client_id, body, video_url, sent_ms)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM chat_messages WHERE room_id = ? AND sender_id = ? AND sent_ms > ?)
      AND (? = 0 OR EXISTS (SELECT 1 FROM chat_coaching WHERE id = ? AND expires_ms > ?))
  `).bind(id, player.id, clientId, body, link, now, id, player.id, now - 1000, room.coach_id ?? 0, id, now).run();
  if (!inserted.meta.changes) {
    const existing = await db.prepare('SELECT id FROM chat_messages WHERE room_id = ? AND sender_id = ? AND client_id = ?')
      .bind(id, player.id, clientId).first();
    if (!existing) throw new ChatError(429, 'slow_down');
  }
  return { ok: true };
}

async function manage(env, player, now, request) {
  if (!ownerConfigured(env, player.id) && await channelStatus(env, player.id, true) !== 'owner') {
    throw new ChatError(403, 'manager_required');
  }
  const db = env.CHAT_DB;
  if (request.method === 'GET') {
    const [assignments, coaches] = await db.batch([
      db.prepare(`
        SELECT c.id, s.name AS student, COALESCE(coach.name, p.name) AS coach, c.expires_ms AS expires
        FROM chat_coaching c
        JOIN chat_profiles s ON s.telegram_id = c.student_id
        JOIN chat_profiles p ON p.telegram_id = c.coach_id
        LEFT JOIN chat_coaches coach ON coach.telegram_id = c.coach_id
        WHERE c.expires_ms > ? ORDER BY c.expires_ms, c.id
      `).bind(now),
      db.prepare('SELECT handle, name FROM chat_coaches ORDER BY telegram_id'),
    ]);
    return { assignments: assignments.results, coaches: coaches.results };
  }
  const data = await input(request);
  if (data.action === 'createGroup') {
    const level = data.level || null;
    if (level !== null && !levels.has(level)) throw new ChatError(400, 'invalid_level');
    await db.prepare('INSERT INTO chat_groups (id, title, level) VALUES (?, ?, ?)')
      .bind('start-' + crypto.randomUUID(), cleanName(data.title, 60), level).run();
  } else if (data.action === 'assign') {
    const { telegram_id: student } = await profileForCode(db, data.student);
    const choice = typeof data.coach === 'string' ? data.coach.trim() : '';
    const registered = choice.startsWith('@');
    const saved = registered
      ? await db.prepare('SELECT telegram_id, name FROM chat_coaches WHERE handle = ?').bind(choice.slice(1)).first()
      : null;
    if (registered && !saved) throw new ChatError(400, 'unknown_coach');
    const coach = saved?.telegram_id ?? (await profileForCode(db, choice)).telegram_id;
    const expires = data.expires;
    if (student === coach || !Number.isSafeInteger(expires) || expires <= now ||
        expires - now > 366 * 86400000) throw new ChatError(400, 'invalid_assignment');
    const changes = [];
    if (saved) {
      const code = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      changes.push(db.prepare(`
        INSERT INTO chat_profiles (telegram_id, code, name, level)
        SELECT ?, ?, ?, level FROM chat_profiles WHERE telegram_id = ?
        ON CONFLICT (telegram_id) DO NOTHING
      `).bind(coach, code, saved.name, student));
    }
    changes.push(
      db.prepare('UPDATE chat_coaching SET expires_ms = ? WHERE student_id = ? AND coach_id <> ? AND expires_ms > ?')
        .bind(now, student, coach, now),
      db.prepare(`
        INSERT INTO chat_coaching (id, student_id, coach_id, expires_ms) VALUES (?, ?, ?, ?)
        ON CONFLICT (student_id, coach_id) DO UPDATE SET expires_ms = excluded.expires_ms
      `).bind('lesson-' + crypto.randomUUID(), student, coach, expires),
    );
    await db.batch(changes);
  } else if (data.action === 'end' && /^lesson-[a-f0-9-]{36}$/.test(data.id ?? '')) {
    await db.prepare('UPDATE chat_coaching SET expires_ms = ? WHERE id = ? AND expires_ms > ?')
      .bind(now, data.id, now).run();
  } else {
    throw new ChatError(400, 'invalid_input');
  }
  return { ok: true };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    if (origin && origin !== APP_ORIGIN) return reply({ error: 'forbidden_origin' }, 403);
    const route = url.pathname;
    const room = /^\/v1\/chats\/rooms\/((?:level-[nsp]|(?:start|lesson|direct)-[a-f0-9-]{36}))$/.exec(route);
    const methods = {
      '/health': ['GET'],
      '/v1/chats': ['GET'],
      '/v1/chats/profile': ['POST'],
      '/v1/chats/manage': ['GET', 'POST'],
      '/v1/chats/find': ['POST'],
      '/v1/chats/direct': ['POST'],
    };
    const allowed = room ? ['GET', 'POST'] : methods[route];
    if (!allowed) return reply({ error: 'not_found' }, 404);
    if (request.method === 'OPTIONS') return reply(null, 204);
    if (!allowed.includes(request.method)) return reply({ error: 'method_not_allowed' }, 405);
    const db = env.CHAT_DB;
    try {
      if (route === '/health') {
        if (!db) return reply({ ok: false }, 503);
        await db.batch([
          db.prepare('SELECT code FROM chat_profiles LIMIT 0'),
          db.prepare('SELECT video_url FROM chat_messages LIMIT 0'),
          db.prepare('SELECT id FROM chat_groups LIMIT 0'),
          db.prepare('SELECT id FROM chat_coaching LIMIT 0'),
          db.prepare('SELECT handle FROM chat_coaches LIMIT 0'),
          db.prepare('SELECT id FROM chat_direct LIMIT 0'),
        ]);
        return reply({ ok: true, membershipConfigured: Boolean(env.VIP_CHANNEL_ID && env.VIP_BOT_TOKEN) });
      }
      const now = Date.now();
      const player = await authenticate(request, now);
      if (!player) return reply({ error: 'telegram_auth_required' }, 401);
      if (!db) return reply({ error: 'unavailable' }, 503);
      if (route === '/v1/chats') return reply(await overview(env, player, now));
      if (route === '/v1/chats/manage') return reply(await manage(env, player, now, request));
      if (route === '/v1/chats/find' || route === '/v1/chats/direct') {
        return reply(await contact(db, player, now, request, route === '/v1/chats/direct'));
      }
      if (route === '/v1/chats/profile') {
        const { name, level } = await input(request);
        if (!levels.has(level)) throw new ChatError(400, 'invalid_level');
        const code = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
        await db.prepare(`
          INSERT INTO chat_profiles (telegram_id, code, name, level) VALUES (?, ?, ?, ?)
          ON CONFLICT (telegram_id) DO UPDATE SET name = excluded.name, level = excluded.level
        `).bind(player.id, code, cleanName(name), level).run();
        return reply({ ok: true });
      }
      const id = room[1];
      if (request.method === 'POST') return reply(await send(env, id, player, request));
      const access = await requireRoom(env, id, player, now);
      return reply(await messages(db, access, id, player.id, url.searchParams));
    } catch (error) {
      if (error instanceof ChatError) return reply({ error: error.message }, error.status);
      console.error('Chat request failed', error.name);
      return reply({ error: 'unavailable' }, 503);
    }
  },
};
