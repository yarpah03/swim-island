const WorkoutPrint = (() => {
  const BRAND = "Плавательный остров VIP";
  const number = new Intl.NumberFormat("ru-RU");

  function fromPool(workout, title, context) {
    const parts = workout.items
      ? [{ items: workout.items }]
      : [
          { label: "Разминка", items: (workout.warm || []).map(row => row[1]) },
          { label: "Основная часть", items: (workout.main || []).map(row => row[1]) },
          { label: "Откуп", items: (workout.cool || []).map(row => row[1]) },
        ];
    const shorthand = parts.flatMap(part => part.items).join(" ");
    const notes = [
      workout.items ? workout.note : null,
      /\bi\d/.test(shorthand) ? "i - отдых в секундах." : null,
      /\bp\s*[:≤]|\bp\s+\d/.test(shorthand) ? "p - пульс, удары за 10 секунд." : null,
      workout.safe && "Безопасность. " + workout.safe,
    ].filter(Boolean);
    return {
      title,
      context,
      volume: workout.vol ? number.format(workout.vol) + " м" : "",
      sections: parts.filter(part => part.items.length).map(part => ({
        ...part, items: part.items.map(text => ({ text, task: true })),
      })),
      notes,
    };
  }

  function fromLand(screen) {
    const sections = [];
    let part;
    const add = item => {
      if (!part) {
        part = { items: [] };
        sections.push(part);
      }
      part.items.push(item);
    };
    for (const [type, value] of screen.print) {
      if (type === "h2" || type === "h3") {
        part = { label: value, items: [] };
        sections.push(part);
      } else if (type === "p" || type === "warn") {
        if (value) add({ text: type === "warn" ? "Безопасность. " + value : value });
      } else if (type === "ul" || type === "num") {
        value.forEach(text => add({ text, task: true }));
      } else if (type === "circuit" || type === "workout-table") {
        const rows = type === "circuit" ? value : value.rows;
        const columns = type === "circuit" ? [] : value.columns || [];
        for (const exercise of rows) {
          const doses = exercise.values || [exercise.amount];
          const dose = doses.flatMap((amount, i) => {
            if (amount === "" || amount == null) return [];
            const column = columns[i];
            return columns.length > 1 ? [(column.label || column) + " - " + amount] : [amount];
          }).join(" / ");
          const text = exercise.note ? exercise.name + " (" + exercise.note + ")" : exercise.name;
          add({ text, dose, task: true });
        }
      } else if (type === "tbl") {
        const [head, ...rows] = value;
        for (const [label, ...values] of rows) {
          add({
            text: label,
            dose: values.map((value, i) => values.length === 1 ? value : head[i + 1] + " - " + value).join(" / "),
            task: true,
          });
        }
      }
    }
    return { title: screen.title, context: screen.printContext ?? screen.lede, sections: sections.filter(part => part.items.length), notes: [] };
  }

  const API = new URL('/v1/pdf', location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? location.origin : 'https://vip.swimisland.ru').href;
  const labels = new WeakMap();
  let checking;
  let last;
  const errors = {
    telegram_auth_required: 'Закройте приложение и откройте его снова из VIP-канала.',
    web_auth_required: 'Войдите в приложение, чтобы проверить подписку.',
    payment_check_unavailable: 'Не удалось проверить оплату. Попробуйте ещё раз.',
    pdf_wait: 'Подождите минуту перед следующим скачиванием.',
    pdf_expired: 'Ссылка истекла. Скачайте тренировку заново.',
  };

  async function request(path, card) {
    const data = window.Telegram?.WebApp?.initData;
    const headers = new Headers();
    if (data) headers.set('Authorization', 'tma ' + data);
    if (card) headers.set('Content-Type', 'application/json');
    const response = await fetch(API + path, {
      method: card ? 'POST' : 'GET', headers, credentials: data ? 'omit' : 'same-origin',
      ...(card ? { body: JSON.stringify(card) } : {}),
      signal: AbortSignal.timeout(25_000), cache: 'no-store',
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const error = new Error(body.error || 'payment_check_unavailable');
      error.reason = body.reason;
      throw error;
    }
    return response;
  }

  function currentAccess(force = false) {
    if (!force && last?.until > Date.now()) return Promise.resolve(last.access);
    if (checking) return checking;
    checking = request('/access').then(response => response.json()).then(access => {
      last = { access, until: Math.min(Date.now() + 5000, access.expiresAt || Infinity) };
      return access;
    }).finally(() => { checking = null; });
    return checking;
  }

  function showState(container, access, error) {
    if (!container.isConnected) return;
    const button = container.querySelector('.workout-print-button');
    const status = container.querySelector('[data-print-status]');
    if (!button || !status) return;
    if (!labels.has(button)) labels.set(button, button.innerHTML);
    container.querySelector('.workout-print-actions')?.remove();
    button.disabled = !error && !access?.allowed;
    button.innerHTML = labels.get(button);
    if (error) {
      status.textContent = errors[error.message] || 'PDF не загрузился. Попробуйте ещё раз.';
      return;
    }
    if (access?.allowed) { status.textContent = ''; return; }
    status.textContent = access?.reason === 'trial'
      ? 'В пробном режиме PDF недоступен. Скачать тренировку можно с активной оплаченной подпиской.'
      : 'Скачать PDF можно только с активной оплаченной подпиской.';
    const actions = document.createElement('div');
    actions.className = 'workout-print-actions';
    const retry = document.createElement('button');
    retry.className = 'workout-print-browser';
    retry.type = 'button';
    retry.textContent = 'Проверить оплату';
    retry.addEventListener('click', () => mount(container, true));
    actions.appendChild(retry);
    if (window.Telegram?.WebApp?.initData) {
      const subscribe = document.createElement('button');
      subscribe.className = 'workout-print-browser';
      subscribe.type = 'button';
      subscribe.textContent = 'Оформить подписку';
      subscribe.addEventListener('click', () => {
        const url = 'https://t.me/tribute/app?startapp=sXk3';
        window.Telegram.WebApp.openTelegramLink(url);
      });
      actions.appendChild(subscribe);
    }
    container.appendChild(actions);
  }

  async function mount(root = document, force = false) {
    const containers = [...root.querySelectorAll('.workout-print')];
    if (root.matches?.('.workout-print')) containers.unshift(root);
    if (!containers.length) return;
    for (const container of containers) {
      const button = container.querySelector('.workout-print-button');
      if (!labels.has(button)) labels.set(button, button.innerHTML);
      button.disabled = true;
      container.querySelector('[data-print-status]').textContent = 'Проверяем оплаченную подписку…';
    }
    try {
      const access = await currentAccess(force);
      if (access.allowed !== true && !['trial', 'unpaid'].includes(access.reason)) {
        throw new Error('payment_check_unavailable');
      }
      containers.forEach(container => showState(container, access));
    } catch (error) { containers.forEach(container => showState(container, null, error)); }
  }

  function save(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function offerBrowser(container, url) {
    if (!window.Telegram?.WebApp?.initData || !url) return;
    const button = document.createElement('button');
    button.className = 'workout-print-browser workout-print-fallback';
    button.type = 'button';
    button.textContent = 'Открыть PDF в браузере';
    button.addEventListener('click', () => window.Telegram.WebApp.openLink(url));
    container.appendChild(button);
  }

  async function download(button, card) {
    const container = button.closest('.workout-print');
    const status = container.querySelector('[data-print-status]');
    container.querySelectorAll('.workout-print-fallback').forEach(item => item.remove());
    button.disabled = true;
    status.textContent = 'Проверяем оплату и готовим PDF…';
    try {
      // The server checks the current entitlement on every PDF request.
      const response = await request('', card);
      if (!response.headers.get('Content-Type')?.startsWith('application/pdf')) throw new Error('pdf_unavailable');
      const blob = await response.blob();
      const filename = [card.title, card.volume, BRAND].filter(Boolean)
        .join(' - ').slice(0, 140).replace(/[<>:"/\\|?*]/g, '-') + '.pdf';
      const candidate = response.headers.get('X-Swim-PDF-Url');
      const url = candidate && new URL(candidate);
      const downloadUrl = url?.origin === new URL(API).origin && /^\/v1\/pdf\/download\/[a-f0-9]{64}$/.test(url.pathname)
        ? url.href : null;
      const file = typeof File === 'function' ? new File([blob], filename, { type: 'application/pdf' }) : null;
      if (file && navigator.canShare?.({ files: [file] }) && navigator.share) {
        const ready = document.createElement('button');
        ready.type = 'button';
        ready.className = 'ref-btn workout-print-fallback';
        ready.textContent = 'Сохранить PDF';
        ready.addEventListener('click', async () => {
          try { await navigator.share({ files: [file] }); }
          catch (error) { if (error.name !== 'AbortError') save(file, filename); }
        });
        container.appendChild(ready);
        status.textContent = 'PDF готов. Нажмите «Сохранить PDF».';
      } else {
        save(blob, filename);
        status.textContent = 'PDF готов для печати на А4.';
      }
      offerBrowser(container, downloadUrl);
      button.disabled = false;
    } catch (error) {
      last = null;
      if (error.message === 'paid_subscription_required') showState(container, { allowed: false, reason: error.reason });
      else showState(container, null, error);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { last = null; mount(); }
  });
  return { fromPool, fromLand, download, mount };
})();
