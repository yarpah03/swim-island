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
  };
  const dateTime = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
  const date = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeZone: 'Europe/Moscow' });
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

  function mount(root, preferredLevel) {
    dispose();
    dispose = () => {};
    if (!root) return;
    let screen;
    let cleanup = () => {};
    dispose = () => {
      screen?.abort();
      cleanup();
    };

    if (!hasTelegram()) {
      const notice = element('section', 'chat-panel');
      const link = element('a', 'chat-button chat-primary', 'Открыть в Telegram');
      link.href = 'https://t.me/SwimIslandVIPBot';
      notice.append(element('p', '', 'Войдите через Telegram, чтобы открыть свои чаты.'), link);
      root.replaceChildren(notice);
      return;
    }

    function view() {
      dispose();
      cleanup = () => {};
      screen = new AbortController();
      const panel = element('section', 'chat-panel');
      const status = element('p', 'chat-status');
      status.setAttribute('role', 'status');
      root.replaceChildren(panel, status);
      const signal = screen.signal;
      const statusText = text => { if (!signal.aborted) status.textContent = text; };
      const errorText = error => statusText(errors[error.message] || 'Не удалось связаться с чатами. Попробуйте ещё раз.');
      const request = (path, payload) => api(path, payload, signal);
      const formSubmit = (form, label, handler) => {
        const submit = element('button', 'chat-button chat-primary', label);
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
      return { panel, signal, request, statusText, errorText, formSubmit };
    }

    function profileForm(v, data) {
      const form = element('form', 'chat-form');
      form.append(element('h2', '', 'Профиль'));
      const name = field(form, 'Имя в чатах', textInput('Как к вам обращаться?'));
      name.minLength = 2;
      name.value = data.profile?.name || data.suggestedName || '';
      name.autocomplete = 'nickname';
      const level = field(form, 'Уровень подготовки', choices(data.profile?.level || preferredLevel));
      v.formSubmit(form, 'Сохранить', async () => {
        await v.request('/profile', { name: name.value, level: level.value });
        if (!v.signal.aborted) await list();
      });
      if (data.profile) form.append(button('Отмена', list));
      v.panel.append(form);
    }

    function roomList(v, rooms, title, empty) {
      const group = element('section', 'chat-section');
      group.append(element('h2', '', title));
      if (!rooms.length) group.append(element('p', '', empty));
      for (const room of rooms) {
        const item = button(room.title, () => conversation(room), 'chat-room');
        const subtitle = room.kind === 'group'
          ? room.level ? levelNames[room.level] : 'Подготовка к старту'
          : (room.coaching ? 'Ученик' : 'Тренер') + ' · до ' + date.format(room.expires - 1);
        item.append(element('small', '', subtitle));
        group.append(item);
      }
      v.panel.append(group);
    }

    async function list(edit = false) {
      const v = view();
      v.statusText('Открываем чаты…');
      try {
        const data = await v.request('');
        if (v.signal.aborted) return;
        v.statusText('');
        if (edit || !data.profile) {
          profileForm(v, data);
          return;
        }
        const profile = element('div', 'chat-profile');
        const details = element('div');
        details.append(element('strong', '', data.profile.name));
        if (data.coach) details.append(element('small', 'chat-coach-label', 'Тренер клуба · @' + data.coach.handle));
        details.append(element('small', '', 'Код для тренера · ' + data.profile.code));
        profile.append(details, button('Редактировать', () => list(true)));
        v.panel.append(profile);
        const rooms = data.rooms;
        const groupStatus = data.vip === 'inactive'
          ? 'Группы открываются для участников закрытого VIP-канала.'
          : 'Проверка доступа к VIP-группам временно недоступна.';
        roomList(v, rooms.filter(room => room.kind === 'group'), 'Группы пловцов', groupStatus);
        roomList(v, rooms.filter(room => room.kind === 'coaching'), 'Онлайн-ведение',
          data.coach
            ? 'Ученики появятся здесь после назначения.'
            : 'Чат появится после назначения тренера. Передайте ему код из профиля.');
        if (data.manager) v.panel.append(button('Управление чатами', manage));
      } catch (error) {
        v.errorText(error);
        if (!v.signal.aborted) v.panel.append(button('Обновить', list));
      }
    }

    function message(item) {
      const node = element('article', 'chat-message' + (item.own ? ' chat-message-own' : ''));
      const meta = element('div', 'chat-message-meta');
      meta.append(element('strong', '', item.own ? 'Вы' : item.name));
      if (item.coach) meta.append(element('span', 'chat-coach-label', 'Тренер'));
      const time = element('time', '', dateTime.format(item.sent));
      time.dateTime = new Date(item.sent).toISOString();
      meta.append(time);
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
      const v = view();
      const title = element('div', 'chat-title');
      title.append(button('← Чаты', list), element('h2', '', room.title));
      const thread = element('div', 'chat-thread');
      thread.setAttribute('aria-label', 'Переписка');
      thread.setAttribute('role', 'region');
      thread.tabIndex = 0;
      const empty = element('p', 'chat-empty', 'Здесь появятся сообщения.');
      const form = element('form', 'chat-form chat-compose');
      const input = field(form, 'Сообщение', element('textarea'));
      input.rows = 2;
      input.maxLength = 2000;
      input.placeholder = 'Напишите сообщение';
      let video;
      if (room.kind === 'coaching') {
        video = textInput('https://…', 2000);
        video.type = 'url';
        video.required = false;
        field(form, 'Ссылка на видео (по желанию)', video);
      } else {
        input.required = true;
      }
      const endpoint = '/rooms/' + room.id;
      let first;
      let last;
      let pending;
      let reading = false;
      let timer;
      let refreshAfterSend = false;
      const appended = new Set();

      function append(items, prepend = false) {
        if (!items.length) return;
        empty.hidden = true;
        const chunk = document.createDocumentFragment();
        for (const item of items) {
          if (appended.has(item.id)) continue;
          appended.add(item.id);
          first = Math.min(first ?? item.id, item.id);
          last = Math.max(last ?? item.id, item.id);
          chunk.append(message(item));
        }
        if (prepend) thread.prepend(chunk);
        else thread.append(chunk);
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
        thread.replaceChildren();
        earlier.hidden = true;
        form.hidden = true;
      }

      async function refresh(forceScroll = false) {
        if (reading || v.signal.aborted) return;
        reading = true;
        const atEnd = thread.scrollHeight - thread.clientHeight - thread.scrollTop < 80;
        try {
          const initial = last === undefined;
          const page = await v.request(endpoint + (initial ? '' : '?after=' + last));
          if (v.signal.aborted) return;
          if (initial) earlier.hidden = !page.more;
          append(page.messages);
          if (forceScroll || atEnd) thread.scrollTop = thread.scrollHeight;
          form.hidden = false;
          v.statusText('');
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
        if (video && video.value.trim() === link) video.value = '';
        pending = null;
        if (reading) refreshAfterSend = true;
        else await refresh(true);
      });
      form.hidden = true;
      thread.append(empty);
      v.panel.append(title, earlier, thread, form);
      v.statusText('Загружаем переписку…');
      timer = setInterval(() => { if (!document.hidden) refresh(); }, 5000);
      cleanup = () => clearInterval(timer);
      await refresh(true);
    }

    async function manage() {
      const v = view();
      const title = element('div', 'chat-title');
      title.append(button('← Чаты', list), element('h2', '', 'Управление чатами'));
      v.panel.append(title);
      try {
        const data = await v.request('/manage');
        if (v.signal.aborted) return;
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
        v.panel.append(assigning);
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
          v.panel.append(active);
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
        v.panel.append(group);
      } catch (error) { v.errorText(error); }
    }

    list();
  }

  return { mount };
})();
