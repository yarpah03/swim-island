(() => {
  const isTrainer = location.pathname.startsWith('/partner/');
  const role = isTrainer ? 'partner' : 'client';
  const prefix = '/v1/' + role + '/';
  const entry = '/' + role + '/';
  const roleLabel = isTrainer ? 'тренера' : 'ученика';
  const loginTitle = 'Кабинет ' + roleLabel;
  const registrationTitle = 'Регистрация ' + roleLabel;
  const portal = document.querySelector('.client-login');
  const chat = document.getElementById('swim-chats');
  const library = document.getElementById('client-library');
  const frame = document.getElementById('client-catalog');
  const libraryNotice = document.getElementById('client-library-notice');
  const libraryStatus = document.getElementById('client-library-status');
  const libraryRetry = document.getElementById('client-library-retry');
  const account = document.getElementById('client-account');
  const accountStatus = document.getElementById('client-account-status');
  const installFromAccount = document.getElementById('client-install-menu');
  const guide = document.getElementById('client-guide');
  const guideKey = 'swim-vip-web-guide';
  let guideShown = false;
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
  const loginLink = document.getElementById('client-login-link');
  const retry = document.getElementById('client-invite-retry');
  loginLink.href = entry;
  retry.addEventListener('click', () => start());
  const catalog = new URL('https://yarpah03.github.io/swim-island/');
  const views = [portal, library, chat, partner];
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

  function invitationFromUrl() {
    const registration = /^\/(?:client|partner)\/register(?:\/(?:index\.html)?)?$/.test(location.pathname);
    const fragment = new URLSearchParams(location.hash.slice(1));
    if (registration) return { secret: new URLSearchParams(location.search).get('invite') ?? '' };
    return fragment.has('invite') ? { secret: fragment.get('invite') } : null;
  }

  let invite = '';
  let mode;
  let generation = 0;
  let libraryTimer;
  let returnToChat;

  function display(active) {
    SwimChats.mount(null);
    chat.replaceChildren();
    partner.replaceChildren();
    account.close();
    guide.close();
    if (active !== library) {
      clearTimeout(libraryTimer);
      frame.removeAttribute('src');
      returnToChat = undefined;
    }
    for (const view of views) view.hidden = view !== active;
    document.body.dataset.page = active === chat ? 'chats' : active === library ? 'client-library' : '';
  }

  function setTitle(text) {
    title.textContent = text;
    document.title = text + ' · Плавательный остров VIP';
  }

  function showLogin(message = '') {
    display(portal);
    mode = undefined;
    setTitle(loginTitle);
    help.textContent = 'Войдите со своим логином и паролем.';
    codeForm.hidden = loginLink.hidden = retry.hidden = true;
    showPasswordForm(false);
    status.textContent = message;
  }

  function showPasswordForm(register) {
    code.value = password.value = '';
    nameField.hidden = !register;
    name.required = register;
    password.autocomplete = register ? 'new-password' : 'current-password';
    password.minLength = register ? 12 : 0;
    loginButton.textContent = register ? 'Создать аккаунт' : 'Войти';
    passwordForm.hidden = false;
  }

  function showInvitation(state) {
    mode = state.invite;
    status.textContent = '';
    loginLink.hidden = false;
    retry.hidden = mode !== 'unavailable';
    passwordForm.hidden = codeForm.hidden = true;
    if (mode === 'register') {
      help.textContent = 'Укажите имя и придумайте логин и пароль от 12 символов.';
      loginLink.textContent = 'Уже есть аккаунт? Войти';
      showPasswordForm(true);
      return;
    }
    if (mode === 'legacy') {
      setTitle('Вход по коду');
      help.textContent = state.mail ? 'Получите одноразовый код на почту.' : 'Введите код из письма тренера.';
      code.value = '';
      codeForm.hidden = false;
      requestCode.hidden = !state.mail;
    } else {
      const sender = isTrainer ? 'у администратора' : 'у тренера';
      const messages = {
        incomplete: 'В адресе нет кода приглашения. Откройте исходную ссылку целиком или попросите новую ' + sender + '.',
        invalid: 'Приглашение недействительно. Попросите новую ссылку ' + sender + '.',
        expired: 'Срок действия приглашения закончился. Попросите новую ссылку ' + sender + '.',
        used: 'Приглашение уже использовано. Войдите с логином и паролем, которые вы создали.',
        unavailable: 'Не удалось проверить приглашение. Попробуйте ещё раз.',
      };
      help.textContent = messages[mode] || messages.invalid;
    }
    loginLink.textContent = 'Перейти ко входу';
  }

  function openSession() {
    if (location.pathname !== entry || location.search || location.hash) history.replaceState(null, '', entry);
    invite = '';
    mode = undefined;
    openCabinet();
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
    password.value = code.value = '';
    document.title = 'Плавательный остров VIP';
    showLibrary('home');
  }

  function showLibrary(hash, back) {
    display(library);
    returnToChat = back;
    const url = new URL(catalog);
    url.searchParams.set('view', 'portal');
    if (back) url.searchParams.set('from', 'chat');
    url.hash = hash;
    frame.inert = true;
    libraryRetry.hidden = true;
    libraryRetry.onclick = () => showLibrary(hash, back);
    clearTimeout(libraryTimer);
    libraryTimer = setTimeout(() => {
      libraryStatus.textContent = 'Приложение пока не загрузилось.';
      libraryNotice.hidden = libraryRetry.hidden = false;
    }, 15000);
    libraryStatus.textContent = 'Загружаем приложение…';
    libraryNotice.hidden = false;
    frame.src = url.href;
  }

  function showGuide() {
    guideShown = true;
    try { localStorage.setItem(guideKey, '1'); } catch { /* Keep the choice for this page. */ }
    if (!guide.open) guide.showModal();
  }

  function showFirstGuide() {
    if (guideShown) return;
    try { if (localStorage.getItem(guideKey)) return; } catch { /* Storage can be disabled. */ }
    showGuide();
  }

  function showAccount() {
    accountStatus.textContent = '';
    installFromAccount.hidden = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (!account.open) account.showModal();
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
      webSessionLost: () => showLogin('Войдите снова, чтобы открыть переписку.'),
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
    }, () => showLogin('Войдите снова, чтобы открыть кабинет.'));
  }

  async function start(message) {
    const current = ++generation;
    const invitation = invitationFromUrl();
    invite = invitation?.secret || '';
    display(portal);
    mode = undefined;
    passwordForm.hidden = codeForm.hidden = loginLink.hidden = retry.hidden = true;
    status.textContent = '';
    setTitle(invitation ? registrationTitle : loginTitle);
    if (invitation && !/^[a-f0-9]{64}$/.test(invite)) {
      showInvitation({ invite: invite ? 'invalid' : 'incomplete' });
      return;
    }
    help.textContent = invitation ? 'Проверяем приглашение…' : 'Проверяем вход…';
    try {
      const state = await api('session', invitation ? { invite } : undefined);
      if (current !== generation) return;
      if (state.active) openSession();
      else if (invitation) showInvitation(state);
      else showLogin(message);
    } catch (error) {
      if (current !== generation) return;
      if (invitation) showInvitation({ invite: 'unavailable' });
      else showLogin(errorText(error));
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
      openSession();
    } catch (error) {
      if (current !== generation) return;
      const inviteError = { web_invite_invalid: 'invalid', web_invite_used: 'used', web_access_ended: 'expired' };
      if (register && inviteError[error.message]) showInvitation({ invite: inviteError[error.message] });
      else status.textContent = errorText(error);
    } finally {
      loginButton.disabled = false;
    }
  });

  requestCode.addEventListener('click', async () => {
    const current = generation;
    requestCode.disabled = true;
    status.textContent = 'Отправляем код…';
    try {
      await api('code', { invite });
      if (current !== generation) return;
      status.textContent = 'Код отправлен. Он действует 15 минут.';
      code.focus();
    } catch (error) {
      if (current === generation) status.textContent = errorText(error);
    } finally {
      requestCode.disabled = false;
    }
  });

  codeForm.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = codeForm.querySelector('[type=submit]');
    if (submit.disabled) return;
    const current = generation;
    submit.disabled = true;
    status.textContent = 'Проверяем код…';
    try {
      await api('login', { invite, code: code.value });
      if (current === generation) openSession();
    } catch (error) {
      if (current === generation) status.textContent = errorText(error);
    } finally {
      submit.disabled = false;
    }
  });
  document.getElementById('client-account-close').addEventListener('click', () => account.close());
  guide.querySelector('button').addEventListener('click', () => guide.close());
  document.getElementById('client-guide-menu').addEventListener('click', () => {
    account.close();
    showGuide();
  });
  installFromAccount.addEventListener('click', () => {
    account.close();
    offerInstall();
  });
  const leaveAccount = document.getElementById('client-logout');
  leaveAccount.addEventListener('click', async () => {
    leaveAccount.disabled = true;
    try {
      const message = await logout();
      if (message) accountStatus.textContent = message;
    } finally { leaveAccount.disabled = false; }
  });
  window.addEventListener('message', event => {
    if (library.hidden || event.origin !== catalog.origin || event.source !== frame.contentWindow) return;
    const message = event.data;
    if (message?.type === 'swim-portal-ready') {
      clearTimeout(libraryTimer);
      libraryNotice.hidden = true;
      frame.inert = false;
      if (!returnToChat) showFirstGuide();
      return;
    }
    if (message?.type === 'swim-portal-route') {
      const { route } = message;
      if (route === 'profile') showAccount();
      else if (route === 'chats') {
        if (message.returnToThread === true && returnToChat) returnToChat();
        else showChat();
      } else if (typeof route === 'string' && SwimPartners.routeParts(route)) browserCatalog(route);
      return;
    }
    if (message?.type !== 'swim-forward') return;
    const { title, url, detail } = message.material || {};
    if (typeof title !== 'string' || title.length > 140 || typeof url !== 'string' || url.length > 4096) return;
    const entry = materialFromText(title + '\n' + url);
    if (!entry || entry.isPartner) return;
    if (typeof detail === 'string') entry.detail = detail.slice(0, 140);
    forwardToCoach(entry, frame);
  });
  async function checkSession() {
    if (isTrainer || !portal.hidden || document.hidden || !chat.hidden) return;
    const current = generation;
    try {
      const state = await api('session');
      if (current === generation && !state.active) showLogin('Войдите снова, чтобы открыть кабинет.');
    } catch {
      // Chat and account requests still check access on the server.
    }
  }
  window.setInterval(checkSession, 60000);
  document.addEventListener('visibilitychange', checkSession);
  window.addEventListener('hashchange', () => start());
  start();
})();
