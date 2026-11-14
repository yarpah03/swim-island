const SwimChats = (() => {
  const API = 'https://swim-island-chats.pages.dev/v1/chats';
  const tg = () => window.Telegram?.WebApp;
  const hasTelegram = () => Boolean(tg()?.initData);
  const levelNames = { n: 'Новичок', s: 'Средний уровень', p: 'Продвинутый' };
  const errors = {
    telegram_auth_required: 'Закройте приложение и снова откройте его из VIP-канала.',
    room_forbidden: 'Доступ к этому чату закрыт.',
    profile_required: 'Сначала заполните профиль.',
    vip_unavailable: 'Проверка VIP-доступа временно недоступна.',
    invalid_name: 'Введите имя от 2 до 40 символов. Для названия группы допустимо до 60 символов.',
    invalid_level: 'Выберите уровень подготовки.',
    invalid_message: 'Введите сообщение до 2 000 символов.',
    invalid_video: 'Добавьте ссылку на видео, которая начинается с https://.',
    invalid_account: 'Проверьте коды участников.',
    account_not_found: 'Проверьте код из профиля участника.',
    unknown_coach: 'Этот тренер не найден в списке клуба.',
    invalid_assignment: 'Проверьте коды участников и дату окончания ведения.',
    slow_down: 'Подождите секунду и повторите отправку.',
    manager_required: 'Управление чатами доступно владельцу клуба.',
    coach_required: 'Поиск по коду доступен тренерам клуба.',
    self_contact: 'Введите код другого участника.',
  };
  const errorMessage = error => errors[error.message] || 'Не удалось связаться с чатами. Попробуйте ещё раз.';
  const dateTime = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
  const date = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeZone: 'Europe/Moscow' });
  const day = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
  const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const icons = {
    back: '<path d="m14 5-7 7 7 7m-7-7h14"/>',
    search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/>',
    person: '<circle cx="12" cy="8" r="3.25"/><path d="M5 20v-1a7 7 0 0 1 14 0v1"/>',
    manage: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
    group: '<path d="M3 19v-1a5 5 0 0 1 10 0v1m2-5a4.5 4.5 0 0 1 6 4v1"/><circle cx="8" cy="8" r="3"/><path d="M15 5a3 3 0 0 1 0 6"/>',
    waves: '<path d="M3 9c3 0 3-2 6-2s3 2 6 2 3-2 6-2M3 15c3 0 3-2 6-2s3 2 6 2 3-2 6-2"/>',
    link: '<path d="M10 13a4 4 0 0 0 6 .4l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7m2.4 4.6a4 4 0 0 0-6-.4l-3 3a4 4 0 0 0 5.7 5.7l1.7-1.7"/>',
    send: '<path d="M21 3 9.7 14.3M21 3l-7 18-4.3-6.7L3 10z"/>',
  };
  let dispose = () => {};

  function element(tag, className, label) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (label) item.textContent = label;
    return item;
  }

  function button(label, action, className = 'chat-button') {
    const item = element('button', className, label);
    item.type = 'button';
    item.addEventListener('click', () => action());
    return item;
  }

  function icon(name) {
    const item = element('span', 'chat-icon');
    item.setAttribute('aria-hidden', 'true');
    item.innerHTML = '<svg viewBox="0 0 24 24">' + icons[name] + '</svg>';
    return item;
  }

  function iconLabel(item, name, label) {
    item.append(icon(name));
    item.setAttribute('aria-label', label);
    item.title = label;
    return item;
  }

  function iconButton(name, label, action) {
    return iconLabel(button('', action, 'chat-icon-button'), name, label);
  }

  function face(room) {
    const group = room.kind === 'group';
    const avatar = element('span', 'chat-avatar chat-avatar-' + room.kind);
    avatar.setAttribute('aria-hidden', 'true');
    if (group) avatar.append(icon(room.level ? 'waves' : 'group'));
    else avatar.textContent = room.title.trim().split(/\s+/u).slice(0, 2).map(word => [...word][0]).join('').toUpperCase();
    return avatar;
  }

  function roomDetails(room) {
    if (room.kind === 'group') return room.level ? 'Группа · ' + levelNames[room.level] : 'Группа к старту';
    if (room.kind === 'direct') return 'Личный чат';
    if (!room.expires) return 'Онлайн-ведение';
    return (room.coaching ? 'Ученик' : 'Тренер') + ' · ведение до ' + date.format(room.expires - 1);
  }

  function field(form, label, control) {
    const wrap = element('label', 'chat-field', label);
    wrap.append(control);
    form.append(wrap);
    return control;
  }

  function choices(value, all = false) {
    const select = element('select');
    if (all) select.add(new Option('Все уровни', ''));
    for (const [id, label] of Object.entries(levelNames)) select.add(new Option(label, id));
    select.value = value || (all ? '' : 'n');
    return select;
  }

  function textInput(placeholder, maxLength = 40) {
    const input = element('input');
    input.placeholder = placeholder;
    input.maxLength = maxLength;
    input.required = true;
    return input;
  }

  async function api(path = '', payload, signal) {
    const auth = tg()?.initData;
    if (!auth) throw new Error('telegram_auth_required');
    const controller = new AbortController();
    const stop = () => controller.abort();
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
    const timeout = setTimeout(stop, 10000);
    try {
      const headers = { Authorization: 'tma ' + auth };
      const options = { headers, signal: controller.signal, cache: 'no-store' };
      if (payload) {
        headers['Content-Type'] = 'application/json';
        options.method = 'POST';
        options.body = JSON.stringify(payload);
      }
      const response = await fetch(API + path, options);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'unavailable');
      return body;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', stop);
    }
  }

  function mount(root, preferredLevel, returnHash = '#home') {
    dispose();
    dispose = () => {};
    if (!root) return;
    const telegram = tg();
    const viewport = window.visualViewport;
    const exit = () => { location.hash = returnHash; };
    let back = exit;
    const goBack = () => back();
    let screen;
    let cleanup = () => {};
    const closeScreen = () => {
      screen?.abort();
      cleanup();
      cleanup = () => {};
    };
    const resize = () => {
      const height = Math.min(window.innerHeight, viewport?.height || Infinity, telegram?.viewportStableHeight || Infinity);
      root.style.setProperty('--chat-height', Math.floor(height) + 'px');
    };
    const nativeBack = hasTelegram() ? telegram.BackButton : null;
    nativeBack?.onClick(goBack);
    nativeBack?.show();
    window.addEventListener('resize', resize);
    viewport?.addEventListener('resize', resize);
    telegram?.onEvent?.('viewportChanged', resize);
    resize();
    dispose = () => {
      closeScreen();
      nativeBack?.offClick(goBack);
      nativeBack?.hide();
      window.removeEventListener('resize', resize);
      viewport?.removeEventListener('resize', resize);
      telegram?.offEvent?.('viewportChanged', resize);
    };

    function view(title, options = {}) {
      closeScreen();
      back = options.back ?? exit;
      screen = new AbortController();
      const top = element('div', 'chat-topbar');
      const bar = element('div', 'chat-topbar-inner chat-width');
      const heading = element('div', 'chat-heading');
      const name = element('h1', '', title);
      name.tabIndex = -1;
      heading.append(name);
      bar.append(iconButton('back', options.back ? 'К списку чатов' : 'Назад в приложение', goBack));
      if (options.room) {
        bar.append(face(options.room));
        heading.append(element('small', '', roomDetails(options.room)));
      }
      const actions = element('div', 'chat-actions');
      bar.append(heading, actions);
      top.append(bar);

      const panel = element('section', 'chat-panel' + (options.room ? ' chat-conversation' : ''));
      const status = element('p', 'chat-status');
      status.setAttribute('role', 'status');
      root.replaceChildren(top, panel);
      name.focus({ preventScroll: true });
      const signal = screen.signal;
      const statusText = text => { if (!signal.aborted) status.textContent = text; };
      const errorText = error => statusText(errorMessage(error));
      const request = (path, payload) => api(path, payload, signal);
      const formSubmit = (form, label, handler, symbol) => {
        const submit = element('button', 'chat-button chat-primary', symbol ? '' : label);
        if (symbol) iconLabel(submit, symbol, label);
        submit.type = 'submit';
        form.append(submit);
        form.addEventListener('submit', async event => {
          event.preventDefault();
          if (submit.disabled) return;
          submit.disabled = true;
          statusText('');
          try { await handler(); }
          catch (error) { errorText(error); }
          finally { submit.disabled = false; }
        });
      };
      return { panel, actions, status, signal, request, statusText, errorText, formSubmit };
    }

    if (!hasTelegram()) {
      const v = view('Чаты');
      const notice = element('div', 'chat-width chat-sheet');
      const link = element('a', 'chat-button chat-primary', 'Открыть в Telegram');
      link.href = 'https://t.me/SwimIslandVIPBot?startapp';
      notice.append(element('p', '', 'Войдите через Telegram, чтобы открыть свои чаты.'), link);
      v.panel.append(notice);
      return;
    }

    function profileForm(v, data) {
      const form = element('form', 'chat-form');
      if (!data.profile) form.append(element('p', '', 'Заполните профиль, чтобы открыть чаты.'));
      const name = field(form, 'Имя в чатах', textInput('Как к вам обращаться?'));
      name.minLength = 2;
      name.value = data.profile?.name || data.suggestedName || '';
      name.autocomplete = 'nickname';
      const level = field(form, 'Уровень подготовки', choices(data.profile?.level || preferredLevel));
      v.formSubmit(form, 'Сохранить', async () => {
        await v.request('/profile', { name: name.value, level: level.value });
        if (!v.signal.aborted) await list();
      });
      if (data.profile) form.append(button('Отмена', () => profile(data)));
      return form;
    }

    function profile(data, edit = false) {
      const v = view('Профиль', { back: list });
      const sheet = element('div', 'chat-width chat-sheet');
      v.panel.append(sheet);
      if (edit) {
        sheet.append(profileForm(v, data), v.status);
        return;
      }
      const person = element('div', 'chat-profile');
      const details = element('div');
      details.append(element('h2', '', data.profile.name), element('small', '', levelNames[data.profile.level]));
      if (data.coach) details.append(element('small', 'chat-coach-label', 'Тренер клуба · @' + data.coach.handle));
      person.append(face({ title: data.profile.name, kind: 'direct' }), details);
      const code = element('div', 'chat-profile-code');
      code.append(element('small', '', 'Код для тренера'), element('code', '', data.profile.code));
      sheet.append(person, code, button('Редактировать', () => profile(data, true)));
    }

    function findPerson() {
      const v = view('Найти по коду', { back: list });
      const form = element('form', 'chat-form chat-width chat-sheet');
      form.append(element('p', '', 'Попросите участника прислать код из его профиля.'));
      const code = field(form, 'Код из профиля', textInput('12 символов'));
      code.autocapitalize = 'none';
      code.autocomplete = 'off';
      code.spellcheck = false;
      const feedback = element('p', 'chat-status');
      feedback.setAttribute('role', 'status');
      const result = element('div', 'chat-profile');
      const reset = () => {
        result.replaceChildren();
        result.remove();
        feedback.textContent = '';
      };
      const showError = error => {
        if (v.signal.aborted) return;
        feedback.textContent = error.message === 'invalid_account' ? 'Введите 12 символов из кода профиля.'
          : error.message === 'account_not_found' ? 'Профиль не найден. Проверьте код.'
          : errorMessage(error);
      };
      code.addEventListener('input', reset);
      v.formSubmit(form, 'Найти', async () => {
        reset();
        const value = code.value.trim();
        feedback.textContent = 'Ищем профиль…';
        try {
          const person = await v.request('/find', { code: value });
          if (v.signal.aborted || code.value.trim() !== value) return;
          feedback.textContent = '';
          const details = element('div');
          details.append(element('strong', '', person.name), element('small', '', levelNames[person.level]));
          const open = button('Открыть чат', async () => {
            open.disabled = true;
            feedback.textContent = '';
            try {
              const room = await v.request('/direct', { code: value });
              if (!v.signal.aborted && result.contains(open)) await conversation(room);
            } catch (error) {
              if (result.contains(open)) showError(error);
            } finally { open.disabled = false; }
          }, 'chat-button chat-primary');
          result.replaceChildren(details, open);
          form.append(result);
        } catch (error) {
          if (code.value.trim() === value) showError(error);
        }
      });
      form.append(feedback, v.status);
      v.panel.append(form);
    }

    function roomRow(room) {
      const row = button('', () => conversation(room), 'chat-room');
      row.append(face(room));
      const summary = element('span', 'chat-room-summary');
      const title = element('strong', 'chat-room-name', room.title);
      const latest = room.latest;
      const preview = latest
        ? (latest.own ? 'Вы: ' : '') + (latest.text.trim().replace(/\s+/gu, ' ') || 'Видео')
        : roomDetails(room);
      summary.append(title, element('span', 'chat-preview', preview));
      row.append(summary);
      if (latest) {
        const when = new Date(latest.sent);
        const stamp = element('time', 'chat-room-time', when.toDateString() === new Date().toDateString() ? time.format(when) : day.format(when));
        stamp.dateTime = when.toISOString();
        stamp.title = dateTime.format(when);
        row.append(stamp);
      }
      return row;
    }

    async function list() {
      const v = view('Чаты');
      const inbox = element('div', 'chat-width chat-inbox');
      v.panel.append(inbox);
      inbox.append(v.status);
      v.statusText('Загружаем чаты…');
      try {
        const data = await v.request('');
        if (v.signal.aborted) return;
        v.statusText('');
        if (!data.profile) {
          const sheet = element('div', 'chat-sheet');
          sheet.append(profileForm(v, data), v.status);
          inbox.append(sheet);
          return;
        }
        if (data.coach) {
          const find = iconButton('search', 'Найти по коду', findPerson);
          find.classList.add('chat-find-button');
          find.append(element('span', '', 'По коду'));
          v.actions.append(find);
        }
        v.actions.append(iconButton('person', 'Профиль', () => profile(data)));
        if (data.manager) v.actions.append(iconButton('manage', 'Управление чатами', manage));

        if (data.rooms.length) {
          const rooms = data.rooms.slice().sort((a, b) => (b.latest?.sent ?? 0) - (a.latest?.sent ?? 0));
          const list = element('ul', 'chat-room-list');
          for (const room of rooms) {
            const item = element('li');
            item.append(roomRow(room));
            list.append(item);
          }
          inbox.append(list);
        } else {
          inbox.append(element('p', 'chat-inbox-note', 'Здесь появятся ваши беседы.'));
        }
        if (data.vip !== 'active') {
          inbox.append(element('p', 'chat-inbox-note', data.vip === 'inactive'
            ? 'Группы пловцов доступны участникам VIP-канала.'
            : 'Проверка доступа к VIP-группам временно недоступна.'));
        }
      } catch (error) {
        v.errorText(error);
        if (!v.signal.aborted) inbox.append(button('Обновить', list));
      }
    }

    function message(item) {
      const node = element('article', 'chat-message' + (item.own ? ' chat-message-own' : ''));
      const meta = element('div', 'chat-message-meta');
      meta.append(element('strong', '', item.own ? 'Вы' : item.name));
      if (item.coach) meta.append(element('span', 'chat-coach-label', 'Тренер'));
      const stamp = element('time', '', time.format(item.sent));
      stamp.dateTime = new Date(item.sent).toISOString();
      stamp.title = dateTime.format(item.sent);
      meta.append(stamp);
      node.append(meta);
      if (item.text) node.append(element('p', '', item.text));
      if (item.video) {
        try {
          const url = new URL(item.video);
          if (url.protocol === 'https:' && !url.username && !url.password) {
            const link = element('a', '', 'Открыть видео · ' + url.hostname);
            link.href = url.href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            node.append(link);
          }
        } catch {
          // A malformed link is omitted from the message.
        }
      }
      return node;
    }

    async function conversation(room) {
      const v = view(room.title, { back: list, room });
      const thread = element('div', 'chat-thread');
      thread.setAttribute('aria-label', 'Переписка');
      thread.setAttribute('role', 'region');
      thread.tabIndex = 0;
      const history = element('div', 'chat-history chat-width');
      const items = element('div', 'chat-messages');
      const empty = element('p', 'chat-empty', 'Здесь появятся сообщения.');
      empty.hidden = true;

      const dock = element('div', 'chat-dock');
      const composer = element('div', 'chat-width chat-composer');
      const form = element('form', 'chat-compose');
      const input = element('textarea');
      input.rows = 1;
      input.maxLength = 2000;
      input.placeholder = 'Сообщение';
      input.setAttribute('aria-label', 'Сообщение');
      let video;
      let hideVideo;
      if (room.kind !== 'group') {
        video = textInput('https://…', 2000);
        video.type = 'url';
        video.required = false;
        field(form, 'Ссылка на видео (по желанию)', video);
        const fieldset = video.parentElement;
        const toggle = iconButton('link', 'Добавить ссылку на видео', () => {
          showVideo(fieldset.hidden);
          if (!fieldset.hidden) video.focus();
        });
        const showVideo = visible => {
          fieldset.hidden = !visible;
          toggle.setAttribute('aria-expanded', String(visible));
        };
        showVideo(false);
        hideVideo = () => showVideo(false);
        form.append(toggle);
      } else {
        input.required = true;
      }
      form.append(input);
      const endpoint = '/rooms/' + room.id;
      let first;
      let last;
      let pending;
      let reading = false;
      let timer;
      let refreshAfterSend = false;
      const appended = new Set();
      let follow = true;
      const scrollToEnd = () => { thread.scrollTop = thread.scrollHeight; };
      thread.addEventListener('scroll', () => {
        follow = thread.scrollHeight - thread.clientHeight - thread.scrollTop < 80;
      }, { passive: true });

      function append(list, prepend = false) {
        if (!list.length) return;
        empty.hidden = true;
        const chunk = document.createDocumentFragment();
        for (const item of list) {
          if (appended.has(item.id)) continue;
          appended.add(item.id);
          first = Math.min(first ?? item.id, item.id);
          last = Math.max(last ?? item.id, item.id);
          chunk.append(message(item));
        }
        if (prepend) items.prepend(chunk);
        else items.append(chunk);
      }

      const earlier = button('Более ранние сообщения', async () => {
        earlier.disabled = true;
        try {
          const page = await v.request(endpoint + '?before=' + first);
          if (v.signal.aborted) return;
          const previousHeight = thread.scrollHeight;
          append(page.messages, true);
          earlier.hidden = !page.more;
          thread.scrollTop += thread.scrollHeight - previousHeight;
        } catch (error) { accessError(error); }
        finally { earlier.disabled = false; }
      });
      earlier.hidden = true;

      function accessError(error) {
        v.errorText(error);
        if (v.signal.aborted || !['room_forbidden', 'profile_required', 'telegram_auth_required'].includes(error.message)) return;
        clearInterval(timer);
        items.replaceChildren();
        empty.hidden = true;
        earlier.hidden = true;
        form.hidden = true;
      }

      async function refresh(forceScroll = false) {
        if (reading || v.signal.aborted) return;
        reading = true;
        try {
          const initial = last === undefined;
          const page = await v.request(endpoint + (initial ? '' : '?after=' + last));
          if (v.signal.aborted) return;
          if (initial) earlier.hidden = !page.more;
          append(page.messages);
          empty.hidden = last !== undefined;
          form.hidden = false;
          v.statusText('');
          if (forceScroll || follow) scrollToEnd();
        } catch (error) {
          accessError(error);
        } finally {
          reading = false;
          if (refreshAfterSend) {
            refreshAfterSend = false;
            refresh(true);
          }
        }
      }

      v.formSubmit(form, 'Отправить', async () => {
        const text = input.value;
        const link = video?.value.trim() || '';
        if (!text.trim() && !link) throw new Error('invalid_message');
        if (!pending || pending.text !== text || pending.video !== link) {
          pending = { text, video: link, clientId: crypto.randomUUID() };
        }
        try {
          await v.request(endpoint, pending);
        } catch (error) {
          accessError(error);
          throw error;
        }
        if (v.signal.aborted) return;
        if (input.value === text) input.value = '';
        if (video && video.value.trim() === link) {
          video.value = '';
          hideVideo();
        }
        pending = null;
        if (reading) refreshAfterSend = true;
        else await refresh(true);
      }, 'send');
      form.hidden = true;
      history.append(earlier, empty, items);
      thread.append(history);
      composer.append(v.status, form);
      dock.append(composer);
      v.panel.append(thread, dock);
      v.statusText('Загружаем переписку…');
      const heightChanges = new ResizeObserver(() => { if (follow) scrollToEnd(); });
      heightChanges.observe(thread);
      timer = setInterval(() => { if (!document.hidden) refresh(); }, 5000);
      cleanup = () => {
        clearInterval(timer);
        heightChanges.disconnect();
      };
      await refresh(true);
    }

    async function manage() {
      const v = view('Управление чатами', { back: list });
      const sheet = element('div', 'chat-width chat-sheet');
      v.panel.append(sheet);
      sheet.append(v.status);
      v.statusText('Загружаем настройки…');
      try {
        const data = await v.request('/manage');
        if (v.signal.aborted) return;
        v.statusText('');
        const assigning = element('form', 'chat-form');
        assigning.append(element('h3', '', 'Назначить тренера'));
        const student = field(assigning, 'Код ученика', textInput('Из профиля ученика', 12));
        student.autocapitalize = 'none';
        student.spellcheck = false;
        const coaches = data.coaches || [];
        const select = element('select');
        select.required = true;
        select.add(new Option('Выберите тренера', ''));
        for (const coach of coaches) {
          select.add(new Option(coach.name + ' · @' + coach.handle, '@' + coach.handle));
        }
        select.add(new Option('Другой тренер по коду', 'code'));
        select.value = coaches.length ? '' : 'code';
        field(assigning, 'Тренер', select);
        const coachCode = field(assigning, 'Код тренера', textInput('Из профиля тренера', 12));
        coachCode.autocapitalize = 'none';
        coachCode.spellcheck = false;
        const updateCoachCode = () => {
          const showCode = select.value === 'code';
          coachCode.required = showCode;
          coachCode.parentElement.hidden = !showCode;
        };
        select.addEventListener('change', updateCoachCode);
        updateCoachCode();
        const end = element('input');
        end.type = 'date';
        end.required = true;
        field(assigning, 'Последний день ведения (по Москве)', end);
        v.formSubmit(assigning, 'Назначить', async () => {
          const expires = Date.parse(end.value + 'T00:00:00+03:00') + 86400000;
          const coach = select.value === 'code' ? coachCode.value.trim() : select.value;
          await v.request('/manage', { action: 'assign', student: student.value.trim(), coach, expires });
          if (!v.signal.aborted) await manage();
        });
        sheet.append(assigning);
        if (data.assignments.length) {
          const active = element('section', 'chat-section');
          active.append(element('h3', '', 'Активное ведение'));
          for (const item of data.assignments) {
            const row = element('div', 'chat-profile');
            const details = element('div', '', item.student + ' · ' + item.coach);
            details.append(element('small', '', 'До ' + date.format(item.expires - 1)));
            const finish = button('Завершить', async () => {
              if (!window.confirm('Закрыть доступ к этому чату ученику и тренеру?')) return;
              finish.disabled = true;
              try {
                await v.request('/manage', { action: 'end', id: item.id });
                if (!v.signal.aborted) await manage();
              } catch (error) { v.errorText(error); }
              finally { finish.disabled = false; }
            });
            row.append(details, finish);
            active.append(row);
          }
          sheet.append(active);
        }

        const group = element('form', 'chat-form');
        group.append(element('h3', '', 'Создать группу к старту'));
        const name = field(group, 'Название старта или группы', textInput('Например, «Первый старт на 1 км»', 60));
        name.minLength = 2;
        const level = field(group, 'Для кого', choices('', true));
        v.formSubmit(group, 'Создать группу', async () => {
          await v.request('/manage', { action: 'createGroup', title: name.value, level: level.value });
          if (!v.signal.aborted) await list();
        });
        sheet.append(group);
      } catch (error) { v.errorText(error); }
    }

    list();
  }

  return { mount };
})();
