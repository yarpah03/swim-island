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
const TELEGRAM_TEXT_LIMIT = 4096;
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
    WHERE p.code = ? AND p.telegram_id > 0
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
  const group = await db.prepare('SELECT title, level FROM chat_groups WHERE id = ?').bind(id).first();
  if (!group || (group.level && group.level !== profile.level)) throw new ChatError(403, 'room_forbidden');
  const vip = await channelStatus(env, player.id);
  if (vip === 'unavailable') throw new ChatError(503, 'vip_unavailable');
  if (!isVip(vip)) throw new ChatError(403, 'room_forbidden');
  return { group: true, title: group.title, level: group.level };
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
    const message = { id: saved.id, body, photo: Boolean(picture), video: Boolean(link) };
    ctx.waitUntil(notifyRecipients(env, room, id, player.id, message)
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
        link_preview_options: { is_disabled: true },
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

function notificationText(name, room, message) {
  const heading = room.group ? name + ' · ' + room.title : name;
  const media = [message.photo && '📷 Фото', message.video && '🎥 Видео'].filter(Boolean).join(' · ');
  const text = heading + '\n' + [media, message.body].filter(Boolean).join(' — ');
  if (text.length <= TELEGRAM_TEXT_LIMIT) return text;
  return text.slice(0, TELEGRAM_TEXT_LIMIT - 1).replace(/[\uD800-\uDBFF]$/u, '').trimEnd() + '…';
}

async function notifyRecipients(env, room, id, sender, message) {
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
  const profile = await db.prepare(`
    SELECT COALESCE(pref.nickname, coach.name, p.name) AS name
    FROM chat_profiles p
    LEFT JOIN chat_coaches coach ON coach.telegram_id = p.telegram_id
    LEFT JOIN chat_preferences pref ON pref.telegram_id = p.telegram_id
    WHERE p.telegram_id = ?
  `).bind(sender).first();
  const text = notificationText(profile?.name || 'Участник', room, message);

  for (let index = 0; index < targets.length; index += 6) {
    await Promise.all(targets.slice(index, index + 6).map(async recipient => {
      if (room.group && !isVip(await channelStatus(env, recipient, true))) return;
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
      `).bind(id, message.id, now, recipient, Number(Boolean(room.group)), room.level ?? null,
        recipient, room.level ?? null, now - interval).first();
      if (!claimed) return;
      await sendAlert(env, recipient, text, 'chat_' + id, 'Открыть чат');
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
  await requireManager(env, player.id);
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
    await endCoaching(db, data.id, now);
  } else {
    throw new ChatError(400, 'invalid_input');
  }
  return { ok: true };
}

async function endCoaching(db, room, now) {
  await db.batch([
    db.prepare('UPDATE chat_coaching SET expires_ms = min(expires_ms, ?) WHERE id = ?').bind(now, room),
    db.prepare('UPDATE chat_web_clients SET code_hash = NULL WHERE room_id = ?').bind(room),
    db.prepare('DELETE FROM chat_web_sessions WHERE student_id = (SELECT student_id FROM chat_web_clients WHERE room_id = ?)').bind(room),
    db.prepare('UPDATE chat_web_accounts SET claimable = 0 WHERE room_id = ?').bind(room),
    db.prepare('DELETE FROM chat_web_account_sessions WHERE account_id = ?').bind(room),
  ]);
}

const WEB_ORIGIN = 'https://swim-island-chats.pages.dev';
const WEB_COOKIE = '__Host-swim-client';
const WEB_TOKEN = /^[a-f0-9]{64}$/;
const WEB_ROOM = /^lesson-[a-f0-9-]{36}$/;
const WEB_CODE_TTL = 15 * 60_000;
const WEB_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const WEB_CODE_WINDOW = 60 * 60_000;

function webMailReady(env) {
  return typeof env.WEB_MAIL_KEY === 'string' && WEB_TOKEN.test(env.WEB_MAIL_KEY) &&
    typeof env.WEB_MAIL_URL === 'string' &&
    /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(env.WEB_MAIL_URL);
}

function webHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function webToken() {
  return webHex(crypto.getRandomValues(new Uint8Array(32)));
}

async function webTokenHash(token) {
  return webHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
}

async function webSignature(env, value) {
  const text = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', text.encode(env.WEB_MAIL_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return webHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, text.encode(value))));
}

function webEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]{1,64}@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+$/i.test(email)) {
    throw new ChatError(400, 'invalid_email');
  }
  return email;
}

function webCookieToken(request, role = 'client') {
  const key = role === 'partner' ? PARTNER_COOKIE : WEB_COOKIE;
  const value = request.headers.get('Cookie')?.split(';').find(item => item.trim().startsWith(key + '='));
  const token = value?.trim().slice(key.length + 1);
  return token && WEB_TOKEN.test(token) ? token : null;
}

function webCookie(token, maxAge, role = 'client') {
  const key = role === 'partner' ? PARTNER_COOKIE : WEB_COOKIE;
  return key + '=' + token + '; Path=/; Max-Age=' + maxAge + '; Secure; HttpOnly; SameSite=Strict';
}

async function webGuestForToken(db, token) {
  if (typeof token !== 'string' || !WEB_TOKEN.test(token)) throw new ChatError(403, 'web_invite_invalid');
  const client = await db.prepare(`
    SELECT w.student_id, w.email, w.invite_hash, c.expires_ms FROM chat_web_clients w
    JOIN chat_coaching c ON c.id = w.room_id
    WHERE w.invite_hash = ? AND NOT EXISTS (SELECT 1 FROM chat_web_accounts WHERE id = w.room_id)
  `).bind(await webTokenHash(token)).first();
  if (!client) throw new ChatError(403, 'web_invite_invalid');
  return client;
}

async function webSession(db, request, now, role = 'client') {
  const session = await accountSession(db, request, role, now);
  if (session || role === 'partner') return session;
  const token = webCookieToken(request);
  if (!token) return null;
  return db.prepare(`
    SELECT w.student_id AS id, w.room_id AS room, w.invite_hash, c.expires_ms AS expires
    FROM chat_web_sessions s JOIN chat_web_clients w USING (student_id)
    JOIN chat_coaching c ON c.id = w.room_id
    WHERE s.token_hash = ? AND s.expires_ms > ? AND c.expires_ms > ?
      AND NOT EXISTS (SELECT 1 FROM chat_web_accounts WHERE id = w.room_id)
  `).bind(await webTokenHash(token), now, now).first();
}

async function issueWebCode(env, id, now, inviteHash = null) {
  const code = Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => WEB_ALPHABET[byte & 31]).join('');
  const hash = await webTokenHash('code:' + id + ':' + code);
  const validUntil = now + WEB_CODE_TTL;
  const row = await env.CHAT_DB.prepare(`
    UPDATE chat_web_clients
    SET code_hash = ?, code_expires_ms = ?, code_attempts = 0, last_code_ms = ?,
      code_count = CASE WHEN code_window_ms > ? THEN code_count + 1 ELSE 1 END,
      code_window_ms = CASE WHEN code_window_ms > ? THEN code_window_ms ELSE ? END
    WHERE student_id = ? AND (? IS NULL OR invite_hash = ?) AND last_code_ms <= ?
      AND (code_window_ms <= ? OR code_count < 5)
      AND EXISTS (SELECT 1 FROM chat_coaching WHERE id = room_id AND expires_ms > ?)
    RETURNING email
  `).bind(hash, validUntil, now, now - WEB_CODE_WINDOW, now - WEB_CODE_WINDOW, now,
    id, inviteHash, inviteHash, now - 60_000, now - WEB_CODE_WINDOW, now).first();
  if (!row) throw new ChatError(429, 'web_code_wait');
  return { code, email: row.email, validUntil };
}

async function mailWebCode(env, client, now) {
  if (!webMailReady(env)) throw new ChatError(503, 'web_mail_unavailable');
  const { code, email } = await issueWebCode(env, client.student_id, now, client.invite_hash);
  const payload = JSON.stringify({ email, code, issuedAt: now, id: crypto.randomUUID() });
  try {
    const response = await fetch(env.WEB_MAIL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload, signature: await webSignature(env, 'mail:' + payload) }),
      signal: AbortSignal.timeout(12_000),
    });
    if (response.ok && (await response.json()).ok === true) return { ok: true };
  } catch {
    // The current code remains valid if the mail provider accepted the request.
  }
  throw new ChatError(503, 'web_mail_unavailable');
}

async function verifyWebCode(db, client, value, now) {
  const code = typeof value === 'string' ? value.replace(/[\s-]/g, '').toUpperCase() : '';
  if (!/^[A-HJ-NP-Z2-9]{12}$/.test(code)) throw new ChatError(400, 'web_code_invalid');
  const hash = await webTokenHash('code:' + client.student_id + ':' + code);
  const inviteHash = client.invite_hash;
  const claim = await db.prepare(`
    UPDATE chat_web_clients SET code_attempts = code_attempts + 1
    WHERE student_id = ? AND invite_hash = ? AND code_hash IS NOT NULL AND code_expires_ms > ?
      AND code_attempts < 5
      AND EXISTS (SELECT 1 FROM chat_coaching WHERE id = room_id AND expires_ms > ?)
    RETURNING code_hash = ? AS matches
  `).bind(client.student_id, inviteHash, now, now, hash).first();
  if (!claim?.matches) throw new ChatError(400, 'web_code_invalid');

  const token = webToken();
  const expires = Math.min(client.expires_ms, now + 30 * 86400_000);
  const [session] = await db.batch([
    db.prepare(`
      INSERT INTO chat_web_sessions (token_hash, student_id, expires_ms)
      SELECT ?, w.student_id, min(?, c.expires_ms) FROM chat_web_clients w
      JOIN chat_coaching c ON c.id = w.room_id
      WHERE w.student_id = ? AND w.code_hash = ? AND w.invite_hash = ? AND w.code_expires_ms > ? AND c.expires_ms > ?
    `).bind(await webTokenHash(token), expires, client.student_id, hash, inviteHash, now, now),
    db.prepare(`
      UPDATE chat_web_clients SET code_hash = NULL, verified_ms = coalesce(verified_ms, ?)
      WHERE student_id = ? AND code_hash = ? AND invite_hash = ?
    `).bind(now, client.student_id, hash, inviteHash),
    db.prepare('DELETE FROM chat_web_sessions WHERE student_id = ? AND expires_ms <= ?').bind(client.student_id, now),
  ]);
  if (!session.meta.changes) throw new ChatError(400, 'web_code_invalid');
  return webReply({ ok: true }, 200, webCookie(token, Math.ceil((expires - now) / 1000)));
}

function webDate(expires, now) {
  if (!Number.isSafeInteger(expires) || expires <= now || expires - now > 366 * 86400_000) {
    throw new ChatError(400, 'invalid_assignment');
  }
  return expires;
}

function webInvite(token) {
  return WEB_ORIGIN + '/client/#invite=' + token;
}

async function manageWebClients(env, player, now, request) {
  const db = env.CHAT_DB;
  if (!await db.prepare('SELECT 1 FROM chat_coaches WHERE telegram_id = ?').bind(player.id).first()) {
    throw new ChatError(403, 'coach_required');
  }
  if (request.method === 'GET') {
    const { results } = await db.prepare(`
      SELECT * FROM (
        SELECT a.id, a.label, a.display_name AS name, NULL AS email, a.password_hash IS NOT NULL AS entered, c.expires_ms AS expires
        FROM chat_web_accounts a JOIN chat_coaching c ON c.id = a.room_id
        WHERE c.coach_id = ? AND a.role = 'client'
        UNION ALL
        SELECT w.room_id AS id, p.name AS label, p.name, w.email, w.verified_ms IS NOT NULL AS entered, c.expires_ms AS expires
        FROM chat_web_clients w JOIN chat_profiles p ON p.telegram_id = w.student_id
        JOIN chat_coaching c ON c.id = w.room_id
        WHERE w.coach_id = ? AND NOT EXISTS (SELECT 1 FROM chat_web_accounts WHERE id = w.room_id)
      ) ORDER BY expires <= ?, label, id
    `).bind(player.id, player.id, now).all();
    return { clients: results, mail: webMailReady(env) };
  }
  const data = await input(request);
  if (data.action === 'invite') {
    return createNamedInvite(db, player, 'client', cleanName(data.label, 60), webDate(data.expires, now));
  }
  if (data.action === 'create') {
    const name = cleanName(data.name);
    const email = webEmail(data.email);
    const expires = webDate(data.expires, now);
    if (!await profileOf(db, player.id)) throw new ChatError(403, 'profile_required');
    const number = crypto.getRandomValues(new Uint32Array(2));
    const id = -((number[0] & 0xfffff) * 4294967296 + number[1] + 1);
    const room = 'lesson-' + crypto.randomUUID();
    const invite = webToken();
    try {
      await db.batch([
        db.prepare("INSERT INTO chat_profiles (telegram_id, code, name, level) VALUES (?, ?, ?, 'n')")
          .bind(id, webToken().slice(0, 12), name),
        db.prepare('INSERT INTO chat_coaching (id, student_id, coach_id, expires_ms) VALUES (?, ?, ?, ?)')
          .bind(room, id, player.id, expires),
        db.prepare('INSERT INTO chat_web_clients (student_id, coach_id, room_id, email, invite_hash) VALUES (?, ?, ?, ?, ?)')
          .bind(id, player.id, room, email, await webTokenHash(invite)),
      ]);
    } catch (error) {
      if (await db.prepare('SELECT 1 FROM chat_web_clients WHERE coach_id = ? AND email = ?').bind(player.id, email).first()) {
        throw new ChatError(409, 'web_client_exists');
      }
      throw error;
    }
    return { id: room, name, invite: webInvite(invite) };
  }
  if (typeof data.id !== 'string' || !WEB_ROOM.test(data.id)) throw new ChatError(400, 'invalid_input');
  const client = await db.prepare(`
    SELECT c.student_id, c.expires_ms, a.id AS account_id, coalesce(a.label, p.name) AS label
    FROM chat_coaching c JOIN chat_profiles p ON p.telegram_id = c.student_id
    LEFT JOIN chat_web_clients w ON w.room_id = c.id
    LEFT JOIN chat_web_accounts a ON a.room_id = c.id
    WHERE c.coach_id = ? AND c.id = ? AND (a.id IS NOT NULL OR w.room_id IS NOT NULL)
  `).bind(player.id, data.id).first();
  if (!client) throw new ChatError(403, 'room_forbidden');
  if (data.action === 'renew') {
    await db.prepare('UPDATE chat_coaching SET expires_ms = ? WHERE id = ? AND coach_id = ?')
      .bind(webDate(data.expires, now), data.id, player.id).run();
    return { ok: true };
  }
  if (data.action === 'replace') {
    if (client.expires_ms <= now) throw new ChatError(403, 'web_access_ended');
    if (client.account_id) return resetNamedInvite(db, 'client', data.id, client.label, now);
    const token = webToken();
    await db.batch([
      db.prepare('INSERT INTO chat_web_accounts (id, role, owner_id, room_id, label, invite_hash) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(data.id, 'client', player.id, data.id, client.label, await webTokenHash(token)),
      db.prepare('UPDATE chat_web_clients SET code_hash = NULL WHERE room_id = ?').bind(data.id),
      db.prepare('DELETE FROM chat_web_sessions WHERE student_id = ?').bind(client.student_id),
    ]);
    return { id: data.id, label: client.label, invite: namedInviteUrl('client', token) };
  }
  if (data.action === 'code' && !client.account_id) {
    if (client.expires_ms <= now) throw new ChatError(403, 'web_access_ended');
    return issueWebCode(env, client.student_id, now);
  }
  const clearSessions = db.prepare('DELETE FROM chat_web_sessions WHERE student_id = ?').bind(client.student_id);
  if (data.action === 'rotate' && !client.account_id) {
    if (client.expires_ms <= now) throw new ChatError(403, 'web_access_ended');
    const invite = webToken();
    await db.batch([
      db.prepare('UPDATE chat_web_clients SET invite_hash = ?, code_hash = NULL WHERE student_id = ?')
        .bind(await webTokenHash(invite), client.student_id),
      clearSessions,
    ]);
    return { id: data.id, invite: webInvite(invite) };
  }
  if (data.action === 'end') {
    await endCoaching(db, data.id, now);
    return { ok: true };
  }
  throw new ChatError(400, 'invalid_input');
}

function webReply(data, status = 200, cookie) {
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
  if (cookie) headers['Set-Cookie'] = cookie;
  return Response.json(data, { status, headers });
}

async function webOverview(db, player, now) {
  const room = await db.prepare(`
    SELECT c.id, c.expires_ms, COALESCE(pref.nickname, coach.name, p.name) AS name, pref.avatar
    FROM chat_coaching c JOIN chat_profiles p ON p.telegram_id = c.coach_id
    LEFT JOIN chat_coaches coach ON coach.telegram_id = p.telegram_id
    LEFT JOIN chat_preferences pref ON pref.telegram_id = p.telegram_id
    WHERE c.id = ? AND c.student_id = ? AND c.expires_ms > ?
  `).bind(player.room, player.id, now).first();
  if (!room) throw new ChatError(403, 'web_access_ended');
  return { rooms: [{ id: room.id, title: room.name, person: publicProfile(room), kind: 'coaching', expires: room.expires_ms }] };
}

const PARTNER_ID = 'partner-[a-f0-9-]{36}';
const PARTNER_MATERIAL_ID = 'material-[a-f0-9-]{36}';
const PARTNER_ROUTE = new RegExp('^/v1/(?:chats|client)/partners(?:/(' + PARTNER_ID + ')(?:/(' + PARTNER_MATERIAL_ID + '))?)?$');
const PARTNER_COOKIE = '__Host-swim-partner';
const LOGIN_WINDOW_MS = 10 * 60_000;
const SESSION_MS = 30 * 86400_000;
const LOGIN_ATTEMPTS = 7;

function accountLogin(value) {
  const name = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(name)) throw new ChatError(400, 'web_login_format');
  return name;
}

function accountProof(value) {
  if (typeof value !== 'string' || !WEB_TOKEN.test(value)) throw new ChatError(400, 'web_password_format');
  return value;
}

function sameDigest(left, right) {
  if (typeof left !== 'string' || left.length !== right.length) return false;
  let different = 0;
  for (let i = 0; i < right.length; i++) different |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return different === 0;
}

async function namedInvite(db, role, token) {
  if (typeof token !== 'string' || !WEB_TOKEN.test(token)) return null;
  return db.prepare(`
    SELECT a.id, a.room_id, a.invite_hash, a.claimable, a.disabled_ms, c.student_id, c.expires_ms
    FROM chat_web_accounts a LEFT JOIN chat_coaching c ON c.id = a.room_id
    WHERE a.role = ? AND a.invite_hash = ?
  `).bind(role, await webTokenHash(token)).first();
}

function activeAccount(row, now) {
  return Boolean(row && row.disabled_ms === null && (!row.room_id || row.expires_ms > now));
}

async function accountSession(db, request, role, now) {
  const token = webCookieToken(request, role);
  if (!token) return null;
  const hash = await webTokenHash(token);
  return db.prepare(`
    SELECT a.id AS account, a.invite_hash, a.room_id AS room, c.student_id AS id, c.expires_ms AS expires
    FROM chat_web_account_sessions s JOIN chat_web_accounts a ON a.id = s.account_id
    LEFT JOIN chat_coaching c ON c.id = a.room_id
    WHERE s.token_hash = ? AND s.expires_ms > ? AND a.role = ? AND a.disabled_ms IS NULL
      AND (a.room_id IS NULL OR c.expires_ms > ?)
  `).bind(hash, now, role, now).first();
}

function namedInviteUrl(role, token) {
  return WEB_ORIGIN + '/' + role + '/#invite=' + token;
}

async function createNamedInvite(db, player, role, label, expires) {
  const token = webToken();
  const hash = await webTokenHash(token);
  const id = (role === 'client' ? 'lesson-' : 'partner-') + crypto.randomUUID();
  const account = db.prepare('INSERT INTO chat_web_accounts (id, role, owner_id, room_id, label, invite_hash) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, role, player.id, role === 'client' ? id : null, label, hash);
  if (role === 'client') {
    if (!await profileOf(db, player.id)) throw new ChatError(403, 'profile_required');
    const number = crypto.getRandomValues(new Uint32Array(2));
    const guestId = -((number[0] & 0xfffff) * 4294967296 + number[1] + 1);
    await db.batch([
      db.prepare("INSERT INTO chat_profiles (telegram_id, code, name, level) VALUES (?, ?, ?, 'n')")
        .bind(guestId, webToken().slice(0, 12), label),
      db.prepare('INSERT INTO chat_coaching (id, student_id, coach_id, expires_ms) VALUES (?, ?, ?, ?)')
        .bind(id, guestId, player.id, expires),
      account,
    ]);
  } else {
    await account.run();
  }
  return { id, label, invite: namedInviteUrl(role, token) };
}

async function resetNamedInvite(db, role, id, label, now) {
  const token = webToken();
  const hash = await webTokenHash(token);
  const account = db.prepare(`
    UPDATE chat_web_accounts SET invite_hash = ?, claimable = 1, password_hash = NULL,
      password_salt = NULL, login_attempts = 0
    WHERE id = ? AND disabled_ms IS NULL
      AND (room_id IS NULL OR EXISTS (SELECT 1 FROM chat_coaching WHERE id = room_id AND expires_ms > ?))
  `).bind(hash, id, now);
  const resetSessions = db.prepare('DELETE FROM chat_web_account_sessions WHERE account_id = ?').bind(id);
  const [updated] = await db.batch([account, resetSessions]);
  if (!updated.meta.changes) throw new ChatError(403, 'web_access_ended');
  return { id, label, invite: namedInviteUrl(role, token) };
}

async function registerNamedAccount(db, role, data, now) {
  const account = await namedInvite(db, role, data.invite);
  if (!account) throw new ChatError(403, 'web_invite_invalid');
  if (!activeAccount(account, now)) throw new ChatError(403, 'web_access_ended');
  if (!account.claimable) throw new ChatError(409, 'web_invite_used');
  const login = accountLogin(data.login);
  const proof = accountProof(data.proof);
  const name = cleanName(data.name);
  const salt = webToken();
  // The browser stretches the password with PBKDF2. Store a separate salted hash of that proof.
  const hash = await webTokenHash('password:' + salt + ':' + proof);
  const token = webToken();
  const expires = Math.min(now + SESSION_MS, account.expires_ms ?? Infinity);
  let results;
  try {
    results = await db.batch([
      db.prepare(`
        UPDATE chat_web_accounts
        SET display_name = ?, login = ?, password_salt = ?, password_hash = ?, claimable = 0, login_attempts = 0
        WHERE id = ? AND invite_hash = ? AND claimable = 1 AND disabled_ms IS NULL
          AND (room_id IS NULL OR EXISTS (SELECT 1 FROM chat_coaching WHERE id = room_id AND expires_ms > ?))
      `).bind(name, login, salt, hash, account.id, account.invite_hash, now),
      db.prepare(`
        UPDATE chat_profiles SET name = ? WHERE telegram_id = ?
          AND EXISTS (SELECT 1 FROM chat_web_accounts WHERE id = ? AND password_salt = ?)
      `).bind(name, account.student_id, account.id, salt),
      db.prepare(`
        INSERT INTO chat_web_account_sessions (token_hash, account_id, expires_ms)
        SELECT ?, id, ? FROM chat_web_accounts WHERE id = ? AND password_salt = ?
      `).bind(await webTokenHash(token), expires, account.id, salt),
    ]);
  } catch (error) {
    const taken = await db.prepare('SELECT 1 FROM chat_web_accounts WHERE login = ? AND id <> ?').bind(login, account.id).first();
    if (taken) throw new ChatError(409, 'web_login_taken');
    throw error;
  }
  if (!results[0].meta.changes || !results[2].meta.changes) throw new ChatError(409, 'web_invite_used');
  return webReply({ ok: true }, 200, webCookie(token, Math.ceil((expires - now) / 1000), role));
}

async function loginNamedAccount(db, role, data, now) {
  const login = accountLogin(data.login);
  const proof = accountProof(data.proof);
  const account = await db.prepare(`
    SELECT a.id, a.room_id, a.disabled_ms, a.password_hash, a.password_salt, c.expires_ms
    FROM chat_web_accounts a LEFT JOIN chat_coaching c ON c.id = a.room_id
    WHERE a.role = ? AND a.login = ?
  `).bind(role, login).first();
  if (!account?.password_hash || !activeAccount(account, now)) throw new ChatError(401, 'web_login_invalid');
  const attempt = await db.prepare(`
    UPDATE chat_web_accounts SET
      login_attempts = CASE WHEN login_window_ms > ? THEN login_attempts + 1 ELSE 1 END,
      login_window_ms = CASE WHEN login_window_ms > ? THEN login_window_ms ELSE ? END
    WHERE id = ? AND password_salt = ? AND disabled_ms IS NULL
      AND (login_window_ms <= ? OR login_attempts < ?)
    RETURNING id
  `).bind(now - LOGIN_WINDOW_MS, now - LOGIN_WINDOW_MS, now, account.id, account.password_salt,
    now - LOGIN_WINDOW_MS, LOGIN_ATTEMPTS).first();
  if (!attempt) throw new ChatError(429, 'web_login_wait');
  const hash = await webTokenHash('password:' + account.password_salt + ':' + proof);
  if (!sameDigest(account.password_hash, hash)) throw new ChatError(401, 'web_login_invalid');

  const token = webToken();
  const expires = Math.min(now + SESSION_MS, account.expires_ms ?? Infinity);
  const [saved] = await db.batch([
    db.prepare(`
      INSERT INTO chat_web_account_sessions (token_hash, account_id, expires_ms)
      SELECT ?, a.id, ? FROM chat_web_accounts a LEFT JOIN chat_coaching c ON c.id = a.room_id
      WHERE a.id = ? AND a.password_salt = ? AND a.disabled_ms IS NULL
        AND (a.room_id IS NULL OR c.expires_ms > ?)
    `).bind(await webTokenHash(token), expires, account.id, account.password_salt, now),
    db.prepare('UPDATE chat_web_accounts SET login_attempts = 0 WHERE id = ? AND password_salt = ?')
      .bind(account.id, account.password_salt),
    db.prepare('DELETE FROM chat_web_account_sessions WHERE account_id = ? AND expires_ms <= ?')
      .bind(account.id, now),
  ]);
  if (!saved.meta.changes) throw new ChatError(401, 'web_login_invalid');
  return webReply({ ok: true }, 200, webCookie(token, Math.ceil((expires - now) / 1000), role));
}

async function requireManager(env, id) {
  if (!ownerConfigured(env, id) && await channelStatus(env, id, true) !== 'owner') {
    throw new ChatError(403, 'manager_required');
  }
}

async function managePartnerInvites(env, player, request, now) {
  await requireManager(env, player.id);
  const db = env.CHAT_DB;
  if (request.method === 'GET') {
    const { results } = await db.prepare(`
      SELECT id, label, display_name AS name, password_hash IS NOT NULL AS entered, disabled_ms IS NULL AS active
      FROM chat_web_accounts WHERE role = 'partner' ORDER BY label, id
    `).all();
    return { clients: results };
  }
  const data = await input(request, 4096);
  if (data.action === 'invite') return createNamedInvite(db, player, 'partner', cleanName(data.label, 60));
  const row = await db.prepare("SELECT id, label, disabled_ms FROM chat_web_accounts WHERE id = ? AND role = 'partner'")
    .bind(typeof data.id === 'string' ? data.id : '').first();
  if (!row) throw new ChatError(404, 'not_found');
  if (data.action === 'replace') {
    if (row.disabled_ms !== null) throw new ChatError(403, 'web_access_ended');
    return resetNamedInvite(db, 'partner', row.id, row.label, now);
  }
  if (data.action === 'end') {
    await db.batch([
      db.prepare('UPDATE chat_web_accounts SET disabled_ms = ?, claimable = 0 WHERE id = ?').bind(now, row.id),
      db.prepare('DELETE FROM chat_web_account_sessions WHERE account_id = ?').bind(row.id),
    ]);
    return { ok: true };
  }
  if (data.action === 'activate') {
    await db.prepare('UPDATE chat_web_accounts SET disabled_ms = NULL WHERE id = ?').bind(row.id).run();
    return { ok: true };
  }
  throw new ChatError(400, 'invalid_input');
}

const partnerCardFields = 'id, kind, title, description, updated_ms AS updated';

async function publishedPartners(db, id, material) {
  if (!id) {
    const { results } = await db.prepare(`
      SELECT id, display_name AS name, bio
      FROM chat_web_accounts WHERE role = 'partner' AND display_name IS NOT NULL AND disabled_ms IS NULL
      ORDER BY display_name, id
    `).all();
    return { partners: results };
  }
  const partner = await db.prepare(`
    SELECT id, display_name AS name, bio FROM chat_web_accounts
    WHERE id = ? AND role = 'partner' AND display_name IS NOT NULL AND disabled_ms IS NULL
  `).bind(id).first();
  if (!partner) throw new ChatError(404, 'not_found');
  if (material) {
    const item = await db.prepare(
      'SELECT ' + partnerCardFields + ', body, video_url AS video FROM chat_partner_materials WHERE id = ? AND partner_id = ? AND published = 1'
    ).bind(material, id).first();
    if (!item) throw new ChatError(404, 'not_found');
    return { partner, item };
  }
  const { results } = await db.prepare(
    'SELECT ' + partnerCardFields + ' FROM chat_partner_materials WHERE partner_id = ? AND published = 1 ORDER BY updated_ms DESC, id'
  ).bind(id).all();
  return { partner, items: results };
}

function partnerText(value, max, required = false) {
  const text = typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
  if ((required && !text) || text.length > max) throw new ChatError(400, 'partner_material_invalid');
  return text;
}

async function partnerDesk(db, id, now, request, materialId) {
  if (request.method === 'GET') {
    if (materialId) {
      const item = await db.prepare(
        'SELECT ' + partnerCardFields + ', body, video_url AS video, published FROM chat_partner_materials WHERE id = ? AND partner_id = ?'
      ).bind(materialId, id).first();
      if (!item) throw new ChatError(404, 'not_found');
      return { item };
    }
    const [profile, items] = await db.batch([
      db.prepare('SELECT display_name AS name, bio FROM chat_web_accounts WHERE id = ?').bind(id),
      db.prepare('SELECT ' + partnerCardFields + ', published FROM chat_partner_materials WHERE partner_id = ? ORDER BY updated_ms DESC, id').bind(id),
    ]);
    return { profile: profile.results[0], items: items.results };
  }
  if (request.method !== 'POST' || materialId) throw new ChatError(405, 'method_not_allowed');
  const data = await input(request, 80000);
  if (data.action === 'profile') {
    const saved = await db.prepare('UPDATE chat_web_accounts SET display_name = ?, bio = ? WHERE id = ? AND disabled_ms IS NULL')
      .bind(cleanName(data.name), partnerText(data.bio, 1000), id).run();
    if (!saved.meta.changes) throw new ChatError(403, 'web_access_ended');
    return { ok: true };
  }
  if (data.action === 'hide') {
    const saved = await db.prepare('UPDATE chat_partner_materials SET published = 0, updated_ms = ? WHERE id = ? AND partner_id = ?')
      .bind(now, typeof data.id === 'string' ? data.id : '', id).run();
    if (!saved.meta.changes) throw new ChatError(404, 'not_found');
    return { ok: true };
  }
  if (data.action !== 'save' || !['course', 'workout'].includes(data.kind) ||
      typeof data.published !== 'boolean') throw new ChatError(400, 'partner_material_invalid');
  const fields = [data.kind, cleanName(data.title, 100), partnerText(data.description, 500),
    partnerText(data.body, 16000, true), videoLink(data.video), Number(data.published), now];
  const material = data.id ?? 'material-' + crypto.randomUUID();
  if (typeof material !== 'string' || !new RegExp('^' + PARTNER_MATERIAL_ID + '$').test(material)) {
    throw new ChatError(400, 'partner_material_invalid');
  }
  const saved = await db.prepare(`
    INSERT INTO chat_partner_materials (id, partner_id, kind, title, description, body, video_url, published, updated_ms)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM chat_web_accounts WHERE id = ? AND disabled_ms IS NULL)
    ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, title = excluded.title, description = excluded.description,
      body = excluded.body, video_url = excluded.video_url, published = excluded.published, updated_ms = excluded.updated_ms
    WHERE chat_partner_materials.partner_id = excluded.partner_id
  `).bind(material, id, ...fields, id).run();
  if (!saved.meta.changes) throw new ChatError(404, 'not_found');
  return { ok: true };
}

async function webApi(request, env, ctx, url) {
  const path = url.pathname;
  const role = path.startsWith('/v1/partner/') ? 'partner' : 'client';
  const prefix = '/v1/' + role + '/';
  const origin = request.headers.get('Origin');
  if (url.origin !== WEB_ORIGIN || (origin && origin !== WEB_ORIGIN) ||
      (request.method === 'POST' && origin !== WEB_ORIGIN)) {
    return webReply({ error: 'forbidden_origin' }, 403);
  }
  const db = env.CHAT_DB;
  if (!db) return webReply({ error: 'unavailable' }, 503);
  try {
    const now = Date.now();
    if (path === prefix + 'session' && ['GET', 'POST'].includes(request.method)) {
      const data = request.method === 'POST' ? await input(request, 1024) : {};
      const player = await webSession(db, request, now, role);
      const hasInvite = data.invite !== undefined;
      const hash = typeof data.invite === 'string' && WEB_TOKEN.test(data.invite) ? await webTokenHash(data.invite) : null;
      const active = Boolean(player && (!hasInvite || hash === player.invite_hash));
      let invite;
      if (hasInvite && !active) {
        const account = await namedInvite(db, role, data.invite);
        if (account) {
          invite = !activeAccount(account, now) ? 'expired' : account.claimable ? 'register' : 'used';
        } else {
          const old = role === 'client' && hash && await db.prepare(`
            SELECT c.expires_ms FROM chat_web_clients w JOIN chat_coaching c ON c.id = w.room_id
            WHERE w.invite_hash = ? AND NOT EXISTS (SELECT 1 FROM chat_web_accounts WHERE id = w.room_id)
          `).bind(hash).first();
          invite = old ? (old.expires_ms > now ? 'legacy' : 'expired') : 'invalid';
        }
      }
      return webReply({ active, invite, mail: role === 'client' && webMailReady(env) });
    }
    if (path === prefix + 'logout' && request.method === 'POST') {
      const token = webCookieToken(request, role);
      if (token) {
        const hash = await webTokenHash(token);
        const changes = [db.prepare('DELETE FROM chat_web_account_sessions WHERE token_hash = ?').bind(hash)];
        if (role === 'client') changes.push(db.prepare('DELETE FROM chat_web_sessions WHERE token_hash = ?').bind(hash));
        await db.batch(changes);
      }
      return webReply({ ok: true }, 200, webCookie('', 0, role));
    }
    if (path === prefix + 'register' && request.method === 'POST') {
      return await registerNamedAccount(db, role, await input(request, 4096), now);
    }
    if (path === prefix + 'password' && request.method === 'POST') {
      return await loginNamedAccount(db, role, await input(request, 1024), now);
    }
    if (role === 'client' && (path === prefix + 'code' || path === prefix + 'login') && request.method === 'POST') {
      const { invite, code } = await input(request, 1024);
      const client = await webGuestForToken(db, invite);
      if (client.expires_ms <= now) throw new ChatError(403, 'web_access_ended');
      if (path.endsWith('/code')) return webReply(await mailWebCode(env, client, now));
      return await verifyWebCode(db, client, code, now);
    }
    const player = await webSession(db, request, now, role);
    if (!player) throw new ChatError(401, 'web_auth_required');
    if (role === 'partner') {
      const desk = new RegExp('^/v1/partner/desk(?:/(' + PARTNER_MATERIAL_ID + '))?$').exec(path);
      if (!desk) throw new ChatError(404, 'not_found');
      return webReply(await partnerDesk(db, player.account, now, request, desk[1]));
    }
    const catalog = PARTNER_ROUTE.exec(path);
    if (catalog && request.method === 'GET') return webReply(await publishedPartners(db, catalog[1], catalog[2]));
    if (path === '/v1/client/chats' && request.method === 'GET') return webReply(await webOverview(db, player, now));
    const room = /^\/v1\/client\/chats\/rooms\/(lesson-[a-f0-9-]{36})(?:\/photos\/(\d+))?$/.exec(path);
    if (!room) throw new ChatError(404, 'not_found');
    if (room[1] !== player.room) throw new ChatError(403, 'room_forbidden');
    if (room[2] && request.method !== 'GET') throw new ChatError(405, 'method_not_allowed');
    if (request.method === 'POST') return webReply(await send(env, player.room, player, request, ctx));
    if (request.method !== 'GET') throw new ChatError(405, 'method_not_allowed');
    const access = await requireRoom(env, player.room, player, now);
    if (room[2]) return await getPhoto(db, player.room, room[2]);
    return webReply(await messages(db, access, player.room, player.id, url.searchParams));
  } catch (error) {
    if (error instanceof ChatError) return webReply({ error: error.message }, error.status);
    console.error('Web chat request failed', error.name);
    return webReply({ error: 'unavailable' }, 503);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/v1/client/') || url.pathname.startsWith('/v1/partner/')) return webApi(request, env, ctx, url);
    const origin = request.headers.get('Origin');
    if (origin && origin !== APP_ORIGIN) return reply({ error: 'forbidden_origin' }, 403);
    const route = url.pathname;
    const room = /^\/v1\/chats\/rooms\/((?:level-[nsp]|(?:start|lesson|direct)-[a-f0-9-]{36}))(?:\/(read)|\/photos\/(\d+))?$/.exec(route);
    const catalog = PARTNER_ROUTE.exec(route);
    const methods = {
      '/health': ['GET'],
      '/v1/chats': ['GET'],
      '/v1/chats/profile': ['POST'],
      '/v1/chats/notifications': ['POST'],
      '/v1/chats/manage': ['GET', 'POST'],
      '/v1/chats/clients': ['GET', 'POST'],
      '/v1/chats/partner-admin': ['GET', 'POST'],
      '/v1/chats/find': ['POST'],
      '/v1/chats/direct': ['POST'],
    };
    let allowed = catalog ? ['GET'] : methods[route];
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
          db.prepare('SELECT invite_hash FROM chat_web_clients LIMIT 0'),
          db.prepare('SELECT token_hash FROM chat_web_sessions LIMIT 0'),
          db.prepare('SELECT id FROM chat_web_accounts LIMIT 0'),
          db.prepare('SELECT token_hash FROM chat_web_account_sessions LIMIT 0'),
          db.prepare('SELECT id FROM chat_partner_materials LIMIT 0'),
        ]);
        return reply({ ok: true, membershipConfigured: Boolean(env.VIP_CHANNEL_ID && env.VIP_BOT_TOKEN), notificationsConfigured: canNotify(env), webConfigured: true, partnersConfigured: true, emailConfigured: webMailReady(env) });
      }
      const now = Date.now();
      const player = await authenticate(request, now);
      if (!player) return reply({ error: 'telegram_auth_required' }, 401);
      if (!db) return reply({ error: 'unavailable' }, 503);
      if (route === '/v1/chats') return reply(await overview(env, player, now, signedUser(request)));
      if (route === '/v1/chats/notifications') return reply(await saveNotifications(env, player, request));
      if (route === '/v1/chats/clients') return reply(await manageWebClients(env, player, now, request));
      if (route === '/v1/chats/partner-admin') return reply(await managePartnerInvites(env, player, request, now));
      if (catalog) {
        const vip = await channelStatus(env, player.id);
        if (!ownerConfigured(env, player.id) && !isVip(vip) &&
            !await db.prepare('SELECT 1 FROM chat_coaches WHERE telegram_id = ?').bind(player.id).first()) {
          throw new ChatError(vip === 'unavailable' ? 503 : 403, vip === 'unavailable' ? 'vip_unavailable' : 'room_forbidden');
        }
        return reply(await publishedPartners(db, catalog[1], catalog[2]));
      }
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
