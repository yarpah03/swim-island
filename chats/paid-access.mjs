// Tribute is the payment authority. Channel membership alone also includes trials.
const PAID_PERIODS = new Set(['onetime', 'weekly', 'monthly', 'quarterly', 'halfyearly', 'yearly']);
const CURRENT_STATUSES = new Set(['active', 'pre_cancelled', 'cancelled']);
const KNOWN_TYPES = new Set(['regular', 'gift']);
const LIMIT = 2 * 1024 * 1024;

// These are the two existing VIP checkout links, including the paid friends test.
const VIP_LINKS = ['https://t.me/tribute/app?startapp=sXk3', 'https://t.me/tribute/app?startapp=s1c8d'];

export function tributeConfiguration(env) {
  const key = env.TRIBUTE_API_KEY;
  if (typeof key !== 'string' || !key.trim() || key.length > 2048) return null;
  const raw = env.TRIBUTE_VIP_SUBSCRIPTION_IDS;
  if (raw === undefined) return { key, ids: null, links: VIP_LINKS };
  if (typeof raw !== 'string') return null;
  const parts = raw.split(',').map(value => value.trim());
  if (parts.length > 8 || parts.some(value => !/^[1-9]\d{0,14}$/.test(value))) return null;
  const ids = [...new Set(parts.map(Number))];
  return ids.every(Number.isSafeInteger) ? { key, ids, links: [] } : null;
}

async function boundedJson(response) {
  if (!response.ok || !response.body || Number(response.headers.get('Content-Length')) > LIMIT) {
    await response.body?.cancel();
    throw new Error('tribute_unavailable');
  }
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > LIMIT) throw new Error('tribute_unavailable');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!Array.isArray(body.result) || body.result.length > 50_000) throw new Error('tribute_unavailable');
  return body.result;
}

export function decideTribute(rows, userId, ids, now, links = []) {
  let trial = false;
  let paidUntil = 0;
  for (const row of rows) {
    if (row.telegramUserId !== userId || !(ids ? ids.includes(row.subscriptionId) : links.includes(row.link)) ||
        !CURRENT_STATUSES.has(row.status)) continue;
    const starts = Date.parse(row.activatedAt);
    const ends = Date.parse(row.expireAt);
    if (!Number.isFinite(starts) || !Number.isFinite(ends) || starts > now || ends <= now) continue;
    if (row.period === 'trial' || row.type === 'trial') { trial = true; continue; }
    if (!PAID_PERIODS.has(row.period) || (row.type !== undefined && !KNOWN_TYPES.has(row.type))) continue;
    paidUntil = Math.max(paidUntil, ends);
  }
  if (paidUntil > now) return { allowed: true, reason: 'paid', expiresAt: paidUntil };
  return { allowed: false, reason: trial ? 'trial' : 'unpaid' };
}

export function createTributeChecker(fetcher = (...args) => fetch(...args)) {
  let cached;
  let loading;
  return async (env, userId, now = Date.now()) => {
    const config = tributeConfiguration(env);
    if (!config) return { allowed: false, reason: 'unavailable' };
    const identity = JSON.stringify([config.key, config.ids, config.links]);
    try {
      if (cached?.identity !== identity || cached.until <= now) {
        if (!loading || loading.identity !== identity) {
          const task = Promise.all((config.ids ?? [null]).map(async id => {
            const url = new URL('https://tribute.tg/api/v1/subscribers');
            if (id !== null) url.searchParams.set('subscriptionID', String(id));
            const response = await fetcher(url, {
              headers: { 'Api-Key': config.key, Accept: 'application/json' },
              redirect: 'error', signal: AbortSignal.timeout(6000),
            });
            const rows = await boundedJson(response);
            // Tribute ignores invalid filters, so never trust the filter alone.
            return rows.filter(row => id === null ? config.links.includes(row.link) : row.subscriptionId === id);
          })).then(lists => ({ identity, rows: lists.flat(), until: Date.now() + 5000 }));
          loading = { identity, task };
          task.finally(() => { if (loading?.task === task) loading = null; }).catch(() => {});
        }
        cached = await loading.task;
      }
      return decideTribute(cached.rows, userId, config.ids, now, config.links);
    } catch {
      return { allowed: false, reason: 'unavailable' };
    }
  };
}

const checkTribute = createTributeChecker();

export async function pdfEntitlement(env, player, now = Date.now()) {
  const db = env.CHAT_DB;
  if ((env.CHAT_OWNER_IDS ?? '').split(',').map(value => value.trim()).includes(String(player.id)) ||
      await db.prepare('SELECT 1 FROM chat_coaches WHERE telegram_id = ?').bind(player.id).first()) {
    return { allowed: true, reason: 'staff', expiresAt: now + 86400_000 };
  }
  const paid = await db.prepare(`
    SELECT max(min(p.paid_until_ms, c.expires_ms)) AS expires
    FROM chat_pdf_access p JOIN chat_coaching c ON c.id = p.room_id
    WHERE c.student_id = ? AND (? IS NULL OR c.id = ?)
      AND p.paid_until_ms > ? AND c.expires_ms > ?
  `).bind(player.id, player.room ?? null, player.room ?? null, now, now).first();
  if (paid?.expires > now) return { allowed: true, reason: 'paid', expiresAt: paid.expires };
  if (player.id < 0) return { allowed: false, reason: 'unpaid' };
  return checkTribute(env, player.id, now);
}
