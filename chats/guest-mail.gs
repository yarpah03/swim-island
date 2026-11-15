function jsonResult(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  try {
    const key = PropertiesService.getScriptProperties().getProperty('SWIM_MAIL_KEY');
    return jsonResult({ ready: /^[a-f0-9]{64}$/.test(key || '') && MailApp.getRemainingDailyQuota() > 0 });
  } catch (error) {
    return jsonResult({ ready: false });
  }
}

function doPost(event) {
  try {
    const contents = event.postData.contents;
    if (contents.length > 1800) return jsonResult({ ok: false });
    const { payload, signature } = JSON.parse(contents);
    const key = PropertiesService.getScriptProperties().getProperty('SWIM_MAIL_KEY');
    if (!key || typeof payload !== 'string' || !/^[a-f0-9]{64}$/.test(signature || '')) return jsonResult({ ok: false });
    const digest = Utilities.computeHmacSha256Signature('mail:' + payload, key, Utilities.Charset.UTF_8)
      .map(byte => (byte & 255).toString(16).padStart(2, '0')).join('');
    let difference = 0;
    for (let i = 0; i < digest.length; i++) difference |= digest.charCodeAt(i) ^ signature.charCodeAt(i);
    if (difference) return jsonResult({ ok: false });

    const { email, code, issuedAt, id } = JSON.parse(payload);
    if (typeof email !== 'string' || email.length > 254 ||
        !/^[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]{1,64}@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+$/i.test(email) ||
        typeof code !== 'string' || !/^[A-HJ-NP-Z2-9]{12}$/.test(code) || !Number.isSafeInteger(issuedAt) ||
        Math.abs(Date.now() - issuedAt) > 120000 || !/^[a-f0-9-]{36}$/.test(id || '')) {
      return jsonResult({ ok: false });
    }

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(3000)) return jsonResult({ ok: false });
    try {
      const cache = CacheService.getScriptCache();
      if (cache.get(id)) return jsonResult({ ok: true });
      if (MailApp.getRemainingDailyQuota() < 1) return jsonResult({ ok: false });
      MailApp.sendEmail({
        to: email,
        name: 'Плавательный остров VIP',
        subject: 'Код входа в кабинет Плавательного острова VIP',
        body: 'Ваш код входа: ' + code + '\n\nКод действует 15 минут. Введите его в кабинете, который открылся по ссылке от тренера. Если вы не запрашивали код, письмо можно проигнорировать.',
      });
      cache.put(id, 'sent', 180);
      return jsonResult({ ok: true });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return jsonResult({ ok: false });
  }
}
