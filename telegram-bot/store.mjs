export const rows = async (db, sql, ...values) => (await db.prepare(sql).bind(...values).all()).results;
export const one = (db, sql, ...values) => db.prepare(sql).bind(...values).first();
export const run = (db, sql, ...values) => db.prepare(sql).bind(...values).run();
export async function subscribe(db, id, source = 'direct') {
  const now = Date.now();
  // Returning to /menu does not override an earlier /stop.
  await run(db, 'INSERT INTO bot_subscribers(chat_id,subscribed,created_ms,updated_ms,source) VALUES(?,1,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET updated_ms=excluded.updated_ms', id, now, now, source.slice(0,64));
}
export async function draft(db, id) {
  const d = await one(db, 'SELECT * FROM bot_admin_drafts WHERE actor_id=?', id);
  if (!d || d.updated_ms < Date.now() - 86400000) return null;
  try { return { ...d, data: JSON.parse(d.payload) }; } catch { return null; }
}
export async function saveDraft(db, id, step, data = {}, nonce = crypto.randomUUID().replaceAll('-','').slice(0,16)) {
  await run(db, 'INSERT INTO bot_admin_drafts(actor_id,step,payload,nonce,updated_ms) VALUES(?,?,?,?,?) ON CONFLICT(actor_id) DO UPDATE SET step=excluded.step,payload=excluded.payload,nonce=excluded.nonce,updated_ms=excluded.updated_ms', id, step, JSON.stringify(data), nonce, Date.now());
  return nonce;
}
export async function claimUpdate(db, id) {
  const now = Date.now();
  const r = await db.prepare('INSERT INTO bot_updates(update_id,lease_until,completed) VALUES(?,?,0) ON CONFLICT(update_id) DO UPDATE SET lease_until=excluded.lease_until WHERE bot_updates.completed=0 AND bot_updates.lease_until<? RETURNING update_id').bind(id, now+60000, now).first();
  return !!r;
}
