const SwimPartners = (() => {
  const app = 'https://yarpah03.github.io/swim-island/';
  const api = 'https://swim-island-chats.pages.dev/v1/chats/partners';
  const routePattern = /^partners(?:\/(partner-[a-f0-9-]{36})(?:\/(material-[a-f0-9-]{36}))?)?$/;
  const routeParts = hash => routePattern.exec(hash);
  const errors = {
    room_forbidden: 'Раздел доступен участникам клуба.',
    telegram_auth_required: 'Откройте приложение в Telegram.',
    vip_unavailable: 'Проверка доступа к клубу временно недоступна.',
    not_found: 'Этот материал сейчас недоступен.',
    partner_material_invalid: 'Проверьте название и содержание материала.',
    invalid_name: 'Проверьте длину названия.',
    invalid_video: 'Укажите ссылку на видео, начинающуюся с https://.',
    web_access_ended: 'Доступ к кабинету завершён.',
  };
  const errorText = error => errors[error.message] || 'Не удалось загрузить данные. Попробуйте ещё раз.';

  function el(tag, text, cls) {
    const item = document.createElement(tag);
    if (text) item.textContent = text;
    if (cls) item.className = cls;
    return item;
  }

  function button(text, fn, primary = false) {
    const control = el('button', text, 'chat-button' + (primary ? ' chat-primary' : ''));
    control.type = 'button';
    control.addEventListener('click', fn);
    return control;
  }

  function link(text, href) {
    const control = el('a', text, 'chat-button');
    control.href = href;
    return control;
  }

  function field(form, label, options) {
    const [type, value, limit, required] = options;
    const wrap = el('label', label, 'chat-field');
    const input = el(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') input.type = type;
    else input.rows = limit > 2000 ? 7 : 3;
    input.value = value || '';
    input.maxLength = limit;
    input.required = Boolean(required);
    wrap.append(input);
    form.append(wrap);
    return input;
  }

  async function clubRequest(path) {
    const auth = window.Telegram?.WebApp?.initData;
    if (!auth) throw new Error('telegram_auth_required');
    const response = await fetch(api + path, {
      headers: { Authorization: 'tma ' + auth }, cache: 'no-store', signal: AbortSignal.timeout(12000),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'unavailable');
    return body;
  }

  async function catalog(root, hash, options) {
    const match = routeParts(hash);
    if (!match) return;
    const [, partner, material] = match;
    const status = el('p', 'Загружаем…', 'chat-status');
    status.setAttribute('role', 'status');
    root.replaceChildren(status);
    try {
      const args = partner ? '/' + partner + (material ? '/' + material : '') : '';
      const data = await (options.request || clubRequest)(args);
      if (!root.isConnected || !status.isConnected) return;
      if (!partner) {
        const cards = el('div', '', 'partner-grid');
        for (const person of data.partners) {
          const item = link('', '#partners/' + person.id);
          item.className = 'partner-tile';
          item.append(el('strong', person.name));
          if (person.bio) item.append(el('p', person.bio));
          item.addEventListener('click', event => {
            if (!options.navigate) return;
            event.preventDefault();
            options.navigate('partners/' + person.id);
          });
          cards.append(item);
        }
        if (!data.partners.length) cards.append(el('p', 'Здесь появятся страницы тренеров.'));
        root.replaceChildren(cards);
        return;
      }
      const previous = material ? 'partners/' + partner : 'partners';
      const back = button(material ? 'К тренеру' : 'Все партнёры', () => options.navigate(previous));
      root.replaceChildren(back);
      if (data.item) {
        const item = el('article', '', 'partner-panel');
        item.append(el('h2', data.item.title), el('p', data.partner.name, 'partner-meta'));
        if (data.item.description) item.append(el('p', data.item.description));
        item.append(el('p', data.item.body, 'partner-body'));
        if (data.item.video) {
          const url = new URL(data.item.video);
          if (url.protocol === 'https:' && !url.username && !url.password) {
            const video = link('Открыть видео', url.href);
            video.target = '_blank';
            video.rel = 'noopener noreferrer';
            item.append(video);
          }
        }
        if (options.share) {
          const forward = button('Переслать', () => options.share({
            title: data.item.title, detail: data.partner.name, url: app + '#' + hash,
          }, forward));
          forward.setAttribute('aria-haspopup', 'dialog');
          item.append(forward);
        }
        root.append(item);
        return;
      }
      root.append(el('h2', data.partner.name));
      if (data.partner.bio) root.append(el('p', data.partner.bio, 'partner-body'));
      for (const [kind, label] of [['course', 'Курсы'], ['workout', 'Тренировки']]) {
        const items = data.items.filter(item => item.kind === kind);
        if (!items.length) continue;
        const section = el('section', '', 'partner-list');
        section.append(el('h3', label));
        for (const item of items) {
          const open = button(item.title, () => options.navigate('partners/' + partner + '/' + item.id));
          open.classList.add('partner-title');
          const panel = el('div', '', 'partner-panel');
          panel.append(open);
          if (item.description) panel.append(el('p', item.description));
          section.append(panel);
        }
        root.append(section);
      }
      if (!data.items.length) root.append(el('p', 'Тренер пока готовит материалы.'));
    } catch (error) {
      if (!status.isConnected) return;
      status.textContent = errorText(error);
      if (error.message === 'telegram_auth_required') {
        root.append(link('Открыть в Telegram', 'https://t.me/SwimIslandVIPBot?startapp=partners'));
      } else {
        root.append(button('Обновить', () => catalog(root, hash, options)));
      }
    }
  }

  async function desk(root, request, leave, sessionLost, selected = 'course') {
    const status = el('p', 'Загружаем кабинет…', 'chat-status');
    status.setAttribute('role', 'status');
    function report(error) {
      if (error.message === 'web_auth_required' || error.message === 'web_access_ended') sessionLost();
      else status.textContent = errorText(error);
    }

    const header = el('header', '', 'partner-desk-head');
    header.append(el('h1', 'Кабинет тренера'), button('Выйти', leave));
    root.replaceChildren(header, status);
    try {
      const data = await request('desk');
      if (!status.isConnected) return;
      status.textContent = '';
      const tabs = el('nav', '', 'chat-filter-tabs');
      tabs.setAttribute('aria-label', 'Разделы кабинета тренера');
      const reload = (tab = selected) => desk(root, request, leave, sessionLost, tab);
      for (const [key, title] of [['course', 'Курсы'], ['workout', 'Тренировки'], ['profile', 'Профиль']]) {
        const tab = button(title, () => reload(key));
        tab.setAttribute('aria-pressed', String(key === selected));
        tabs.append(tab);
      }
      root.append(tabs);
      if (selected === 'profile') {
        root.append(profileForm(data.profile));
        return;
      }
      const section = selected === 'workout' ? 'Тренировки' : 'Курсы';

      function profileForm(data) {
        const profile = el('form', '', 'partner-panel chat-form');
        profile.append(el('h2', 'Страница партнёра'));
        const name = field(profile, 'Имя тренера', ['text', data.name, 40, true]);
        name.autocomplete = 'name';
        const bio = field(profile, 'О себе', ['textarea', data.bio, 1000]);
        const profileSave = el('button', 'Сохранить профиль', 'chat-button');
        profileSave.type = 'submit';
        profile.append(profileSave);
        profile.addEventListener('submit', async event => {
          event.preventDefault();
          profileSave.disabled = true;
          try {
            await request('desk', { action: 'profile', name: name.value, bio: bio.value });
            status.textContent = 'Профиль сохранён.';
          } catch (error) { report(error); }
          finally { profileSave.disabled = false; }
        });
        return profile;
      }

      const editor = el('div', '', 'partner-list');
      const library = el('section', '', 'partner-list');
      library.append(el('h2', section));
      function edit(item = {}) {
        const form = el('form', '', 'partner-panel chat-form');
        form.append(el('h2', item.id ? 'Редактировать материал' : 'Новый материал'));
        const options = el('label', 'Тип материала', 'chat-field');
        const kind = el('select');
        kind.setAttribute('aria-label', 'Тип материала');
        kind.append(new Option('Курс', 'course'), new Option('Тренировка', 'workout'));
        kind.value = item.kind || selected;
        options.append(kind);
        form.append(options);
        const title = field(form, 'Название', ['text', item.title, 100, true]);
        const about = field(form, 'Краткое описание', ['textarea', item.description, 500]);
        const body = field(form, 'Содержание', ['textarea', item.body, 16000, true]);
        const video = field(form, 'Ссылка на видео', ['url', item.video, 2000]);
        const id = item.id || 'material-' + crypto.randomUUID();
        const actions = el('div', '', 'chat-account-actions');
        const publish = el('button', 'Опубликовать', 'chat-button chat-primary');
        const draft = el('button', 'Сохранить черновик', 'chat-button');
        publish.type = draft.type = 'submit';
        actions.append(draft, publish, button('Отмена', () => editor.replaceChildren()));
        form.append(actions);
        form.addEventListener('submit', async event => {
          event.preventDefault();
          const published = event.submitter === publish;
          publish.disabled = draft.disabled = true;
          try {
            await request('desk', { action: 'save', id, kind: kind.value, title: title.value,
              description: about.value, body: body.value, video: video.value, published });
            await reload(kind.value);
            const result = root.querySelector('.chat-status');
            if (result) result.textContent = published ? 'Материал опубликован.' : 'Черновик сохранён.';
          } catch (error) { report(error); }
          finally { publish.disabled = draft.disabled = false; }
        });
        editor.replaceChildren(form);
        editor.scrollIntoView({ block: 'start' });
        title.focus({ preventScroll: true });
      }

      const create = button(selected === 'workout' ? 'Добавить тренировку' : 'Добавить курс', () => edit(), true);
      library.append(create);
      for (const item of data.items.filter(item => item.kind === selected)) {
        const row = el('div', '', 'partner-panel');
        const actions = el('div', '', 'chat-account-actions');
        row.append(el('h3', item.title), el('p', item.published ? 'Опубликовано' : 'Черновик', 'partner-meta'), actions);
        actions.append(button('Редактировать', async () => {
          try {
            const result = await request('desk/' + item.id);
            if (status.isConnected) edit(result.item);
          } catch (error) { report(error); }
        }));
        if (item.published) actions.append(button('Снять с публикации', async () => {
          try {
            await request('desk', { action: 'hide', id: item.id });
            await reload();
          } catch (error) { report(error); }
        }));
        library.append(row);
      }
      root.append(library, editor);
    } catch (error) {
      if (status.isConnected) report(error);
    }
  }

  return { catalog, desk, routeParts };
})();
