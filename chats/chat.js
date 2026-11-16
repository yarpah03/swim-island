const SwimChats = (() => {
  const API = 'https://swim-island-chats.pages.dev/v1/chats';
  const tg = () => window.Telegram?.WebApp;
  const hasTelegram = () => Boolean(tg()?.initData);
  const levelNames = { n: 'Новичок', s: 'Средний уровень', p: 'Продвинутый' };
  const avatarChoices = [["🏊","Пловец"],["🌊","Волна"],["🐬","Дельфин"],["🐟","Рыбка"],["🦈","Акула"],["🐢","Черепаха"],["🐙","Осьминог"],["🤿","Маска"],["🏅","Медаль"],["⚡","Молния"],["🏝️","Остров"],["🔥","Огонь"]];
  const bot = 'https://t.me/SwimIslandVIPBot';
  const photoTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif'];
  const maxPhotoLength = 'data:image/jpeg;base64,'.length + 4 * Math.floor(512 * 1024 / 3);
  const errors = {
    telegram_auth_required: 'Закройте приложение и снова откройте его из VIP-канала.',
    room_forbidden: 'Доступ к этому чату закрыт.',
    profile_required: 'Сначала заполните профиль.',
    vip_unavailable: 'Проверка VIP-доступа временно недоступна.',
    invalid_name: 'Введите имя от 2 до 40 символов. Для названия группы допустимо до 60 символов.',
    invalid_level: 'Выберите уровень подготовки.',
    invalid_message: 'Введите сообщение до 8 000 символов.',
    message_too_long: 'Сообщение слишком длинное. Предел — 8 000 символов.',
    invalid_account: 'Проверьте коды участников.',
    account_not_found: 'Проверьте код из профиля участника.',
    unknown_coach: 'Этот тренер не найден в списке клуба.',
    invalid_email: 'Укажите почту клиента.',
    web_client_exists: 'Клиент с этой почтой уже есть. Выберите его в списке.',
    web_code_wait: 'Подождите перед выпуском нового кода.',
    web_access_ended: 'Срок ведения закончился.',
    web_auth_required: 'Для открытия переписки войдите ещё раз.',
    invalid_assignment: 'Проверьте коды участников и дату окончания ведения.',
    invalid_invite_link: 'Не удалось подготовить ссылку для регистрации. Выпустите новую ссылку для этого приглашения.',
    slow_down: 'Подождите секунду и повторите отправку.',
    manager_required: 'Управление чатами доступно владельцу клуба.',
    coach_required: 'Поиск по коду доступен тренерам клуба.',
    self_contact: 'Введите код другого участника.',
    invalid_avatar: 'Выберите аватар заново.',
    invalid_photo: 'Выберите фото в JPG, PNG или WebP до 15 МБ.',
    photo_read_failed: 'Не удалось открыть фото. Попробуйте другой файл.',
    attachment_too_large: 'Выберите фото размером до 25 МБ.',
    invalid_attachment: 'Не удалось прикрепить фото. Выберите другой снимок.',
    attachment_read_failed: 'Не удалось подготовить фото. Попробуйте файл JPG или PNG.',
    invalid_status: 'Введите статус до 80 символов.',
    notifications_unavailable: 'Уведомления временно недоступны.',
    notification_unavailable: 'Telegram не подтвердил отправку. Повторите проверку позже.',
    notification_blocked: 'Откройте бота и разрешите ему писать вам.',
    notification_test_wait: 'Тест можно повторить через минуту.',
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
    invitation: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
    book: '<path d="M12 6.5C9 4.5 6 4 3 5v14c3-1 6-.5 9 1 3-1.5 6-2 9-1V5c-3-1-6-.5-9 1.5Zm0 0V20"/>',
    message: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l1.5-4A8.5 8.5 0 1 1 21 11.5Z"/><path d="M8 10h8m-8 4h4"/>',
    next: '<path d="m9 6 6 6-6 6"/>',
    manage: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
    group: '<path d="M3 19v-1a5 5 0 0 1 10 0v1m2-5a4.5 4.5 0 0 1 6 4v1"/><circle cx="8" cy="8" r="3"/><path d="M15 5a3 3 0 0 1 0 6"/>',
    waves: '<path d="M3 9c3 0 3-2 6-2s3 2 6 2 3-2 6-2M3 15c3 0 3-2 6-2s3 2 6 2 3-2 6-2"/>',
    attach: '<path d="m8 13 6.8-6.8a2.5 2.5 0 0 1 3.5 3.5l-8.2 8.2a4 4 0 0 1-5.7-5.7l8.2-8.2m4 7-6.8 6.8"/>',
    install: '<path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    send: '<path d="M21 3 9.7 14.3M21 3l-7 18-4.3-6.7L3 10z"/>',
    delivered: '<path d="m5 12 4.3 4.3L19 6.7"/>',
    read: '<path d="m2 12 4.4 4.4L16 6.8m-4.6 8 .9 1L22 6.1"/>',
  };
  let dispose = () => {};
  let closeForward = () => {};

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
    else {
      const picture = room.person?.avatar;
      avatar.textContent = avatarChoices.some(([emoji]) => emoji === picture)
        ? picture
        : room.title.trim().split(/\s+/u).slice(0, 2).map(word => [...word][0]).join('').toUpperCase();
      if (typeof picture === 'string' && picture.startsWith('data:image/jpeg;base64,')) {
        const image = element('img');
        image.alt = '';
        image.loading = 'lazy';
        image.addEventListener('error', () => image.remove(), { once: true });
        image.src = picture;
        avatar.append(image);
      }
    }
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

  async function withPhoto(file, render) {
    const source = URL.createObjectURL(file);
    try {
      const photo = new Image();
      photo.src = source;
      await photo.decode();
      if (!photo.naturalWidth || !photo.naturalHeight) throw new Error('photo_read_failed');
      return render(photo);
    } finally {
      URL.revokeObjectURL(source);
    }
  }

  async function profileThumbnail(file) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) {
      throw new Error('invalid_photo');
    }
    return withPhoto(file, photo => {
      const side = Math.min(photo.naturalWidth, photo.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 160;
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#172f36';
      context.fillRect(0, 0, 160, 160);
      context.drawImage(photo, (photo.naturalWidth - side) / 2, (photo.naturalHeight - side) / 2, side, side, 0, 0, 160, 160);
      for (const quality of [0.88, 0.75, 0.60, 0.42]) {
        const image = canvas.toDataURL('image/jpeg', quality);
        if (image.startsWith('data:image/jpeg;base64,') && image.length <= 20500) return image;
      }
      throw new Error('photo_read_failed');
    });
  }

  async function preparePhoto(file) {
    if (file.size > 25 * 1024 * 1024) throw new Error('attachment_too_large');
    if (!photoTypes.includes(file.type) && !/\.(jpe?g|png|webp|heic|heif|avif)$/i.test(file.name)) {
      throw new Error('attachment_read_failed');
    }
    return withPhoto(file, photo => {
      const canvas = document.createElement('canvas');
      const longest = Math.max(photo.naturalWidth, photo.naturalHeight);
      for (const side of [1600, 1200, 800]) {
        const scale = Math.min(1, side / longest);
        canvas.width = Math.max(1, Math.round(photo.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(photo.naturalHeight * scale));
        const context = canvas.getContext('2d', { alpha: false });
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(photo, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.88, 0.75, 0.58]) {
          const jpeg = canvas.toDataURL('image/jpeg', quality);
          if (jpeg.startsWith('data:image/jpeg;base64,') && jpeg.length <= maxPhotoLength) return jpeg;
        }
        if (scale === 1 && longest <= 800) break;
      }
      throw new Error('attachment_read_failed');
    });
  }

  function messageId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  }

  async function api(path = '', payload, signal, photo = false, web = false) {
    const auth = web ? null : tg()?.initData;
    if (!web && !auth) throw new Error('telegram_auth_required');
    const controller = new AbortController();
    const stop = () => controller.abort();
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
    const timeout = setTimeout(stop, payload?.photo || photo ? 40000 : payload ? 18000 : 10000);
    try {
      const headers = auth ? { Authorization: 'tma ' + auth } : {};
      const options = { headers, signal: controller.signal, cache: 'no-store' };
      if (payload) {
        headers['Content-Type'] = 'application/json';
        options.method = 'POST';
        options.body = JSON.stringify(payload);
      }
      const response = await fetch((web ? '/v1/client/chats' : API) + path, options);
      if (photo && response.ok && response.headers.get('Content-Type') === 'image/jpeg') {
        return await response.blob();
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'unavailable');
      return body;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', stop);
    }
  }

  function roomRow(room, action, material) {
    const row = button('', action, 'chat-room');
    row.append(face(room));
    const summary = element('span', 'chat-room-summary');
    const title = element('strong', 'chat-room-name', room.title);
    const latest = room.latest;
    const preview = latest
      ? (latest.own ? 'Вы: ' : '') + (material?.title || latest.text.trim().replace(/\s+/gu, ' ') || (latest.photo ? 'Фото' : 'Видео'))
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

  function normalizeName(text) {
    return text.trim().toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
  }

  function registrationUrl(invite, trainers) {
    const url = new URL(invite);
    const role = trainers ? 'partner' : 'client';
    const token = new URLSearchParams(url.hash.slice(1)).get('invite');
    if (url.pathname !== '/' + role + '/' || !/^[a-f0-9]{64}$/.test(token ?? '')) {
      throw new Error('invalid_invite_link');
    }
    const registration = new URL('/' + role + '/register/', 'https://vip.swimisland.ru');
    registration.searchParams.set('invite', token);
    return registration.href;
  }

  function sortedRooms(rooms) {
    return rooms.slice().sort((a, b) => (b.latest?.sent ?? 0) - (a.latest?.sent ?? 0));
  }

  async function deliver(path, payload, signal, web) {
    const saved = await api(path, payload, signal, false, web);
    if (saved.ok !== true || !Number.isSafeInteger(saved.id) || saved.id <= 0) throw new Error('no_receipt');
    return saved.id;
  }

  async function forward(material, opener, openChat, resolveMaterial, web = false) {
    closeForward();
    const dialog = element('dialog', 'chat-forward-sheet');
    const title = element('h2', '', 'Переслать в чат');
    title.id = 'chat-forward-title';
    dialog.setAttribute('aria-labelledby', title.id);
    const header = element('div', 'chat-forward-heading');
    const close = button('Закрыть', dismiss);
    header.append(title, close);

    const content = element('div', 'chat-forward-content');
    const preview = element('div', 'chat-material');
    preview.append(element('strong', '', material.title));
    if (material.detail) preview.append(element('small', '', material.detail));
    const rooms = element('ul', 'chat-room-list');
    rooms.setAttribute('aria-label', 'Выбор чата');
    const status = element('p', 'chat-status');
    status.setAttribute('role', 'status');
    content.append(preview, status, rooms);

    const actions = element('div', 'chat-forward-actions');
    const send = button('Отправить', sendForward, 'chat-button chat-primary');
    const jump = button('Открыть чат', () => openChat(selected?.id));
    jump.hidden = true;
    send.hidden = true;
    send.disabled = true;
    actions.append(send, jump);
    dialog.append(header, content, actions);

    const controller = new AbortController();
    const { signal } = controller;
    const drafts = new Map();
    let selected;
    let selectedRow;
    let sending = false;
    let sent = false;

    const nativeBack = web ? null : tg()?.BackButton;
    const backWasVisible = nativeBack?.isVisible;
    function dismiss() {
      if (sending) return;
      dialog.close();
      closeForward();
    }
    nativeBack?.onClick(dismiss);
    nativeBack?.show();
    closeForward = () => {
      controller.abort();
      nativeBack?.offClick(dismiss);
      if (!backWasVisible) nativeBack?.hide();
      dialog.remove();
      if (opener.isConnected) opener.focus({ preventScroll: true });
      closeForward = () => {};
    };
    dialog.addEventListener('close', () => { if (!signal.aborted) closeForward(); });
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      dismiss();
    });
    document.body.append(dialog);
    dialog.showModal();
    close.focus({ preventScroll: true });

    if (!web && !hasTelegram()) {
      status.textContent = 'Чтобы переслать материал, откройте приложение в Telegram.';
      const link = element('a', 'chat-button chat-primary', 'Открыть в Telegram');
      link.href = bot + '?startapp';
      actions.append(link);
      return;
    }
    await loadRooms();

    async function loadRooms() {
      status.textContent = 'Загружаем чаты…';
      try {
        const data = await api('', undefined, signal, false, web);
        if (signal.aborted) return;
        if (!web && !data.profile) {
          status.textContent = 'Заполните профиль, чтобы отправлять материалы.';
          actions.append(button('Перейти в чаты', () => openChat()));
          return;
        }
        if (!data.rooms.length) {
          status.textContent = 'У вас пока нет доступных чатов.';
          return;
        }
        status.textContent = '';
        send.hidden = false;
        for (const room of sortedRooms(data.rooms)) {
          const latestMaterial = room.latest && resolveMaterial(room.latest.text);
          const row = roomRow(room, () => {
            if (sending || sent) return;
            selectedRow?.setAttribute('aria-pressed', 'false');
            selected = room;
            selectedRow = row;
            row.setAttribute('aria-pressed', 'true');
            send.disabled = false;
            status.textContent = '';
          }, latestMaterial);
          row.setAttribute('aria-pressed', 'false');
          const item = element('li');
          item.append(row);
          rooms.append(item);
        }
      } catch (error) {
        if (signal.aborted) return;
        status.textContent = errorMessage(error);
        const retry = button('Обновить', () => {
          retry.remove();
          loadRooms();
        });
        actions.append(retry);
      }
    }

    async function sendForward() {
      if (!selected || sending || sent) return;
      sending = true;
      send.disabled = true;
      close.disabled = true;
      const id = selected.id;
      if (!drafts.has(id)) drafts.set(id, messageId());
      status.textContent = 'Пересылаем…';
      try {
        await deliver('/rooms/' + id, {
          text: material.title + '\n' + material.url,
          clientId: drafts.get(id),
        }, signal, web);
        if (signal.aborted) return;
        sent = true;
        status.textContent = 'Отправлено в чат «' + selected.title + '».';
        send.hidden = true;
        jump.hidden = false;
        jump.focus({ preventScroll: true });
      } catch (error) {
        if (signal.aborted) return;
        status.textContent = errors[error.message] || 'Не получили подтверждение. Нажмите «Отправить» ещё раз.';
      } finally {
        sending = false;
        close.disabled = false;
        send.disabled = sent;
      }
    }
  }

  function mount(root, preferredLevel, returnHash = '#home', exerciseLibrary, launch = {}) {
    closeForward();
    dispose();
    dispose = () => {};
    if (!root) return;
    const web = launch.web === true;
    const telegram = web ? null : tg();
    const viewport = window.visualViewport;
    const exit = launch.webHome || (() => { location.hash = returnHash; });
    let back = exit;
    const goBack = () => {
      const dialog = root.querySelector('dialog[open]');
      if (dialog) dialog.close();
      else back();
    };
    let alerts = {};
    let writeGranted = false;
    let targetRoom = launch.targetRoom;
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
    const nativeBack = !web && hasTelegram() ? telegram.BackButton : null;
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
      const backLabel = options.backLabel || (options.back ? 'К списку чатов' : web ? 'В главное меню' : 'Назад в приложение');
      bar.append(iconButton('back', backLabel, goBack));
      if (options.room) {
        const room = options.room;
        if (room.person) {
          const contact = button('', () => showPerson(room.person), 'chat-contact');
          contact.setAttribute('aria-label', 'Профиль · ' + room.person.name);
          contact.append(face(room));
          bar.append(contact);
        } else bar.append(face(room));
        heading.append(element('small', '', web ? 'Ведение по ' + date.format(room.expires - 1) : roomDetails(room)));
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
      const request = (path, payload, photo) => api(path, payload, signal, photo, web);
      const formSubmit = (form, label, handler, symbol, container = form) => {
        const submit = element('button', 'chat-button chat-primary', symbol ? '' : label);
        if (symbol) iconLabel(submit, symbol, label);
        submit.type = 'submit';
        container.append(submit);
        form.addEventListener('submit', async event => {
          event.preventDefault();
          if (submit.disabled) return;
          submit.disabled = true;
          statusText('');
          try { await handler(); }
          catch (error) { errorText(error); }
          finally { submit.disabled = false; }
        });
        return submit;
      };
      return { panel, actions, status, signal, request, statusText, errorText, formSubmit };
    }

    if (!web && !hasTelegram()) {
      const v = view(launch.account ? 'Личный кабинет' : 'Чаты');
      const notice = element('div', 'chat-width chat-sheet');
      const link = element('a', 'chat-button chat-primary', 'Открыть в Telegram');
      link.href = bot + (launch.account ? '?startapp=profile' : '?startapp');
      notice.append(element('p', '', 'Откройте приложение в Telegram, чтобы войти в клуб.'), link);
      v.panel.append(notice);
      return;
    }

    function profileForm(v, data, save, cancel) {
      const form = element('form', 'chat-form chat-account-card');
      form.append(element('p', 'chat-account-hint', 'Собеседники видят ваш ник и аватар.'));
      const name = field(form, 'Ник в приложении', textInput('Как к вам обращаться?'));
      name.minLength = 2;
      name.value = data.profile?.name || data.suggestedName || '';
      name.autocomplete = 'nickname';

      const currentAvatar = data.profile?.avatar || '';
      let photo = currentAvatar.startsWith('data:image/jpeg;base64,') ? currentAvatar : '';
      let selected = photo ? 'photo' : currentAvatar;
      const picker = element('fieldset', 'chat-avatar-picker');
      picker.append(element('legend', '', 'Аватар'));
      const grid = element('div', 'chat-avatar-grid');
      const preview = element('div', 'chat-avatar-preview');
      const renderPreview = () => {
        const title = name.value.trim() || 'Пловец';
        const avatar = selected === 'photo' ? photo : selected;
        preview.replaceChildren(face({ kind: 'direct', title, person: { avatar } }), element('strong', '', title));
      };
      const avatarOption = (value, label, symbol) => {
        const tile = element('label', 'chat-avatar-option');
        const choice = element('input');
        choice.type = 'radio';
        choice.name = 'profile-avatar';
        choice.value = value;
        choice.checked = value === selected;
        choice.addEventListener('change', () => {
          selected = choice.value;
          renderPreview();
        });
        tile.append(choice, element('span', '', symbol || label));
        choice.setAttribute('aria-label', label);
        grid.append(tile);
        return tile;
      };
      avatarOption('', 'Инициалы');
      const photoTile = avatarOption('photo', 'Моё фото');
      photoTile.hidden = !photo;
      for (const [emoji, label] of avatarChoices) avatarOption(emoji, label, emoji);

      const upload = element('label', 'chat-button chat-avatar-upload', 'Загрузить фото');
      const file = element('input');
      file.type = 'file';
      file.accept = 'image/jpeg,image/png,image/webp';
      file.setAttribute('aria-label', 'Загрузить фото');
      upload.append(file);
      const photoFeedback = element('p', 'chat-status');
      photoFeedback.setAttribute('role', 'status');
      let uploadSequence = 0;
      file.addEventListener('change', async () => {
        const [image] = file.files;
        file.value = '';
        if (!image) return;
        const sequence = ++uploadSequence;
        submit.disabled = true;
        photoFeedback.textContent = 'Готовим фото…';
        try {
          const thumbnail = await profileThumbnail(image);
          if (v.signal.aborted || sequence !== uploadSequence) return;
          photo = thumbnail;
          photoTile.hidden = false;
          photoTile.querySelector('input').checked = true;
          selected = 'photo';
          renderPreview();
          photoFeedback.textContent = '';
        } catch (error) {
          if (!v.signal.aborted && sequence === uploadSequence) {
            photoFeedback.textContent = errors[error.message] || errors.photo_read_failed;
          }
        } finally {
          if (sequence === uploadSequence) submit.disabled = false;
        }
      });
      name.addEventListener('input', renderPreview);
      renderPreview();
      picker.append(preview, grid, upload, photoFeedback);
      form.append(picker);
      const level = field(form, 'Уровень подготовки', choices(data.profile?.level || preferredLevel));
      const status = field(form, 'Статус (по желанию)', textInput('Например, готовлюсь к первому заплыву', 80));
      status.value = data.profile?.status || '';
      status.required = false;

      const controls = element('div', 'chat-account-actions');
      const submit = v.formSubmit(form, 'Сохранить профиль', async () => {
        file.disabled = true;
        try {
          await v.request('/profile', { name: name.value, level: level.value, avatar: selected === 'photo' ? photo : selected, status: status.value });
        } finally {
          file.disabled = false;
        }
        if (!v.signal.aborted) await save();
      }, undefined, controls);
      if (cancel) controls.append(button('Отмена', cancel));
      form.append(controls);
      return form;
    }

    function accountSummary(person, coach) {
      const identity = element('div', 'chat-identity');
      identity.append(face({ kind: 'direct', title: person.name, person }));
      const details = element('div', 'chat-identity-copy');
      details.append(element('h2', '', person.name));
      if (coach) details.append(element('small', 'chat-coach-label', 'Тренер клуба · @' + coach.handle));
      const level = levelNames[person.level];
      if (level) details.append(element('small', '', level));
      if (person.status) details.append(element('p', 'chat-profile-status', person.status));
      identity.append(details);
      return identity;
    }

    function showPerson(person) {
      const dialog = element('dialog', 'chat-exercise-sheet chat-person-sheet');
      if (typeof dialog.showModal !== 'function') return;
      dialog.setAttribute('aria-label', 'Профиль · ' + person.name);
      const heading = element('div', 'chat-exercise-heading');
      heading.append(element('h2', '', 'Профиль'), button('Закрыть', () => dialog.close()));
      dialog.append(heading, accountSummary(person));
      dialog.addEventListener('click', event => {
        if (event.target === dialog) dialog.close();
      });
      dialog.addEventListener('close', () => dialog.remove(), { once: true });
      root.append(dialog);
      dialog.showModal();
    }

    function notificationsForm(v, data) {
      const card = element('section', 'chat-account-card chat-notification-card');
      card.append(element('h2', '', 'Уведомления'));
      if (!data.notifications?.available) {
        card.append(element('p', '', 'Уведомления временно недоступны.'));
        return card;
      }
      card.append(element('p', '', 'Бот Telegram уведомит о новых сообщениях в личных чатах, на онлайн-ведении и в группах.'));
      const feedback = element('p', 'chat-status');
      feedback.setAttribute('role', 'status');
      const help = element('a', 'chat-bot-help', 'Открыть бота в Telegram');
      help.href = bot + '?start=notify';
      help.target = '_blank';
      help.rel = 'noopener noreferrer';
      help.hidden = true;
      const text = value => { if (!v.signal.aborted) feedback.textContent = value; };
      writeGranted ||= data.telegramWriteAllowed;
      const permission = async () => {
        if (writeGranted || alerts.personal || alerts.groups) return true;
        if (!telegram?.requestWriteAccess || telegram.isVersionAtLeast?.('6.9') === false) {
          help.hidden = false;
          text('Запустите бота и откройте приложение снова.');
          return false;
        }
        writeGranted = await new Promise(resolve => telegram.requestWriteAccess(resolve));
        if (!writeGranted) text('Разрешите боту писать вам, чтобы включить уведомления.');
        return writeGranted;
      };
      const test = button('Проверить уведомления', async () => {
        test.disabled = true;
        help.hidden = true;
        text('Отправляем проверку…');
        try {
          await v.request('/notifications', { action: 'test' });
          text('Тестовое уведомление отправлено в Telegram.');
        } catch (error) {
          if (!v.signal.aborted && error.message === 'notification_blocked') help.hidden = false;
          text(errorMessage(error));
        } finally {
          test.disabled = false;
        }
      });
      const actions = element('div', 'chat-account-actions');
      const enabled = () => alerts.personal && alerts.groups;
      const toggle = button('', async () => {
        const on = !enabled();
        toggle.disabled = true;
        test.disabled = true;
        help.hidden = true;
        text('');
        try {
          if (on && !await permission()) return;
          if (v.signal.aborted) return;
          await v.request('/notifications', { personal: on, groups: on });
          if (v.signal.aborted) return;
          alerts = { personal: on, groups: on };
          sync();
          text(on ? 'Уведомления включены для всех чатов.' : 'Уведомления выключены.');
        } catch (error) {
          text(errorMessage(error));
        } finally {
          toggle.disabled = false;
          test.disabled = false;
        }
      });
      const sync = () => {
        test.hidden = !enabled();
        toggle.textContent = enabled() ? 'Выключить уведомления' : 'Включить уведомления';
        toggle.classList.toggle('chat-primary', !enabled());
      };
      sync();
      actions.append(toggle, test);
      card.append(actions, feedback, help);
      return card;
    }

    async function account(fromList = false, initial) {
      const options = fromList ? { back: list } : {};
      const v = view('Личный кабинет', options);
      const page = element('div', 'chat-width chat-cabinet');
      page.append(v.status);
      v.panel.append(page);
      v.statusText('Загружаем профиль…');
      try {
        const data = initial ?? await v.request('');
        if (v.signal.aborted) return;
        alerts = data.notifications || {};
        v.statusText('');
        if (!data.profile) {
          page.prepend(profileForm(v, data, () => account(fromList)));
          return;
        }
        const hero = element('section', 'chat-account-card chat-account-hero');
        hero.append(accountSummary(data.profile, data.coach));
        hero.append(button('Редактировать профиль', () => {
          const edit = view('Редактировать профиль', { back: () => account(fromList, data), backLabel: 'В личный кабинет' });
          const layout = element('div', 'chat-width chat-cabinet');
          const done = () => account(fromList);
          layout.append(profileForm(edit, data, done, done), edit.status);
          edit.panel.append(layout);
        }, 'chat-button chat-primary'));

        const access = element('section', 'chat-account-card chat-account-code');
        const code = element('code', '', data.profile.code);
        const copied = element('p', 'chat-status');
        copied.setAttribute('role', 'status');
        const copy = button('Скопировать', async () => {
          try {
            await navigator.clipboard.writeText(data.profile.code);
            copied.textContent = 'Код скопирован.';
          } catch {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(code);
            selection.removeAllRanges();
            selection.addRange(range);
            copied.textContent = 'Код выделен. Скопируйте его из меню.';
          }
        });
        const codeRow = element('div', 'chat-account-actions');
        codeRow.append(code, copy);
        access.append(element('h2', '', 'Код для тренера'), codeRow, copied);
        page.append(hero);
        if (data.coach || data.manager) {
          page.append(coachCard('Кабинет тренера', 'Ученики, приглашения, чаты и материалы', 'manage',
            () => coachDesk(data, () => account(fromList)), true));
        }
        page.append(notificationsForm(v, data), access);
        if (!fromList) {
          const link = element('a', 'chat-button', 'Перейти в чаты');
          link.href = '#chats';
          page.append(link);
        }
      } catch (error) {
        v.errorText(error);
        if (!v.signal.aborted) page.append(button('Обновить', () => account(fromList)));
      }
    }

    function coachCard(title, description, symbol, action, primary = false) {
      const link = button('', action, 'chat-coach-card' + (primary ? ' chat-coach-primary' : ''));
      const text = element('span', 'chat-coach-card-copy');
      text.append(element('strong', '', title), element('span', '', description));
      link.append(icon(symbol), text, icon('next'));
      return link;
    }

    function coachingRooms(rooms, clients) {
      const webIds = new Set(clients.map(client => client.id));
      return rooms.filter(room => room.coaching && !webIds.has(room.id));
    }

    async function coachDesk(data, backToProfile) {
      const backToDesk = () => coachDesk(data, backToProfile);
      const v = view('Кабинет тренера', { back: backToProfile, backLabel: 'В личный кабинет' });
      const page = element('div', 'chat-width chat-cabinet');
      const grid = element('div', 'chat-coach-grid');
      const students = coachCard('Ученики', 'Сроки ведения и переписка', 'person', () => webClients(backToDesk, 'students'));
      const invites = coachCard('Приглашения', 'Новые ссылки и ожидающие регистрации', 'invitation',
        () => webClients(backToDesk, 'invites'), true);
      if (data.coach) grid.append(invites, students);
      grid.append(
        coachCard('Чаты', 'Переписка с учениками и группами', 'message', () => list(undefined, backToDesk)),
        coachCard('Курсы и тренировки', 'Материалы на странице партнёра', 'book', () => coachMaterials(backToDesk)),
      );
      page.append(grid);
      if (data.manager) {
        const club = element('section', 'chat-coach-section');
        const controls = element('div', 'chat-coach-grid');
        club.append(element('h2', '', 'Управление клубом'), controls);
        controls.append(
          coachCard('Тренеры', 'Приглашения и доступ к публикациям', 'person', () => webClients(backToDesk, 'trainers')),
          coachCard('Назначения', 'Закрепить тренера за учеником', 'manage', () => manage(backToDesk, 'assignments')),
          coachCard('Группы', 'Создать группу к старту', 'group', () => manage(backToDesk, 'groups')),
        );
        page.append(club);
      }
      v.panel.append(page);
      if (!data.coach) return;
      try {
        const [{ clients }, { rooms }] = await Promise.all([v.request('/clients'), v.request('')]);
        if (v.signal.aborted) return;
        const active = clients.filter(client => client.entered && client.expires > Date.now()).length +
          coachingRooms(rooms, clients).length;
        const pending = clients.filter(client => !client.entered && client.expires > Date.now()).length;
        students.querySelector('.chat-coach-card-copy').append(element('small', '', 'Активных учеников: ' + active));
        invites.querySelector('.chat-coach-card-copy').append(element('small', '', 'Ожидают регистрации: ' + pending));
      } catch {
        // The tools remain available even when their summary counts are unavailable.
      }
    }

    function coachMaterials(backToDesk) {
      const v = view('Курсы и тренировки', { back: backToDesk, backLabel: 'В кабинет тренера' });
      const page = element('div', 'chat-width chat-cabinet');
      const card = element('section', 'chat-account-card');
      const editor = element('a', 'chat-button chat-primary', 'Открыть редактор материалов');
      editor.href = 'https://vip.swimisland.ru/partner/';
      editor.target = '_blank';
      editor.rel = 'noopener noreferrer';
      const catalog = element('a', 'chat-button', 'Смотреть каталог партнёров');
      catalog.href = '#partners';
      const actions = element('div', 'chat-account-actions');
      actions.append(editor, catalog);
      card.append(element('h2', '', 'Страница партнёра'),
        element('p', '', 'В редакторе можно добавлять курсы и тренировки, сохранять черновики и управлять публикациями. Войдите с логином и паролем партнёра.'), actions);
      page.append(card);
      v.panel.append(page);
    }

    async function webClients(backToDesk, section, created) {
      const trainers = section === 'trainers';
      const students = section === 'students';
      const endpoint = trainers ? '/partner-admin' : '/clients';
      const reload = invitation => webClients(backToDesk, section, invitation);
      const title = trainers ? 'Тренеры' : students ? 'Ученики' : 'Приглашения';
      const v = view(title, { back: backToDesk, backLabel: 'В кабинет тренера' });
      const page = element('div', 'chat-width chat-cabinet');
      page.append(v.status);
      v.panel.append(page);
      const inviteCard = element('section', 'chat-account-card chat-form chat-web-invite');
      inviteCard.hidden = true;
      page.append(inviteCard);
      const showInvite = data => {
        const address = element('input');
        address.value = registrationUrl(data.invite, trainers);
        address.type = 'url';
        address.readOnly = true;
        const feedback = element('p', 'chat-status');
        feedback.setAttribute('role', 'status');
        const copy = button('Скопировать ссылку для регистрации', async () => {
          try {
            await navigator.clipboard.writeText(address.value);
            feedback.textContent = 'Ссылка скопирована.';
          } catch {
            address.focus();
            address.select();
            feedback.textContent = 'Скопируйте выделенную ссылку целиком.';
          }
        }, 'chat-button chat-primary');
        inviteCard.replaceChildren(element('h2', '', 'Ссылка «' + data.label + '»'), element('p', '',
          trainers ? 'Тренер откроет форму регистрации и сам задаст свои данные.'
            : 'Клиент откроет форму регистрации и сам задаст свои данные для входа.'));
        field(inviteCard, 'Ссылка для регистрации', address);
        inviteCard.append(copy, feedback);
        inviteCard.hidden = false;
        inviteCard.scrollIntoView({ block: 'nearest' });
      };
      v.statusText('Загружаем список…');
      try {
        if (created) showInvite(created);
        const [{ clients, mail }, overview] = await Promise.all([
          v.request(endpoint), students ? v.request('') : null,
        ]);
        if (v.signal.aborted) return;
        v.statusText('');
        const expiresOn = input => Date.parse(input.value + 'T00:00:00+03:00') + 86400000;
        const dateInput = expires => {
          const input = element('input');
          input.type = 'date';
          input.required = true;
          const moscow = ms => new Date(ms + 3 * 3600000).toISOString().slice(0, 10);
          input.min = moscow(Date.now());
          input.value = moscow(expires > Date.now() ? expires - 1 : Date.now() + 30 * 86400000);
          return input;
        };

        if (!students) {
          const form = element('form', 'chat-account-card chat-form');
          const invitation = element('details', 'chat-roster-section');
          invitation.open = !created;
          invitation.append(element('summary', '', trainers ? 'Новая ссылка для тренера' : 'Новая ссылка для клиента'), form);
          const label = field(form, 'Название ссылки', textInput('Например, Алексей', 60));
          label.autocomplete = 'off';
          const expiry = trainers ? null : field(form, 'Последний день ведения по Москве', dateInput(0));
          v.formSubmit(form, 'Создать ссылку', async () => {
            const result = await v.request(endpoint,
              { action: 'invite', label: label.value, expires: expiry ? expiresOn(expiry) : undefined });
            if (!v.signal.aborted) await reload(result);
          });
          page.append(invitation);
        } else {
          page.append(button('Найти ученика по коду', () => findPerson(reload, 'К ученикам'), 'chat-button chat-coach-find'));
        }

        const sections = new Map();
        for (const [id, heading] of [
          ['telegram', 'Ученики в Telegram'], ['active', 'Активные'], ['pending', 'Ожидают регистрации'],
          ['closed', students || trainers ? 'Завершённые' : 'Истёкшие приглашения'],
        ]) {
          const group = element('details', 'chat-roster-section');
          group.open = id !== 'closed';
          const summary = element('summary', '', heading);
          group.append(summary);
          sections.set(id, { group, summary, heading, rows: [] });
        }
        if (students) {
          for (const room of coachingRooms(overview.rooms, clients)) {
            const card = element('article', 'chat-roster-row');
            const main = element('div', 'chat-roster-main');
            const identity = element('div', 'chat-roster-name');
            identity.append(element('h2', '', room.title), element('small', '', 'до ' + date.format(room.expires - 1)));
            main.append(identity, button('Открыть чат', () => conversation(room, reload, 'К ученикам')));
            card.append(main);
            sections.get('telegram').rows.push({ card, label: normalizeName(room.title) });
          }
        }
        for (const client of clients) {
          if (!trainers && Boolean(client.entered) !== students) continue;
          const card = element('article', 'chat-roster-row');
          const main = element('div', 'chat-roster-main');
          const name = element('div', 'chat-roster-name');
          name.append(element('h2', '', client.label));
          const details = [];
          if (client.name && client.name !== client.label) details.push(client.name);
          const active = trainers ? client.active : client.expires > Date.now();
          if (!trainers && active) details.push('до ' + date.format(client.expires - 1));
          if (details.length) name.append(element('small', '', details.join(' · ')));
          main.append(name);
          card.append(main);
          const access = element('details', 'chat-roster-access');
          access.append(element('summary', '', trainers || students ? 'Управление доступом' : 'Управление приглашением'));
          const actions = element('div', 'chat-account-actions');
          if (client.email) access.append(element('p', 'chat-web-email', client.email));
          const feedback = element('p', 'chat-status');
          feedback.setAttribute('role', 'status');
          async function change(action, control) {
            control.disabled = true;
            try {
              const result = await v.request(endpoint, { action, id: client.id });
              if (v.signal.aborted) return;
              await reload(action === 'replace' ? result : undefined);
            } catch (error) { v.errorText(error); }
            finally { control.disabled = false; }
          }
          if (active) {
            if (students) {
              const room = overview.rooms.find(room => room.id === client.id);
              if (room) main.append(button('Открыть чат', () => conversation(room, reload, 'К ученикам')));
            }
            const rotate = button(client.entered ? 'Восстановить доступ по новой ссылке' : 'Выпустить новую ссылку', () => {
              const question = client.entered
                ? 'Новая ссылка сбросит пароль и завершит текущие сеансы. Продолжить?'
                : 'После выпуска новой ссылки прежняя перестанет действовать. Продолжить?';
              if (window.confirm(question)) return change('replace', rotate);
            });
            actions.append(rotate);
            const code = button(mail ? 'Код вручную' : 'Подготовить письмо с кодом', async () => {
              code.disabled = true;
              try {
                const result = await v.request('/clients', { action: 'code', id: client.id });
                if (v.signal.aborted) return;
                const letter = element('a', 'chat-button', 'Открыть письмо с кодом');
                const body = 'Ваш код входа: ' + result.code + '\n\nКод действует 15 минут. Введите его в кабинете по ссылке от тренера.';
                letter.href = 'mailto:' + encodeURIComponent(client.email).replace('%40', '@') +
                  '?subject=' + encodeURIComponent('Код входа в Плавательный остров VIP') + '&body=' + encodeURIComponent(body);
                feedback.replaceChildren(document.createTextNode('Код для письма ' + result.code + '. '), letter);
              } catch (error) {
                feedback.textContent = errorMessage(error);
              } finally { code.disabled = false; }
            });
            if (client.email) actions.append(code);
            const end = button('Завершить доступ', () => {
              const question = trainers ? 'Завершить доступ тренера и скрыть его страницу из каталога?'
                : 'Завершить доступ клиента к кабинету и чату?';
              if (window.confirm(question)) return change('end', end);
            });
            actions.append(end);
          } else if (trainers) {
            const enable = button('Включить доступ', () => change('activate', enable));
            actions.append(enable);
          }
          access.append(actions, feedback);
          if (!trainers) {
            const renewal = element('form', 'chat-form');
            const endDate = field(renewal, 'Новая дата окончания', dateInput(client.expires));
            v.formSubmit(renewal, 'Сохранить срок', async () => {
              await v.request(endpoint, { action: 'renew', id: client.id, expires: expiresOn(endDate) });
              if (!v.signal.aborted) await reload();
            });
            access.append(renewal);
          }
          card.append(access);
          const group = sections.get(!active ? 'closed' : client.entered ? 'active' : 'pending');
          group.rows.push({ card, label: normalizeName([client.label, client.name, client.email].filter(Boolean).join(' ')) });
        }
        const groups = [...sections.values()].filter(group => group.rows.length);
        if (!groups.length) {
          page.append(element('p', 'chat-inbox-note',
            students ? 'Здесь появятся ваши ученики.' : 'Здесь появятся созданные приглашения.'));
          return;
        }
        const search = element('input');
        search.type = 'search';
        search.placeholder = students ? 'Имя ученика' : trainers ? 'Имя или название ссылки' : 'Название ссылки';
        const filter = element('div', 'chat-roster-search');
        field(filter, 'Поиск по списку', search);
        const empty = element('p', 'chat-inbox-note', 'По вашему запросу ничего не найдено.');
        const update = () => {
          const query = normalizeName(search.value);
          let total = 0;
          for (const { group, summary, heading, rows } of groups) {
            const visible = rows.filter(row => row.label.includes(query));
            group.hidden = !visible.length;
            if (query && visible.length) group.open = true;
            summary.textContent = heading + ' · ' + visible.length;
            group.replaceChildren(summary, ...visible.map(row => row.card));
            total += visible.length;
          }
          empty.hidden = total !== 0;
        };
        search.addEventListener('input', update);
        page.append(filter, ...groups.map(group => group.group), empty);
        update();
        if (created) inviteCard.scrollIntoView({ block: 'nearest' });
      } catch (error) {
        v.errorText(error);
        if (!v.signal.aborted) page.append(button('Обновить', () => reload()));
      }
    }

    function findPerson(returnTo = list, backLabel) {
      const v = view('Найти по коду', { back: returnTo, backLabel });
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
          const details = element('div', 'chat-find-person');
          details.append(face({ kind: 'direct', title: person.name, person }), element('strong', '', person.name));
          const open = button('Открыть чат', async () => {
            open.disabled = true;
            feedback.textContent = '';
            try {
              const room = await v.request('/direct', { code: value });
              if (!v.signal.aborted && result.contains(open)) await conversation(room, () => findPerson(returnTo, backLabel), 'К поиску');
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

    async function list(roomToOpen, backToDesk, initialCategory = 'all') {
      if (typeof roomToOpen === 'string') targetRoom = roomToOpen;
      const reload = () => list(undefined, backToDesk, initialCategory);
      const v = view('Чаты', backToDesk ? { back: backToDesk, backLabel: 'В кабинет тренера' } : {});
      const inbox = element('div', 'chat-width chat-inbox');
      v.panel.append(inbox);
      inbox.append(v.status);
      v.statusText('Загружаем чаты…');
      try {
        const data = await v.request('');
        if (v.signal.aborted) return;
        v.statusText('');
        if (!web && !data.profile) {
          const sheet = element('div', 'chat-sheet');
          sheet.append(profileForm(v, data, reload), v.status);
          inbox.append(sheet);
          return;
        }
        if (data.coach) {
          const find = iconButton('search', 'Найти по коду', () => findPerson(reload));
          find.classList.add('chat-find-button');
          find.append(element('span', '', 'По коду'));
          v.actions.append(find);
        }
        alerts = data.notifications || {};
        if (targetRoom) {
          const room = data.rooms.find(room => room.id === targetRoom);
          targetRoom = '';
          if (room) {
            await conversation(room, reload);
            return;
          }
          v.statusText('Эта беседа сейчас недоступна.');
        }
        if (!web) {
          v.actions.append(iconButton('person', 'Профиль', () => account(true, data)));
          if (data.manager) v.actions.append(iconButton('manage', 'Управление чатами', () => manage(reload)));
        }

        if (data.rooms.length) {
          const rooms = sortedRooms(data.rooms);
          const results = element('ul', 'chat-room-list');
          const empty = element('p', 'chat-inbox-note', 'Чаты не найдены.');
          empty.hidden = true;
          const roomCategory = room => room.kind === 'group' ? 'group' : room.coaching ? 'students' : 'personal';
          let category = rooms.some(room => roomCategory(room) === initialCategory) ? initialCategory : 'all';
          let query = '';
          const update = () => {
            const selected = rooms.filter(room =>
              (category === 'all' || roomCategory(room) === category) && normalizeName(room.title).includes(query));
            results.replaceChildren();
            for (const room of selected) {
              const row = element('li');
              const material = room.latest && launch.materials?.resolve(room.latest.text);
              row.append(roomRow(room, () => conversation(room, () => list(undefined, backToDesk, category)), material));
              results.append(row);
            }
            empty.hidden = Boolean(selected.length);
          };
          if (web || data.coach || data.manager) {
            const search = element('input');
            search.type = 'search';
            search.placeholder = web ? 'Введите имя тренера' : 'Имя или название группы';
            search.addEventListener('input', () => { query = normalizeName(search.value); update(); });
            const filter = element('div', 'chat-inbox-filter');
            field(filter, 'Поиск по имени', search);
            inbox.append(filter);
          }
          if (data.coach || data.manager) {
            const tabs = element('nav', 'chat-filter-tabs');
            tabs.setAttribute('aria-label', 'Категории чатов');
            const filters = [['all', 'Все'], ['students', 'Ученики'], ['personal', 'Личные'], ['group', 'Группы']];
            for (const [value, label] of filters) {
              if (value !== 'all' && !rooms.some(room => roomCategory(room) === value)) continue;
              const control = button(label, () => {
                category = value;
                for (const tab of tabs.children) tab.setAttribute('aria-pressed', String(tab === control));
                update();
              });
              control.setAttribute('aria-pressed', String(value === category));
              tabs.append(control);
            }
            inbox.append(tabs);
          }
          inbox.append(results, empty);
          update();
        } else {
          inbox.append(element('p', 'chat-inbox-note', 'Здесь появятся ваши беседы.'));
        }
        if (!web && data.vip !== 'active') {
          inbox.append(element('p', 'chat-inbox-note', data.vip === 'inactive'
            ? 'Группы пловцов доступны участникам VIP-канала.'
            : 'Проверка доступа к VIP-группам временно недоступна.'));
        }
      } catch (error) {
        if (v.signal.aborted) return;
        if (web && ['web_auth_required', 'web_access_ended'].includes(error.message)) launch.webSessionLost();
        else {
          v.errorText(error);
          inbox.append(button('Обновить', reload));
        }
      }
    }

    function exerciseSheet(panel) {
      if (!exerciseLibrary) return null;
      const sheet = element('dialog', 'chat-exercise-sheet');
      if (typeof sheet.showModal !== 'function') return null;
      const title = element('h2', '', '');
      title.id = 'chat-exercise-title';
      sheet.setAttribute('aria-labelledby', title.id);
      const heading = element('div', 'chat-exercise-heading');
      const close = button('Закрыть', () => sheet.close());
      heading.append(title, close);
      const content = element('div', 'chat-exercise-body');
      sheet.append(heading, content);
      panel.append(sheet);
      let opener;
      sheet.addEventListener('close', () => {
        content.replaceChildren();
        opener?.focus({ preventScroll: true });
      });
      sheet.addEventListener('click', event => {
        if (event.target === sheet) sheet.close();
      });
      const show = entry => {
        title.textContent = entry.title;
        content.replaceChildren();
        sheet.scrollTop = 0;
        exerciseLibrary.render(content, entry);
      };
      return (trigger, entries) => {
        opener = trigger;
        title.textContent = entries[0].title;
        sheet.showModal();
        close.focus({ preventScroll: true });
        if (entries.length === 1) show(entries[0]);
        else {
          content.replaceChildren(element('p', 'chat-exercise-prompt', 'Выберите вариант упражнения.'));
          for (const entry of entries) content.append(button(entry.category, () => {
            show(entry);
            close.focus({ preventScroll: true });
          }));
          sheet.scrollTop = 0;
        }
      };
    }

    function photoGallery(v, thread, endpoint) {
      const dialog = element('dialog', 'chat-photo-viewer');
      dialog.setAttribute('aria-label', 'Просмотр фото');
      const close = button('Закрыть', () => dialog.close());
      const full = element('img');
      full.alt = 'Фото из чата';
      dialog.append(close, full);
      dialog.addEventListener('close', () => {
        if (!dialog.open) full.removeAttribute('src');
      });
      v.panel.append(dialog);

      let closed = false;
      let requested;
      const urls = new Set();
      const loaders = new WeakMap();
      const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) loaders.get(entry.target)?.();
        }
      }, { root: thread, rootMargin: '100px 0px' }) : null;

      function tile(item) {
        const open = () => {
          full.src = thumbnail.src;
          if (!dialog.open) dialog.showModal();
          requested = null;
        };
        const trigger = button('', () => {
          requested = trigger;
          if (loaded) open();
          else load();
        }, 'chat-photo-tile');
        trigger.setAttribute('aria-haspopup', 'dialog');
        const ratio = item.photo.width / item.photo.height;
        trigger.style.width = Math.round(Math.max(118, Math.min(320, 320 * ratio))) + 'px';
        trigger.style.aspectRatio = String(Math.min(3, Math.max(0.45, ratio)));
        const thumbnail = element('img');
        thumbnail.alt = 'Открыть фото';
        thumbnail.hidden = true;
        const placeholder = element('span', '', 'Загружаем фото…');
        trigger.append(placeholder, thumbnail);
        let loading = false;
        let loaded = false;

        async function load() {
          if (closed || loading || loaded) return;
          loading = true;
          observer?.unobserve(trigger);
          placeholder.textContent = 'Загружаем фото…';
          trigger.setAttribute('aria-busy', 'true');
          let url;
          try {
            const blob = await v.request(endpoint + '/photos/' + item.id, undefined, true);
            if (closed) return;
            url = URL.createObjectURL(blob);
            urls.add(url);
            thumbnail.src = url;
            await thumbnail.decode();
            if (closed) return;
            thumbnail.hidden = false;
            placeholder.hidden = true;
            loaded = true;
            if (requested === trigger) open();
          } catch {
            if (url) {
              URL.revokeObjectURL(url);
              urls.delete(url);
            }
            if (!closed) {
              loaded = false;
              thumbnail.hidden = true;
              placeholder.hidden = false;
              placeholder.textContent = 'Повторить загрузку фото';
              if (requested === trigger) requested = null;
            }
          } finally {
            loading = false;
            trigger.removeAttribute('aria-busy');
          }
        }

        loaders.set(trigger, load);
        if (observer) observer.observe(trigger);
        else load();
        return trigger;
      }

      function clear() {
        closed = true;
        requested = null;
        observer?.disconnect();
        if (dialog.open) dialog.close();
        for (const url of urls) URL.revokeObjectURL(url);
        urls.clear();
      }
      return { tile, clear };
    }

    function paintReceipt(node, read) {
      const label = read ? 'Прочитано' : 'Доставлено';
      node.dataset.read = String(read);
      node.setAttribute('aria-label', label);
      node.title = label;
      node.replaceChildren(icon(read ? 'read' : 'delivered'));
    }

    function message(item, openExercise, photos, room, receipt) {
      const node = element('article', 'chat-message' + (item.own ? ' chat-message-own' : ''));
      const meta = element('div', 'chat-message-meta');
      if (item.person && !item.own) {
        const sender = button('', () => showPerson(item.person), 'chat-message-person');
        sender.setAttribute('aria-label', 'Профиль · ' + item.name);
        sender.append(face({ kind: 'direct', title: item.name, person: item.person }), element('strong', '', item.name));
        meta.append(sender);
      } else meta.append(element('strong', '', item.own ? 'Вы' : item.name));
      if (item.coach) meta.append(element('span', 'chat-coach-label', 'Тренер'));
      const stamp = element('time', '', time.format(item.sent));
      stamp.dateTime = new Date(item.sent).toISOString();
      stamp.title = dateTime.format(item.sent);
      meta.append(stamp);
      if (receipt) meta.append(receipt);
      node.append(meta);
      if (item.photo) node.append(photos.tile(item));
      const material = item.text && launch.materials?.resolve(item.text);
      if (material) {
        const card = button('', () => launch.materials.open(material, room.id), 'chat-material');
        card.append(element('strong', '', material.title));
        if (material.detail) card.append(element('small', '', material.detail));
        card.append(element('span', 'chat-material-open', 'Открыть'));
        node.append(card);
      } else if (item.text) {
        const copy = element('p');
        let from = 0;
        for (const match of openExercise ? exerciseLibrary.match(item.text) : []) {
          copy.append(item.text.slice(from, match.start));
          const link = button(item.text.slice(match.start, match.end), () => openExercise(link, match.entries), 'workout-ex');
          link.setAttribute('aria-haspopup', 'dialog');
          copy.append(link);
          from = match.end;
        }
        copy.append(item.text.slice(from));
        node.append(copy);
      }
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

    async function conversation(room, returnTo = list, backLabel) {
      const v = view(room.title, { back: returnTo, backLabel, room });
      const openExercise = exerciseSheet(v.panel);
      const thread = element('div', 'chat-thread');
      const endpoint = '/rooms/' + room.id;
      const photos = photoGallery(v, thread, endpoint);
      thread.setAttribute('aria-label', 'Переписка');
      thread.setAttribute('role', 'region');
      thread.tabIndex = 0;
      const history = element('div', 'chat-history chat-width');
      const items = element('div', 'chat-messages');
      const empty = element('p', 'chat-empty', 'Здесь появятся сообщения.');
      empty.hidden = true;

      const dock = element('div', 'chat-dock');
      const composer = element('div', 'chat-width chat-composer');
      let accessLost = false;
      const delivery = element('p', 'chat-status chat-delivery');
      delivery.setAttribute('role', 'status');
      const setDelivery = text => { if (!v.signal.aborted) delivery.textContent = text; };
      const form = element('form', 'chat-compose');
      form.addEventListener('input', () => setDelivery(''));
      const input = element('textarea');
      input.rows = 1;
      input.placeholder = 'Сообщение';
      input.setAttribute('aria-label', 'Сообщение');
      const picker = element('input');
      picker.type = 'file';
      picker.accept = [...photoTypes, '.heic', '.heif'].join(',');
      picker.hidden = true;
      const attach = iconButton('attach', 'Прикрепить фото', () => picker.click());
      const preview = element('div', 'chat-photo-draft');
      const previewImage = element('img');
      previewImage.alt = 'Фото к сообщению';
      let draftPhoto = null;
      let preparingPhoto = false;
      function showDraft(photo) {
        draftPhoto = photo;
        preview.hidden = !photo;
        input.placeholder = photo ? 'Подпись к фото' : 'Сообщение';
        if (photo) previewImage.src = photo.jpeg;
        else previewImage.removeAttribute('src');
      }
      preview.append(previewImage, element('span', '', 'Фото к сообщению'),
        iconButton('close', 'Убрать фото', () => {
          showDraft(null);
          setDelivery('');
        }));
      preview.hidden = true;
      picker.addEventListener('change', async () => {
        const file = picker.files?.[0];
        picker.value = '';
        if (!file || preparingPhoto || accessLost) return;
        preparingPhoto = true;
        attach.disabled = true;
        setDelivery('Готовим фото…');
        try {
          const photo = await preparePhoto(file);
          if (!v.signal.aborted && !accessLost) {
            showDraft({ jpeg: photo });
            setDelivery('');
          }
        } catch (error) {
          setDelivery(errors[error.message] || errors.attachment_read_failed);
        } finally {
          preparingPhoto = false;
          attach.disabled = accessLost;
        }
      });
      form.append(picker, preview, attach);
      form.append(input);
      let first;
      let last;
      let pending;
      let reading = false;
      let timer;
      let refreshAfterSend = false;
      let sentThrough = 0;
      const appended = new Set();
      const unreadReceipts = new Map();
      let readThrough = 0;
      let lastIncoming = 0;
      let follow = true;
      let seen = 0;
      let reporting = false;
      const active = () => !document.hidden && telegram?.isActive !== false;
      const scrollToEnd = () => { thread.scrollTop = thread.scrollHeight; };
      async function reportSeen() {
        if (!active() || !follow || lastIncoming <= seen || reporting || v.signal.aborted || accessLost) return;
        const through = lastIncoming;
        reporting = true;
        try {
          await v.request(endpoint + '/read', { through });
          seen = through;
        } catch {
          // The next refresh can retry without interrupting the conversation.
        } finally {
          reporting = false;
        }
      }
      thread.addEventListener('scroll', () => {
        follow = thread.scrollHeight - thread.clientHeight - thread.scrollTop < 80;
        reportSeen();
      }, { passive: true });

      function append(page, prepend = false) {
        if (Number.isSafeInteger(page.readThrough) && page.readThrough > readThrough) {
          readThrough = page.readThrough;
          for (const [id, receipt] of unreadReceipts) {
            if (id > readThrough) continue;
            paintReceipt(receipt, true);
            unreadReceipts.delete(id);
          }
        }
        const list = page.messages;
        if (!list.length) return;
        empty.hidden = true;
        const chunk = document.createDocumentFragment();
        for (const item of list) {
          if (appended.has(item.id)) continue;
          appended.add(item.id);
          first = Math.min(first ?? item.id, item.id);
          last = Math.max(last ?? item.id, item.id);
          if (typeof item.person?.avatar === 'number') {
            item.person.avatar = page.photos?.[item.person.avatar] || '';
          }
          let receipt;
          if (item.own) {
            receipt = element('span', 'chat-message-receipt');
            receipt.setAttribute('role', 'img');
            const read = item.id <= readThrough;
            paintReceipt(receipt, read);
            if (!read) unreadReceipts.set(item.id, receipt);
          } else {
            lastIncoming = Math.max(lastIncoming, item.id);
          }
          chunk.append(message(item, openExercise, photos, room, receipt));
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
          append(page, true);
          earlier.hidden = !page.more;
          thread.scrollTop += thread.scrollHeight - previousHeight;
        } catch (error) { accessError(error); }
        finally { earlier.disabled = false; }
      });
      earlier.hidden = true;

      function accessError(error) {
        if (!v.signal.aborted && web && ['web_auth_required', 'web_access_ended', 'room_forbidden'].includes(error.message)) {
          launch.webSessionLost();
          return;
        }
        v.errorText(error);
        if (v.signal.aborted || !['room_forbidden', 'profile_required', 'telegram_auth_required'].includes(error.message)) return;
        accessLost = true;
        clearInterval(timer);
        photos.clear();
        showDraft(null);
        pending = null;
        attach.disabled = true;
        items.replaceChildren();
        unreadReceipts.clear();
        empty.hidden = true;
        earlier.hidden = true;
        setDelivery('');
        form.hidden = !input.value;
        sendButton.hidden = true;
      }

      async function refresh(forceScroll = false) {
        if (reading || accessLost || v.signal.aborted) return;
        reading = true;
        try {
          let more = true;
          while (more) {
            const previous = last;
            const page = await v.request(endpoint + (previous === undefined ? '' : '?after=' + previous));
            if (v.signal.aborted || accessLost) return;
            if (previous === undefined) earlier.hidden = !page.more;
            append(page);
            more = page.more && previous !== undefined && last > previous && last < sentThrough;
          }
          empty.hidden = last !== undefined;
          form.hidden = false;
          v.statusText('');
          if (forceScroll || follow) scrollToEnd();
          reportSeen();
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

      const sendButton = v.formSubmit(form, 'Отправить', async () => {
        if (accessLost || preparingPhoto) return;
        const text = input.value;
        const photo = draftPhoto;
        if (!text.trim() && !photo) {
          setDelivery(errors.invalid_message);
          return;
        }
        if (!pending || pending.text !== text || pending.photo !== photo?.jpeg) {
          pending = { text, photo: photo?.jpeg, clientId: messageId() };
        }
        setDelivery(photo ? 'Отправляем фото…' : 'Отправляем…');
        try {
          sentThrough = await deliver(endpoint, pending, v.signal, web);
        } catch (error) {
          if (['room_forbidden', 'profile_required', 'telegram_auth_required', 'web_auth_required', 'web_access_ended'].includes(error.message)) {
            accessError(error);
          } else {
            setDelivery(errors[error.message] || 'Не получили подтверждение. Нажмите «Отправить» ещё раз.');
          }
          return;
        }
        if (v.signal.aborted) return;
        setDelivery('Отправлено.');
        if (draftPhoto === photo) {
          showDraft(null);
          if (input.value === text) input.value = '';
        }
        pending = null;
        if (reading) refreshAfterSend = true;
        else await refresh(true);
      }, 'send');
      form.hidden = true;
      history.append(earlier, empty, items);
      thread.append(history);
      composer.append(v.status, delivery, form);
      dock.append(composer);
      v.panel.append(thread, dock);
      v.statusText('Загружаем переписку…');
      const heightChanges = new ResizeObserver(() => { if (follow) scrollToEnd(); });
      heightChanges.observe(thread);
      timer = setInterval(() => { if (active()) refresh(); }, 5000);
      document.addEventListener('visibilitychange', reportSeen);
      cleanup = () => {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', reportSeen);
        heightChanges.disconnect();
        photos.clear();
      };
      await refresh(true);
    }

    async function manage(backTo = list, section = '') {
      const title = section === 'groups' ? 'Группы' : section === 'assignments' ? 'Назначения' : 'Управление чатами';
      const v = view(title, { back: backTo, backLabel: section ? 'В кабинет тренера' : 'К списку чатов' });
      const reload = () => manage(backTo, section);
      const sheet = element('div', 'chat-width chat-cabinet');
      v.panel.append(sheet);
      sheet.append(v.status);
      v.statusText('Загружаем настройки…');
      try {
        const data = await v.request('/manage');
        if (v.signal.aborted) return;
        v.statusText('');
        if (section !== 'groups') renderAssignments(data);
        if (section !== 'assignments') renderGroups();
      } catch (error) {
        v.errorText(error);
        if (!v.signal.aborted) sheet.append(button('Обновить', reload));
      }

      function renderAssignments(data) {
        const assigning = element('form', 'chat-form chat-account-card');
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
          if (!v.signal.aborted) await reload();
        });
        sheet.append(assigning);
        if (data.assignments.length) {
          const active = element('section', 'chat-account-card');
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
                if (!v.signal.aborted) await reload();
              } catch (error) { v.errorText(error); }
              finally { finish.disabled = false; }
            });
            row.append(details, finish);
            active.append(row);
          }
          sheet.append(active);
        }

      }

      function renderGroups() {
        const group = element('form', 'chat-form chat-account-card');
        group.append(element('h3', '', 'Создать группу к старту'));
        const name = field(group, 'Название старта или группы', textInput('Например, «Первый старт на 1 км»', 60));
        name.minLength = 2;
        const level = field(group, 'Для кого', choices('', true));
        v.formSubmit(group, 'Создать группу', async () => {
          await v.request('/manage', { action: 'createGroup', title: name.value, level: level.value });
          if (!v.signal.aborted) {
            if (section) await list(undefined, backTo, 'group');
            else await list();
          }
        });
        sheet.append(group);
        if (section) sheet.append(button('Открыть групповые чаты', () => list(undefined, backTo, 'group'), 'chat-button chat-coach-find'));
      }
    }

    if (launch.account) account();
    else list();
  }

  return { mount, forward };
})();
