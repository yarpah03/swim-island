import { authenticate } from '../game/worker.mjs';

const APP_ORIGIN = 'https://yarpah03.github.io';
const PAGE_SIZE = 40;
const MAX_MESSAGE_LENGTH = 8000;
const MAX_PHOTO_BYTES = 512 * 1024;
const MAX_PHOTO_SIDE = 1600;
const JPEG_PREFIX = 'data:image/jpeg;base64,';
const MAX_PHOTO_LENGTH = JPEG_PREFIX.length + 4 * Math.ceil(MAX_PHOTO_BYTES / 3);
const BOT_NAME = 'SwimIslandVIPBot';
const BOT_ID = '9271382179';
const NOTIFICATION_DELAY_MS = 7000;
const avatarEmojis = new Set(["🏊","🌊","🐬","🐟","🦈","🐢","🐙","🤿","🏅","⚡","🏝️","🔥"]);
const levels = new Set(['n', 's', 'p']);
const vipCache = new Map();

class ChatError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}

const responseHeaders = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '600',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function reply(data, status = 200) {
  const options = { status, headers: responseHeaders };
  return data === null ? new Response(null, options) : Response.json(data, options);
}

async function input(request, maxBytes = 12288) {
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
    SELECT p.telegram_id, COALESCE(pref.nickname, c.name, p.name) AS name, pref.avatar
    FROM chat_profiles p
    LEFT JOIN chat_coaches c ON c.telegram_id = p.telegram_id
    LEFT JOIN chat_preferences pref ON pref.telegram_id = p.telegram_id
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

function signedUser(request) {
  // Read extra fields only after authenticate has verified the same initData.
  return JSON.parse(new URLSearchParams(request.headers.get('Authorization').slice(4)).get('user'));
}

function decodeJpeg(value, maxLength) {
  if (typeof value !== 'string' || value.length > maxLength || !value.startsWith(JPEG_PREFIX)) return null;
  const payload = value.slice(JPEG_PREFIX.length);
  if (payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return null;
  const jpeg = atob(payload);
  const byte = position => jpeg.charCodeAt(position);
  const word = position => byte(position) * 256 + byte(position + 1);
  if (word(0) !== 0xffd8 || word(jpeg.length - 2) !== 0xffd9) return null;
  for (let offset = 2; offset + 9 < jpeg.length;) {
    if (byte(offset) !== 0xff) return null;
    const size = word(offset + 2);
    if (size < 2 || offset + 2 + size > jpeg.length) return null;
    const marker = byte(offset + 1);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      return size >= 8 ? { jpeg, height: word(offset + 5), width: word(offset + 7) } : null;
    }
    if (marker === 0xda) return null;
    offset += 2 + size;
  }
  return null;
}

function isAvatarPhoto(avatar) {
  const photo = decodeJpeg(avatar, 20500);
  return photo?.width === 160 && photo.height === 160;
}

function messagePhoto(value) {
  if (value === undefined || value === null) return null;
  const photo = decodeJpeg(value, MAX_PHOTO_LENGTH);
  if (!photo || photo.jpeg.length > MAX_PHOTO_BYTES || photo.width < 1 || photo.height < 1 ||
      Math.max(photo.width, photo.height) > MAX_PHOTO_SIDE) {
    throw new ChatError(400, 'invalid_attachment');
  }
  const bytes = new Uint8Array(photo.jpeg.length);
  for (let index = 0; index < bytes.length; index++) bytes[index] = photo.jpeg.charCodeAt(index);
  return { bytes, width: photo.width, height: photo.height };
}

async function getPhoto(db, roomId, messageId) {
  const id = Number(messageId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ChatError(400, 'invalid_input');
  const row = await db.prepare('SELECT photo FROM chat_messages WHERE room_id = ? AND id = ? AND photo IS NOT NULL')
    .bind(roomId, id).first();
  if (!row) throw new ChatError(404, 'not_found');
  // D1 sends BLOBs back as arrays of bytes.
  return new Response(new Uint8Array(row.photo), { headers: { ...responseHeaders, 'Content-Type': 'image/jpeg' } });
}

function canNotify(env) {
  return typeof env.VIP_BOT_TOKEN === 'string' && env.VIP_BOT_TOKEN.startsWith(BOT_ID + ':');
}

function publicProfile(row) {
  return { name: row.name, avatar: row.avatar || '' };
}

async function saveProfile(db, player, request) {
  const { name, level, avatar, status } = await input(request, 24576);
  if (!levels.has(level)) throw new ChatError(400, 'invalid_level');
  const nickname = cleanName(name);
  let picture = null;
  if (avatar !== undefined) {
    if (avatar !== '' && !avatarEmojis.has(avatar) && !isAvatarPhoto(avatar)) {
      throw new ChatError(400, 'invalid_avatar');
    }
    picture = avatar;
  }
  let activity = null;
  if (status !== undefined) {
    if (typeof status !== 'string') throw new ChatError(400, 'invalid_status');
    activity = status.normalize('NFC').replace(/[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu, ' ').replace(/\s+/gu, ' ').trim();
    if ([...activity].length > 80) throw new ChatError(400, 'invalid_status');
  }
  const code = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  await db.batch([
    db.prepare(
      'INSERT INTO chat_profiles (telegram_id, code, name, level) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT (telegram_id) DO UPDATE SET name = excluded.name, level = excluded.level'
    ).bind(player.id, code, nickname, level),
    db.prepare(
      "INSERT INTO chat_preferences (telegram_id, nickname, avatar, status) VALUES (?, ?, COALESCE(?, ''), COALESCE(?, '')) " +
      'ON CONFLICT (telegram_id) DO UPDATE SET ' +
      'nickname = CASE WHEN excluded.nickname IS NOT NULL OR chat_preferences.nickname IS NOT NULL THEN ? END, ' +
      'avatar = COALESCE(?, chat_preferences.avatar), status = COALESCE(?, chat_preferences.status)'
    ).bind(player.id, avatar !== undefined || status !== undefined ? nickname : null, picture, activity, nickname, picture, activity),
  ]);
  return { ok: true };
}

async function overview(env, player, now, user) {
  const db = env.CHAT_DB;
  const [profile, vip, coaching, direct, coachProfile, preferences] = await Promise.all([
    profileOf(db, player.id),
    channelStatus(env, player.id),
    db.prepare(`
      SELECT c.id, c.expires_ms, COALESCE(pref.nickname, coach.name, other.name) AS name,
        c.coach_id = ? AS coaching, pref.avatar
      FROM chat_coaching c
      JOIN chat_profiles other ON other.telegram_id = CASE WHEN c.coach_id = ? THEN c.student_id ELSE c.coach_id END
      LEFT JOIN chat_coaches coach ON coach.telegram_id = other.telegram_id
      LEFT JOIN chat_preferences pref ON pref.telegram_id = other.telegram_id
      WHERE (c.student_id = ? OR c.coach_id = ?) AND c.expires_ms > ?
      ORDER BY name, c.id
    `).bind(player.id, player.id, player.id, player.id, now).all(),
    db.prepare(`
      SELECT d.id, COALESCE(pref.nickname, c.name, p.name) AS name, pref.avatar
      FROM chat_direct d
      JOIN chat_profiles p ON p.telegram_id = CASE WHEN d.first_id = ? THEN d.second_id ELSE d.first_id END
      LEFT JOIN chat_coaches c ON c.telegram_id = p.telegram_id
      LEFT JOIN chat_preferences pref ON pref.telegram_id = p.telegram_id
      WHERE d.first_id = ? OR d.second_id = ?
      ORDER BY name, d.id
    `).bind(player.id, player.id, player.id).all(),
    db.prepare('SELECT name, handle FROM chat_coaches WHERE telegram_id = ?').bind(player.id).first(),
    db.prepare('SELECT nickname, avatar, status, notify_personal, notify_groups FROM chat_preferences WHERE telegram_id = ?').bind(player.id).first(),
  ]);
  const manager = ownerConfigured(env, player.id) || vip === 'owner';
  const groups = profile && isVip(vip) ? (await db.prepare(`
    SELECT id, title, level FROM chat_groups WHERE level IS NULL OR level = ?
    ORDER BY id NOT LIKE 'level-%', title
  `).bind(profile.level).all()).results : [];
  const rooms = [
    ...groups.map(room => ({ ...room, kind: 'group' })),
    ...coaching.results.map(row => ({
      id: row.id, title: row.name, kind: 'coaching', coaching: Boolean(row.coaching), expires: row.expires_ms,
      person: publicProfile(row),
    })),
    ...direct.results.map(row => ({ id: row.id, title: row.name, kind: 'direct', person: publicProfile(row) })),
  ];
  if (rooms.length) {
    const { results } = await db.prepare(`
      SELECT m.room_id, m.sender_id, m.sent_ms, substr(m.body, 1, 160) AS preview,
        m.video_url IS NOT NULL AS video, m.photo_width IS NOT NULL AS photo
      FROM json_each(?) room
      JOIN chat_messages m ON m.id = (
        SELECT id FROM chat_messages WHERE room_id = room.value ORDER BY id DESC LIMIT 1
      )
    `).bind(JSON.stringify(rooms.map(room => room.id))).all();
    const latest = new Map(results.map(row => [row.room_id, {
      text: row.preview, video: Boolean(row.video), photo: Boolean(row.photo),
      sent: row.sent_ms, own: row.sender_id === player.id,
    }]));
    for (const room of rooms) {
      if (latest.has(room.id)) room.latest = latest.get(room.id);
    }
  }
  return {
    profile: profile && {
      ...profile, name: preferences?.nickname ?? coachProfile?.name ?? profile.name,
      avatar: preferences?.avatar || '', status: preferences?.status || '',
    },
    suggestedName: coachProfile?.name ?? player.name,
    telegramWriteAllowed: user.allows_write_to_pm === true,
    notifications: {
      available: canNotify(env), personal: Boolean(preferences?.notify_personal), groups: Boolean(preferences?.notify_groups),
    },
    coach: coachProfile,
    vip: isVip(vip) ? 'active' : vip, manager, rooms,
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
  if (!open) return publicProfile(profile);

  const first = Math.min(player.id, target);
  const second = Math.max(player.id, target);
  const existing = await db.prepare(`
    SELECT id, 'direct' AS kind, 1 AS priority FROM chat_direct WHERE first_id = ? AND second_id = ?
    UNION ALL
    SELECT id, 'coaching' AS kind, 2 AS priority FROM chat_coaching
    WHERE student_id = ? AND coach_id = ? AND expires_ms > ?
    ORDER BY priority LIMIT 1
  `).bind(first, second, target, player.id, now).first();
  const person = publicProfile(profile);
  if (existing) return { id: existing.id, kind: existing.kind, title: profile.name, person };

  const [, selected] = await db.batch([
    db.prepare(`
      INSERT INTO chat_direct (id, first_id, second_id) VALUES (?, ?, ?)
      ON CONFLICT (first_id, second_id) DO NOTHING
    `).bind('direct-' + crypto.randomUUID(), first, second),
    db.prepare('SELECT id FROM chat_direct WHERE first_id = ? AND second_id = ?').bind(first, second),
  ]);
  return { id: selected.results[0].id, kind: 'direct', title: profile.name, person };
}

async function requireRoom(env, id, player, now) {
  const db = env.CHAT_DB;
  const profile = await profileOf(db, player.id);
  if (!profile) throw new ChatError(403, 'profile_required');
  if (id.startsWith('lesson-')) {
    const room = await db.prepare(`
      SELECT coach_id, student_id FROM chat_coaching
      WHERE id = ? AND expires_ms > ? AND (student_id = ? OR coach_id = ?)
    `).bind(id, now, player.id, player.id).first();
    if (room) return room;
    throw new ChatError(403, 'room_forbidden');
  }
  if (id.startsWith('direct-')) {
    const room = await db.prepare('SELECT first_id, second_id FROM chat_direct WHERE id = ? AND (first_id = ? OR second_id = ?)')
      .bind(id, player.id, player.id).first();
    if (room) return { ...room, direct: true };
    throw new ChatError(403, 'room_forbidden');
  }
  const group = await db.prepare('SELECT level FROM chat_groups WHERE id = ?').bind(id).first();
  if (!group || (group.level && group.level !== profile.level)) throw new ChatError(403, 'room_forbidden');
  const vip = await channelStatus(env, player.id);
  if (vip === 'unavailable') throw new ChatError(503, 'vip_unavailable');
  if (!isVip(vip)) throw new ChatError(403, 'room_forbidden');
  return { group: true, level: group.level };
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
    SELECT m.id, m.sender_id, COALESCE(pref.nickname, coach.name, p.name) AS name, m.body, m.video_url, m.sent_ms,
      m.photo_width, m.photo_height, coach.telegram_id IS NOT NULL AS registered_coach, pref.avatar
    FROM chat_messages m JOIN chat_profiles p ON p.telegram_id = m.sender_id
    LEFT JOIN chat_coaches coach ON coach.telegram_id = m.sender_id
    LEFT JOIN chat_preferences pref ON pref.telegram_id = m.sender_id
    WHERE m.room_id = ? AND m.id ${ascending ? '>' : '<'} ?
    ORDER BY m.id ${ascending ? 'ASC' : 'DESC'} LIMIT ?
  `).bind(roomId, cursor, PAGE_SIZE + 1).all();
  const page = result.results.slice(0, PAGE_SIZE);
  if (!ascending) page.reverse();
  const photos = new Map();
  const pageMessages = page.map(row => {
    const person = publicProfile(row);
    if (person.avatar.startsWith('data:image/jpeg;base64,')) {
      if (!photos.has(person.avatar)) photos.set(person.avatar, photos.size);
      person.avatar = photos.get(person.avatar);
    }
    return {
      id: row.id, name: row.name, text: row.body, video: row.video_url, sent: row.sent_ms,
      photo: row.photo_width ? { width: row.photo_width, height: row.photo_height } : null,
      own: row.sender_id === playerId, coach: row.sender_id === room.coach_id || Boolean(row.registered_coach),
      person,
    };
  });
  return { more: result.results.length > PAGE_SIZE, messages: pageMessages, photos: [...photos.keys()] };
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

async function send(env, id, player, request, ctx) {
  const { text, video, photo, clientId } = await input(request, 65536 + MAX_PHOTO_LENGTH);
  if (typeof clientId !== 'string' || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(clientId)) {
    throw new ChatError(400, 'invalid_input');
  }
  const body = typeof text === 'string'
    ? text.replace(/\r\n?|\u2028|\u2029/gu, '\n')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/gu, '')
      .trim()
    : '';
  const link = videoLink(video);
  const picture = messagePhoto(photo);
  if ((!body && !link && !picture) || [...body].length > MAX_MESSAGE_LENGTH) {
    throw new ChatError(400, 'invalid_message');
  }
  const db = env.CHAT_DB;
  const now = Date.now();
  const room = await requireRoom(env, id, player, now);
  if (link && !room.coach_id && !room.direct) throw new ChatError(400, 'invalid_video');
  // One atomic insert prevents duplicate retries and concurrent bursts.
  const inserted = await db.prepare(`
    INSERT OR IGNORE INTO chat_messages (room_id, sender_id, client_id, body, video_url, sent_ms, photo, photo_width, photo_height)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM chat_messages WHERE room_id = ? AND sender_id = ? AND sent_ms > ?)
      AND (? = 0 OR EXISTS (SELECT 1 FROM chat_coaching WHERE id = ? AND expires_ms > ?))
    RETURNING id
  `).bind(
    id, player.id, clientId, body, link, now, picture?.bytes ?? null, picture?.width ?? null, picture?.height ?? null,
    id, player.id, now - 1000, room.coach_id ?? 0, id, now
  ).first();
  const saved = inserted ?? await db.prepare('SELECT id FROM chat_messages WHERE room_id = ? AND sender_id = ? AND client_id = ?')
    .bind(id, player.id, clientId).first();
  if (!saved) throw new ChatError(429, 'slow_down');
  if (inserted && canNotify(env) && ctx) {
    ctx.waitUntil(notifyRecipients(env, room, id, player.id, saved.id)
      .catch(error => console.error('Chat alert failed', error.name)));
  }
  return { ok: true, id: saved.id };
}

async function sendAlert(env, recipient, text, start, label) {
  try {
    const response = await fetch('https://api.telegram.org/bot' + env.VIP_BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: recipient, text,
        reply_markup: { inline_keyboard: [[{ text: label, url: 'https://t.me/' + BOT_NAME + '?startapp=' + start }]] },
      }),
      signal: AbortSignal.timeout(5500),
    });
    const result = await response.json();
    if (result.ok && response.ok) return 'ok';
    if (result.error_code === 403 || result.error_code === 400 && /chat not found/i.test(result.description ?? '')) return 'blocked';
  } catch {
    // Bot notification failure is separate from delivery inside the app.
  }
  return 'unavailable';
}

async function notifyRecipients(env, room, id, sender, messageId) {
  const db = env.CHAT_DB;
  let targets;
  if (room.group) {
    const { results } = await db.prepare(`
      SELECT p.telegram_id FROM chat_preferences n JOIN chat_profiles p USING (telegram_id)
      WHERE n.notify_groups = 1 AND (? IS NULL OR p.level = ?) AND p.telegram_id <> ?
    `).bind(room.level, room.level, sender).all();
    targets = results.map(row => row.telegram_id);
  } else {
    const pair = room.direct ? [room.first_id, room.second_id] : [room.student_id, room.coach_id];
    const target = pair.find(id => id !== sender);
    const enabled = await db.prepare('SELECT notify_personal FROM chat_preferences WHERE telegram_id = ? AND notify_personal = 1').bind(target).first();
    targets = enabled ? [target] : [];
  }
  if (!targets.length) return;
  await new Promise(resolve => setTimeout(resolve, NOTIFICATION_DELAY_MS));
  if (room.coach_id && !await db.prepare('SELECT 1 FROM chat_coaching WHERE id = ? AND expires_ms > ?').bind(id, Date.now()).first()) return;

  for (let index = 0; index < targets.length; index += 6) {
    await Promise.all(targets.slice(index, index + 6).map(async recipient => {
      if (room.group && !isVip(await channelStatus(env, recipient))) return;
      const now = Date.now();
      const interval = room.group ? 60000 : 12000;
      const claimed = await db.prepare(`
        INSERT INTO chat_notification_state (telegram_id, room_id, notified_id, notified_ms)
        SELECT telegram_id, ?, ?, ? FROM chat_preferences
        WHERE telegram_id = ? AND CASE WHEN ? = 1 THEN notify_groups ELSE notify_personal END = 1
          AND (? IS NULL OR EXISTS (SELECT 1 FROM chat_profiles WHERE telegram_id = ? AND level = ?))
        ON CONFLICT (telegram_id, room_id) DO UPDATE SET notified_id = excluded.notified_id, notified_ms = excluded.notified_ms
        WHERE chat_notification_state.seen_id < excluded.notified_id
          AND chat_notification_state.notified_id < excluded.notified_id
          AND chat_notification_state.notified_ms <= ?
        RETURNING telegram_id
      `).bind(id, messageId, now, recipient, Number(Boolean(room.group)), room.level ?? null,
        recipient, room.level ?? null, now - interval).first();
      if (!claimed) return;
      await sendAlert(env, recipient, 'Новое сообщение в «Плавательном острове VIP».', 'chat_' + id, 'Открыть чат');
    }));
  }
}

async function markSeen(env, id, player, now, request) {
  const db = env.CHAT_DB;
  const { through } = await input(request, 128);
  if (!Number.isSafeInteger(through) || through <= 0) throw new ChatError(400, 'invalid_cursor');
  await requireRoom(env, id, player, now);
  await db.prepare(`
    INSERT INTO chat_notification_state (telegram_id, room_id, seen_id)
    SELECT p.telegram_id, m.room_id, m.id
    FROM chat_messages m JOIN chat_preferences p ON p.telegram_id = ?
    WHERE m.id = ? AND m.room_id = ? AND (p.notify_personal = 1 OR p.notify_groups = 1)
    ON CONFLICT (telegram_id, room_id) DO UPDATE SET seen_id = excluded.seen_id
    WHERE chat_notification_state.seen_id < excluded.seen_id
  `).bind(player.id, through, id).run();
  return { ok: true };
}

async function saveNotifications(env, player, request) {
  const db = env.CHAT_DB;
  if (!await profileOf(db, player.id)) throw new ChatError(403, 'profile_required');
  const { action, personal, groups } = await input(request, 1024);
  if (action === 'test') {
    if (!canNotify(env)) throw new ChatError(503, 'notifications_unavailable');
    const now = Date.now();
    const claimed = await db.prepare(`
      INSERT INTO chat_notification_state (telegram_id, room_id, notified_ms)
      SELECT telegram_id, 'test', ? FROM chat_preferences
      WHERE telegram_id = ? AND (notify_personal = 1 OR notify_groups = 1)
      ON CONFLICT (telegram_id, room_id) DO UPDATE SET notified_ms = excluded.notified_ms
      WHERE chat_notification_state.notified_ms <= ?
      RETURNING telegram_id
    `).bind(now, player.id, now - 60000).first();
    if (!claimed) throw new ChatError(429, 'notification_test_wait');
    const result = await sendAlert(env, player.id, 'Проверка уведомлений «Плавательного острова VIP».', 'profile', 'Открыть приложение');
    if (result !== 'ok') throw new ChatError(503, 'notification_' + result);
  } else {
    if (typeof personal !== 'boolean' || typeof groups !== 'boolean') throw new ChatError(400, 'invalid_input');
    if ((personal || groups) && !canNotify(env)) throw new ChatError(503, 'notifications_unavailable');
    await db.prepare(`
      INSERT INTO chat_preferences (telegram_id, notify_personal, notify_groups) VALUES (?, ?, ?)
      ON CONFLICT (telegram_id) DO UPDATE SET notify_personal = excluded.notify_personal, notify_groups = excluded.notify_groups
    `).bind(player.id, Number(personal), Number(groups)).run();
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
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    if (origin && origin !== APP_ORIGIN) return reply({ error: 'forbidden_origin' }, 403);
    const route = url.pathname;
    const room = /^\/v1\/chats\/rooms\/((?:level-[nsp]|(?:start|lesson|direct)-[a-f0-9-]{36}))(?:\/(read)|\/photos\/(\d+))?$/.exec(route);
    const methods = {
      '/health': ['GET'],
      '/v1/chats': ['GET'],
      '/v1/chats/profile': ['POST'],
      '/v1/chats/notifications': ['POST'],
      '/v1/chats/manage': ['GET', 'POST'],
      '/v1/chats/find': ['POST'],
      '/v1/chats/direct': ['POST'],
    };
    let allowed = methods[route];
    if (room) {
      allowed = ['GET', 'POST'];
      if (room[2]) allowed = ['POST'];
      if (room[3]) allowed = ['GET'];
    }
    if (!allowed) return reply({ error: 'not_found' }, 404);
    if (request.method === 'OPTIONS') return reply(null, 204);
    if (!allowed.includes(request.method)) return reply({ error: 'method_not_allowed' }, 405);
    const db = env.CHAT_DB;
    try {
      if (route === '/health') {
        if (!db) return reply({ ok: false }, 503);
        await db.batch([
          db.prepare('SELECT code FROM chat_profiles LIMIT 0'),
          db.prepare('SELECT video_url, photo, photo_width, photo_height FROM chat_messages LIMIT 0'),
          db.prepare('SELECT id FROM chat_groups LIMIT 0'),
          db.prepare('SELECT id FROM chat_coaching LIMIT 0'),
          db.prepare('SELECT handle FROM chat_coaches LIMIT 0'),
          db.prepare('SELECT id FROM chat_direct LIMIT 0'),
          db.prepare('SELECT avatar FROM chat_preferences LIMIT 0'),
          db.prepare('SELECT seen_id FROM chat_notification_state LIMIT 0'),
        ]);
        return reply({ ok: true, membershipConfigured: Boolean(env.VIP_CHANNEL_ID && env.VIP_BOT_TOKEN), notificationsConfigured: canNotify(env) });
      }
      const now = Date.now();
      const player = await authenticate(request, now);
      if (!player) return reply({ error: 'telegram_auth_required' }, 401);
      if (!db) return reply({ error: 'unavailable' }, 503);
      if (route === '/v1/chats') return reply(await overview(env, player, now, signedUser(request)));
      if (route === '/v1/chats/notifications') return reply(await saveNotifications(env, player, request));
      if (route === '/v1/chats/manage') return reply(await manage(env, player, now, request));
      if (route === '/v1/chats/find' || route === '/v1/chats/direct') {
        return reply(await contact(db, player, now, request, route === '/v1/chats/direct'));
      }
      if (route === '/v1/chats/profile') return reply(await saveProfile(db, player, request));
      const id = room[1];
      if (room[2]) return reply(await markSeen(env, id, player, now, request));
      if (request.method === 'POST') return reply(await send(env, id, player, request, ctx));
      const access = await requireRoom(env, id, player, now);
      if (room[3]) return await getPhoto(db, id, room[3]);
      return reply(await messages(db, access, id, player.id, url.searchParams));
    } catch (error) {
      if (error instanceof ChatError) return reply({ error: error.message }, error.status);
      console.error('Chat request failed', error.name);
      return reply({ error: 'unavailable' }, 503);
    }
  },
};
