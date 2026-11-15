(() => {
  const isTrainer = location.pathname.startsWith('/partner/');
  const prefix = '/v1/' + (isTrainer ? 'partner' : 'client') + '/';
  const portal = document.querySelector('.client-login');
  const chat = document.getElementById('swim-chats');
  const menu = document.getElementById('client-menu');
  const menuStatus = document.getElementById('client-menu-status');
  const library = document.getElementById('client-library');
  const libraryBack = document.getElementById('client-library-back');
  const frame = document.getElementById('client-catalog');
  const partner = document.getElementById('partner-browser');
  const title = document.getElementById('client-title');
  const help = document.getElementById('client-help');
  const passwordForm = document.getElementById('client-password-form');
  const nameField = document.getElementById('client-name-field');
  const name = document.getElementById('client-name');
  const login = document.getElementById('client-login');
  const password = document.getElementById('client-password');
  const loginButton = document.getElementById('client-login-button');
  const codeForm = document.getElementById('client-access');
  const code = document.getElementById('client-code');
  const status = document.getElementById('client-status');
  const requestCode = document.getElementById('client-request');
  const install = document.getElementById('client-install');
  const catalog = new URL('https://yarpah03.github.io/swim-island/');
  const views = [portal, menu, library, chat, partner];
  const errors = {
    web_invite_invalid: 'Ссылка устарела. Попросите актуальное приглашение.',
    web_invite_used: 'Приглашение уже использовано. Войдите со своим логином и паролем.',
    web_access_ended: 'Срок доступа закончился. Свяжитесь с тренером.',
    web_login_format: 'Логин должен содержать от 3 до 32 латинских букв, цифр или знаков . _ -',
    web_password_format: 'Введите пароль от 12 символов.',
    web_login_invalid: 'Проверьте логин, пароль и срок доступа.',
    web_login_taken: 'Этот логин занят. Выберите другой.',
    web_login_wait: 'Слишком много попыток входа. Попробуйте через 10 минут.',
    web_code_invalid: 'Проверьте код из последнего письма или запросите новый.',
    web_code_wait: 'Подождите перед повторным запросом кода.',
    web_mail_unavailable: 'Отправку письма не удалось подтвердить. Проверьте почту или обратитесь к тренеру.',
    invalid_name: 'Введите имя от 2 до 40 символов.',
  };
  const errorText = error => errors[error.message] || 'Не удалось связаться с кабинетом. Попробуйте ещё раз.';

  if (isTrainer) {
    title.textContent = 'Кабинет тренера';
    document.title = 'Кабинет тренера · Плавательный остров VIP';
  }

  async function api(path, payload) {
    const options = { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(18000) };
    if (payload) {
      options.method = 'POST';
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(payload);
    }
    const response = await fetch(prefix + path, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'unavailable');
    return data;
  }

  async function passwordProof(user, pass) {
    const text = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', text.encode(pass), 'PBKDF2', false, ['deriveBits']);
    const value = await crypto.subtle.deriveBits({
      name: 'PBKDF2', hash: 'SHA-256', iterations: 600000,
      salt: text.encode('swim-island.pages.dev:v1:' + user),
    }, key, 256);
    return Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  let installPrompt;
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
  });
  install.querySelector('button').addEventListener('click', () => install.close());
  async function offerInstall() {
    const prompt = installPrompt;
    installPrompt = null;
    if (prompt) {
      try {
        await prompt.prompt();
        return;
      } catch {
        // The manual installation steps are still available.
      }
    }
    install.showModal();
  }

  const inviteFromUrl = () => new URLSearchParams(location.hash.slice(1)).get('invite') || '';
  let invite = '';
  let mode;
  let generation = 0;

  function display(active) {
    SwimChats.mount(null);
    chat.replaceChildren();
    partner.replaceChildren();
    if (active !== library) frame.removeAttribute('src');
    for (const view of views) view.hidden = view !== active;
    document.body.dataset.page = active === chat ? 'chats' : active === library ? 'client-library' : '';
  }

  function showLogin(state = {}, message = '') {
    display(portal);
    mode = state.invite;
    const register = mode === 'register';
    const legacy = mode === 'legacy';
    code.value = password.value = '';
    passwordForm.hidden = legacy;
    nameField.hidden = !register;
    name.required = register;
    password.autocomplete = register ? 'new-password' : 'current-password';
    password.minLength = register ? 12 : 0;
    loginButton.textContent = register ? 'Создать аккаунт' : 'Войти';
    codeForm.hidden = !legacy;
    requestCode.hidden = !state.mail;
    help.textContent = register ? 'Придумайте логин и пароль от 12 символов.'
      : legacy ? (state.mail ? 'Получите одноразовый код на почту.' : 'Введите код из письма тренера.')
      : 'Войдите со своим логином и паролем.';
    status.textContent = message || ({ invalid: errors.web_invite_invalid, used: errors.web_invite_used,
      expired: errors.web_access_ended })[mode] || '';
  }

  async function logout() {
    try {
      await api('logout', {});
      await start('Вы вышли из кабинета.');
    } catch (error) {
      return errorText(error);
    }
  }

  function showMenu() {
    display(menu);
    password.value = code.value = '';
    menuStatus.textContent = '';
    menu.querySelector('details').open = false;
    document.getElementById('client-install-menu').hidden =
      matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  }

  function showLibrary(hash, back = showMenu) {
    display(library);
    const url = new URL(catalog);
    url.searchParams.set('view', 'client');
    url.hash = hash;
    frame.src = url.href;
    libraryBack.textContent = back === showMenu ? 'Главное меню' : 'К чату';
    libraryBack.onclick = () => back();
  }

  function forwardToCoach(entry, opener) {
    SwimChats.forward(entry, opener, showChat, materialFromText, true);
  }

  function browserCatalog(hash, returnTo = showMenu) {
    display(partner);
    const header = document.createElement('header');
    header.className = 'partner-desk-head';
    const heading = document.createElement('h1');
    heading.textContent = 'Партнёры';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'chat-button';
    back.textContent = returnTo === showMenu ? 'Главное меню' : 'К чату';
    back.addEventListener('click', () => returnTo());
    header.append(heading, back);
    const root = document.createElement('div');
    root.className = 'partner-list';
    partner.append(header, root);
    const navigate = next => SwimPartners.catalog(root, next, {
      navigate, request: path => api('partners' + path), share: forwardToCoach,
    });
    navigate(hash);
  }

  function materialFromText(text) {
    const lines = text.split('\n');
    const prefix = catalog.href + '#';
    if (lines.length !== 2 || !lines[1].startsWith(prefix)) return null;
    const hash = lines[1].slice(prefix.length);
    const isPartner = Boolean(SwimPartners.routeParts(hash));
    if (!isPartner && !/^[a-z][a-z0-9_]*(?:\/(?:workout|lesson|exercise|station)-[1-9]\d*(?:-[1-9]\d*)?)?$/.test(hash)) return null;
    return { title: lines[0], url: prefix + hash, hash, isPartner };
  }

  function showChat(targetRoom) {
    display(chat);
    SwimChats.mount(chat, undefined, '', undefined, {
      web: true,
      webHome: showMenu,
      targetRoom,
      materials: {
        resolve: materialFromText,
        open: (entry, roomId) => {
          const back = () => showChat(roomId);
          if (entry.isPartner) browserCatalog(entry.hash, back);
          else showLibrary(entry.hash, back);
        },
      },
      webSessionLost: () => showLogin({ invite: mode }, 'Войдите снова, чтобы открыть переписку.'),
    });
  }

  function openCabinet() {
    if (!isTrainer) return showMenu();
    display(partner);
    password.value = '';
    SwimPartners.desk(partner, api, async () => {
      const message = await logout();
      if (message) {
        const feedback = partner.querySelector('.chat-status');
        if (feedback) feedback.textContent = message;
      }
    }, () => showLogin({}, 'Войдите снова, чтобы открыть кабинет.'));
  }

  async function start(message) {
    const current = ++generation;
    invite = inviteFromUrl();
    display(portal);
    passwordForm.hidden = codeForm.hidden = true;
    help.textContent = 'Проверяем вход…';
    try {
      const state = await api('session', invite ? { invite } : undefined);
      if (current !== generation) return;
      if (state.active) openCabinet();
      else showLogin(state, message);
    } catch (error) {
      if (current === generation) showLogin({}, errorText(error));
    }
  }

  passwordForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (loginButton.disabled) return;
    const current = generation;
    const user = login.value.trim().toLowerCase();
    const register = mode === 'register';
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(user)) { status.textContent = errors.web_login_format; return; }
    if (password.value.length < 12) { status.textContent = errors.web_password_format; return; }
    if (register && name.value.trim().length < 2) { status.textContent = errors.invalid_name; return; }
    loginButton.disabled = true;
    status.textContent = register ? 'Создаём аккаунт…' : 'Входим…';
    try {
      const proof = await passwordProof(user, password.value);
      if (current !== generation) return;
      const data = register ? { invite, name: name.value, login: user, proof } : { login: user, proof };
      await api(register ? 'register' : 'password', data);
      if (current !== generation) return;
      history.replaceState(null, '', location.pathname);
      invite = '';
      mode = undefined;
      openCabinet();
    } catch (error) {
      if (current === generation) status.textContent = errorText(error);
    } finally {
      loginButton.disabled = false;
    }
  });

  requestCode.addEventListener('click', async () => {
    requestCode.disabled = true;
    status.textContent = 'Отправляем код…';
    try {
      await api('code', { invite });
      status.textContent = 'Код отправлен. Он действует 15 минут.';
      code.focus();
    } catch (error) {
      status.textContent = errorText(error);
    } finally {
      requestCode.disabled = false;
    }
  });

  codeForm.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = codeForm.querySelector('[type=submit]');
    if (submit.disabled) return;
    submit.disabled = true;
    status.textContent = 'Проверяем код…';
    try {
      await api('login', { invite, code: code.value });
      openCabinet();
    } catch (error) {
      status.textContent = errorText(error);
    } finally {
      submit.disabled = false;
    }
  });
  document.getElementById('client-chats').addEventListener('click', () => showChat());
  document.getElementById('client-library-chats').addEventListener('click', () => showChat());
  document.getElementById('client-install-menu').addEventListener('click', offerInstall);
  const leaveMenu = document.getElementById('client-logout');
  leaveMenu.addEventListener('click', async () => {
    leaveMenu.disabled = true;
    try {
      const message = await logout();
      if (message) menuStatus.textContent = message;
    } finally { leaveMenu.disabled = false; }
  });
  for (const button of menu.querySelectorAll('[data-section]')) button.addEventListener('click', () => {
    const section = button.dataset.section;
    if (section === 'partners') browserCatalog(section);
    else showLibrary(section);
  });
  window.addEventListener('message', event => {
    if (library.hidden || event.origin !== catalog.origin || event.source !== frame.contentWindow ||
        event.data?.type !== 'swim-forward') return;
    const { title, url, detail } = event.data.material || {};
    if (typeof title !== 'string' || title.length > 140 || typeof url !== 'string' || url.length > 4096) return;
    const entry = materialFromText(title + '\n' + url);
    if (!entry || entry.isPartner) return;
    if (typeof detail === 'string') entry.detail = detail.slice(0, 140);
    forwardToCoach(entry, libraryBack);
  });
  async function checkSession() {
    if (isTrainer || !portal.hidden || document.hidden || !chat.hidden) return;
    const current = generation;
    try {
      const state = await api('session');
      if (current === generation && !state.active) showLogin({ invite: mode }, 'Войдите снова, чтобы открыть кабинет.');
    } catch {
      // Chat and account requests still check access on the server.
    }
  }
  window.setInterval(checkSession, 60000);
  document.addEventListener('visibilitychange', checkSession);
  window.addEventListener('hashchange', () => start());
  start();
})();
