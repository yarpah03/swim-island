(() => {
  const portal = document.querySelector('.client-login');
  const chat = document.getElementById('swim-chats');
  const help = document.getElementById('client-help');
  const form = document.getElementById('client-access');
  const code = document.getElementById('client-code');
  const status = document.getElementById('client-status');
  const requestCode = document.getElementById('client-request');
  const submit = form.querySelector('[type=submit]');
  const catalog = 'https://yarpah03.github.io/swim-island/#';
  const errors = {
    web_invite_invalid: 'Ссылка устарела. Попросите тренера прислать актуальное приглашение.',
    web_access_ended: 'Срок ведения закончился. Свяжитесь с тренером для продления доступа.',
    web_code_invalid: 'Проверьте код из последнего письма. Если срок действия истёк, получите новый код.',
    web_code_wait: 'Подождите перед повторным запросом кода.',
    web_mail_unavailable: 'Отправку письма не удалось подтвердить. Проверьте почту или обратитесь к тренеру.',
  };
  const errorText = error => errors[error.message] || 'Не удалось связаться с кабинетом. Попробуйте ещё раз.';

  async function api(path, payload) {
    const options = { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(18000) };
    if (payload) {
      options.method = 'POST';
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(payload);
    }
    const response = await fetch('/v1/client/' + path, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'unavailable');
    return data;
  }

  const inviteFromUrl = () => new URLSearchParams(location.hash.slice(1)).get('invite') || '';
  let invite = inviteFromUrl();
  let mail = false;

  function showLogin(message = '') {
    SwimChats.mount(null);
    chat.replaceChildren();
    chat.hidden = true;
    portal.hidden = false;
    delete document.body.dataset.page;
    code.value = '';
    const invited = /^[a-f0-9]{64}$/.test(invite);
    form.hidden = !invited;
    requestCode.hidden = !mail;
    help.textContent = !invited ? 'Откройте персональную ссылку от тренера, чтобы войти.'
      : mail ? 'Получите одноразовый код на почту, указанную тренером.'
      : 'Введите одноразовый код, который тренер отправил на вашу почту.';
    status.textContent = message;
  }

  function materialFromText(text) {
    const lines = text.split('\n');
    if (lines.length !== 2 || !lines[1].startsWith(catalog)) return null;
    const hash = lines[1].slice(catalog.length);
    if (!/^[a-z][a-z0-9_]*(?:\/(?:workout|lesson|exercise|station)-[1-9]\d*(?:-[1-9]\d*)?)?$/.test(hash)) return null;
    return { title: lines[0], url: catalog + hash };
  }

  function showChat() {
    portal.hidden = true;
    chat.hidden = false;
    document.body.dataset.page = 'chats';
    SwimChats.mount(chat, undefined, '', undefined, {
      web: true,
      materials: {
        resolve: materialFromText,
        open: entry => window.open(entry.url, '_blank', 'noopener,noreferrer'),
      },
      webExit: async () => {
        try {
          await api('logout', {});
          showLogin('Вы вышли из кабинета.');
        } catch (error) {
          return errorText(error);
        }
      },
      webSessionLost: () => showLogin('Войдите ещё раз, чтобы открыть переписку.'),
    });
  }

  async function start() {
    invite = inviteFromUrl();
    showLogin();
    try {
      const state = await api('session', invite ? { invite } : undefined);
      mail = state.mail;
      if (state.active) showChat();
      else showLogin();
    } catch (error) {
      showLogin(errorText(error));
    }
  }

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

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    status.textContent = 'Проверяем код…';
    try {
      await api('login', { invite, code: code.value });
      showChat();
    } catch (error) {
      status.textContent = errorText(error);
    } finally {
      submit.disabled = false;
    }
  });
  window.addEventListener('hashchange', start);
  start();
})();
