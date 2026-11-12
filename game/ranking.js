const SwimRanking = (() => {
  const API = 'https://swim-island-game.pages.dev/v1';
  const PENDING_MAX_AGE = 15 * 60 * 1000;
  const pendingInMemory = new Map();
  const inFlight = new Map();
  const number = new Intl.NumberFormat('ru-RU');
  const monthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const telegram = () => window.Telegram?.WebApp;
  const available = () => Boolean(telegram()?.initData);
  const pendingKey = () => 'swim_island_pending_runs:' + (telegram()?.initDataUnsafe?.user?.id || '');
  const formatMonth = month => monthFormat.format(new Date(month + '-01T00:00:00Z')).replace(/ г\.$/, '');
  const formatMeters = meters => number.format(meters) + ' м';

  async function request(path, method = 'GET', data) {
    const initData = telegram()?.initData;
    if (!initData) throw Object.assign(new Error('telegram_required'), { status: 401 });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), path === 'start' ? 4200 : 8000);
    try {
      const headers = { Authorization: 'tma ' + initData };
      if (data) headers['Content-Type'] = 'application/json';
      const response = await fetch(API + '/' + path, {
        method,
        headers,
        body: data ? JSON.stringify(data) : undefined,
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) throw Object.assign(new Error(path), { status: response.status });
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function readPending(key) {
    let entries = pendingInMemory.get(key) || [];
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) entries = JSON.parse(stored);
    } catch {
      // Storage can be unavailable in the Telegram browser.
    }
    const cutoff = Date.now() - PENDING_MAX_AGE;
    return Array.isArray(entries) ? entries.filter(entry => entry?.when > cutoff) : [];
  }

  function writePending(key, entries) {
    pendingInMemory.set(key, entries);
    try {
      if (entries.length) localStorage.setItem(key, JSON.stringify(entries));
      else localStorage.removeItem(key);
    } catch {
      // Retries continue in memory until the app closes.
    }
  }

  function send(key, entry) {
    if (inFlight.has(entry.id)) return inFlight.get(entry.id);
    const remove = () => writePending(key, readPending(key).filter(item => item.id !== entry.id));
    const sent = request('finish', 'POST', { id: entry.id, ticks: entry.ticks, taps: entry.taps })
      .then(result => {
        remove();
        return { state: 'saved', meters: result.meters };
      })
      .catch(error => {
        if ([400, 410, 413, 422].includes(error.status)) {
          remove();
          return { state: 'expired' };
        }
        return { state: 'pending' };
      })
      .finally(() => inFlight.delete(entry.id));
    inFlight.set(entry.id, sent);
    return sent;
  }

  function finish(id, ticks, taps) {
    const key = pendingKey();
    const entry = { id, ticks, taps, when: Date.now() };
    writePending(key, [...readPending(key), entry].slice(-20));
    return send(key, entry);
  }

  async function retry() {
    if (!available()) return;
    const key = pendingKey();
    const entries = readPending(key);
    writePending(key, entries);
    for (const entry of entries) {
      const result = await send(key, entry);
      if (result.state === 'pending') break;
    }
  }

  function setup() {
    const root = document.getElementById('game-ranking');
    if (!root) return;
    const find = selector => root.querySelector(selector);
    const status = find('.rank-status');
    const refresh = find('.rank-refresh');
    const table = find('.rank-table');
    const previous = find('.rank-previous');
    const standing = find('.rank-personal');

    async function load() {
      if (!available()) {
        status.textContent = 'Откройте приложение из Telegram, чтобы увидеть общий рейтинг и участвовать в зачёте.';
        return;
      }
      status.textContent = 'Загружаем рейтинг…';
      refresh.disabled = true;
      try {
        await retry();
        const data = await request('leaderboard');
        if (!root.isConnected) return;
        find('.rank-month').textContent = formatMonth(data.month);
        standing.hidden = false;
        find('.rank-meters').textContent = formatMeters(data.you?.meters ?? 0);
        find('.rank-place').textContent = data.you ? 'Место ' + data.you.place : 'Место появится после первого зачётного заплыва';

        const rows = data.top.map(item => {
          const row = document.createElement('tr');
          row.classList.toggle('rank-you', item.you);
          for (const value of [item.place, item.name + (item.you ? ' · вы' : ''), formatMeters(item.meters)]) {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.appendChild(cell);
          }
          return row;
        });
        table.tBodies[0].replaceChildren(...rows);
        table.hidden = rows.length === 0;
        status.textContent = rows.length ? '' : 'В этом месяце пока нет результатов. Сделайте первый заплыв.';

        const leader = data.lastMonth.leader;
        previous.hidden = !leader;
        if (leader) {
          find('.rank-previous-month').textContent = 'Первое место · ' + formatMonth(data.lastMonth.month);
          find('.rank-previous-name').textContent = leader.name + ' · ' + formatMeters(leader.meters);
        }
      } catch (error) {
        status.textContent = error.status === 401
          ? 'Закройте приложение и откройте его заново из Telegram, чтобы обновить вход.'
          : 'Рейтинг временно недоступен. Попробуйте обновить.';
      } finally {
        refresh.disabled = false;
      }
    }

    refresh.hidden = !available();
    refresh.addEventListener('click', load);
    load();
  }

  window.addEventListener('online', retry);
  return Object.freeze({ available, setup, start: () => request('start', 'POST'), finish, retry });
})();
