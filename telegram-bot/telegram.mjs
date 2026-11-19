export async function telegram(env, method, body = {}) {
  const multipart = body instanceof FormData;
  let r, data;
  try {
    r = await fetch('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/' + method, {
      method: 'POST', headers: multipart ? undefined : { 'Content-Type': 'application/json' },
      body: multipart ? body : JSON.stringify(body), signal: AbortSignal.timeout(8000),
    });
    data = await r.json();
  } catch { throw new Error('telegram_transport'); }
  if (!r.ok || !data.ok) {
    const e = new Error('telegram_api');
    e.status = data.error_code || r.status;
    e.retryAfter = data.parameters?.retry_after || 0;
    e.unchanged = e.status === 400 && /message is not modified/i.test(data.description || '');
    throw e;
  }
  return data.result;
}
export const text = (env, chat, message, rows) => telegram(env, 'sendMessage', {
  chat_id: chat, text: message, parse_mode: 'HTML',
  ...(rows ? { reply_markup: { inline_keyboard: rows } } : {}),
});
export async function asset(env, origin, path) {
  const r = await env.ASSETS.fetch(new Request(new URL(path, origin)));
  if (!r.ok) throw new Error('missing_asset');
  return r.blob();
}
export async function photoCard(env, origin, chat, card, message) {
  if (card.caption.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt);/g, 'x').length > 1024) throw new Error('caption_too_long');
  let photo = card.photo;
  if (photo.startsWith('/')) {
    const cached = await env.BOT_DB.prepare('SELECT file_id FROM bot_media WHERE name=?').bind(photo).first();
    if (cached) photo = cached.file_id;
  }
  const edit = message?.photo?.length;
  let result;
  try {
    const data = new FormData();
    data.set('chat_id', String(chat));
    data.set('reply_markup', JSON.stringify({ inline_keyboard: card.rows }));
    if (card.photo.startsWith('/') && photo.startsWith('/')) {
      data.set('upload', await asset(env, origin, card.photo), 'cover.jpg');
      photo = 'attach://upload';
    }
    if (edit) {
      data.set('message_id', String(message.message_id));
      data.set('media', JSON.stringify({ type: 'photo', media: photo, caption: card.caption, parse_mode: 'HTML' }));
    } else {
      data.set('photo', photo);
      data.set('caption', card.caption);
      data.set('parse_mode', 'HTML');
    }
    result = await telegram(env, edit ? 'editMessageMedia' : 'sendPhoto', data);
  } catch (e) {
    if (e.unchanged) return message;
    if (edit && e.status === 400) return photoCard(env, origin, chat, card);
    // A stale Telegram file_id is retried with the original asset.
    if (e.status === 400 && card.photo.startsWith('/') && photo !== 'attach://upload') {
      await env.BOT_DB.prepare('DELETE FROM bot_media WHERE name=?').bind(card.photo).run();
      return photoCard(env, origin, chat, card, message);
    }
    throw e;
  }
  const file = result.photo?.at(-1)?.file_id;
  if (file && card.photo.startsWith('/')) {
    await env.BOT_DB.prepare('INSERT INTO bot_media(name,file_id) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET file_id=excluded.file_id').bind(card.photo, file).run();
  }
  return result;
}
export async function document(env, origin, chat, material, rows) {
  const data = new FormData();
  data.set('chat_id', String(chat));
  data.set('caption', material.title);
  if (rows) data.set('reply_markup', JSON.stringify({ inline_keyboard: rows }));
  if (material.kind === 'asset') {
    data.set('document', await asset(env, origin, material.payload), material.id + '.pdf');
  } else data.set('document', material.payload);
  return telegram(env, 'sendDocument', data);
}
