export const CHECKOUT = 'https://t.me/tribute/app?startapp=sXk3';
export const APP = 'https://t.me/SwimIslandVIPBot?startapp';
export const WEB = 'https://vip.swimisland.ru/client/';
export const CONTACT = 'https://t.me/rese1go';
export const CATEGORIES = { lessons: 'Уроки с нуля', checklists: 'Чек-листы', plans: 'Планы тренировок' };
export const PHOTOS = {
  home: '/media/club.jpg', materials: '/media/learning.jpg', about: '/media/club.jpg',
  tariffs: '/media/pool.jpg', buy: '/media/club.jpg', access: '/media/pool.jpg',
  news: '/media/live.jpg', help: '/media/learning.jpg', lessons: '/media/breaststroke.jpg',
  checklists: '/media/learning.jpg', plans: '/media/breaststroke.jpg', admin: '/media/logo.jpg',
};
export const SEED = [
  { id: 'breaststroke8', category: 'plans', title: 'Брасс с нуля: 8 тренировок',
    description: 'Восемь последовательных тренировок: от отдельных движений к целому циклу брасса. Сохраните PDF и проходите задания по порядку, в комфортном темпе. Это общий учебный план; при необходимости повторяйте тренировку перед переходом к следующей.',
    kind: 'asset', payload: '/free/breaststroke-8.pdf', photo: PHOTOS.plans },
  { id: 'poolcheck', category: 'checklists', title: 'Перед тренировкой в бассейне',
    description: 'Короткий список, который поможет собраться и провести занятие с понятной задачей: что взять, как выбрать нагрузку и что записать после тренировки.',
    kind: 'asset', payload: '/free/pool-checklist.pdf', photo: PHOTOS.checklists },
  { id: 'techcheck', category: 'checklists', title: 'Как работать над техникой',
    description: 'Как выбрать один элемент, распределить внимание на тренировке и заметить прогресс. Компактный чек-лист можно сохранить на телефон или распечатать.',
    kind: 'asset', payload: '/free/technique-checklist.pdf', photo: PHOTOS.checklists },
];
export const button = (text, data) => ({ text, callback_data: data });
export const link = (text, url) => ({ text, url });
export const nav = (parent = 'home') => [
  [button(parent === 'home' ? '← Главное меню' : '← Назад', parent), ...(parent === 'home' ? [] : [button('🏝 Главное меню', 'home')])],
];
export function escape(value = '') { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
export function isAdmin(env, id) { return (env.BOT_ADMIN_IDS || '').split(',').map(Number).includes(id); }
export function https(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && u.href.length <= 1800 ? u.href : ''; } catch { return ''; }
}
export function mainKeyboard(admin = false) {
  return [
    [button('🎁 Полезные материалы', 'materials')],
    [button('💎 Купить подписку', 'buy'), button('💳 Тарифы', 'tariffs')],
    [button('🏝 О клубе', 'about'), button('📲 Войти в приложение', 'access')],
    [button('🔔 Новости', 'news'), button('💬 Помощь', 'help')],
    ...(admin ? [[button('Управление ботом', 'admin')]] : []),
  ];
}
export function publicCard(key, admin = false, subscribed = true) {
  const cards = {
    home: ['<b>Плавательный остров</b>\n\nПривет! Мы Ярослав Пахомов и Макар Марченко.\n\nСобрали здесь полезные материалы по плаванию и всё, что поможет познакомиться с нашим клубом VIP.\n\nВыберите раздел ниже. В этом боте будем присылать новые материалы, новости клуба и анонсы эфиров. Управлять сообщениями можно в разделе «Новости» или командой /stop.', mainKeyboard(admin)],
    materials: ['<b>Полезные материалы</b>\n\nНачните с бесплатного PDF «Брасс с нуля: 8 тренировок» или заберите чек-листы для ближайшего занятия.\n\nМатериалы остаются в меню — к ним можно возвращаться в своём темпе.', [[button('🏊 Уроки с нуля', 'cat:lessons')], [button('📄 Чек-листы', 'cat:checklists')], [button('🗓 Планы тренировок', 'cat:plans')], ...nav()]],
    about: ['<b>Плавательный остров VIP</b>\n\nКлуб для тех, кто хочет плавать увереннее, понимать свою технику и приходить в бассейн с готовым планом.\n\nВ приложении: обучение с нуля, совершенствование техники, тренировки в воде и на суше, упражнения, эфиры и общение.\n\nВыбирайте свой уровень и занимайтесь в удобном ритме. Индивидуальное онлайн-ведение с тренером оформляется отдельно.', [[button('💳 Посмотреть тарифы', 'tariffs')], [button('💎 Присоединиться к VIP', 'buy')], ...nav()]],
    buy: ['<b>Присоединиться к VIP</b>\n\n1. Нажмите кнопку оплаты — откроется официальный Tribute.\n2. Выберите срок и проверьте сумму и условия продления.\n3. После оплаты вступите в закрытый VIP-канал через Tribute.\n4. Откройте приложение кнопкой в закреплённом сообщении канала.\n\nОплата проходит в Tribute, данные карты бот не получает.', [[link('💎 Оформить подписку в Tribute', CHECKOUT)], [button('💳 Сначала посмотреть тарифы', 'tariffs')], [button('Подписка уже оформлена', 'access')], ...nav()]],
    access: ['<b>Войти в приложение</b>\n\n<b>В Telegram:</b> после оформления подписки откройте VIP-канал через Tribute. Кнопка приложения — в закреплённом сообщении.\n\n<b>На сайте:</b> войдите в существующий веб-аккаунт. Оплата в Tribute сама по себе не создаёт логин и пароль для сайта; если аккаунта пока нет, напишите нам для подключения.\n\nPDF тренировок в приложении скачиваются с активным оплаченным доступом. Бесплатные материалы этого бота доступны отдельно.', [[link('📲 Приложение в Telegram', APP)], [link('🌐 Войти на сайте', WEB)], [link('Открыть подписку в Tribute', CHECKOUT)], [button('Проверить мою подписку', 'checkpaid')], [link('Помочь с веб-доступом', CONTACT)], ...nav()]],
    news: ['<b>Новости Плавательного острова</b>\n\nЗдесь будут новые полезные материалы, анонсы эфиров и обновления VIP. Последние выпуски можно открыть по кнопке ниже.\n\n' + (subscribed ? 'Уведомления включены. Их можно отключить в любой момент.' : 'Уведомления выключены. Материалы и меню по-прежнему доступны.'), [[button('📰 Последние новости', 'news:list')], [button(subscribed ? '🔕 Отключить уведомления' : '🔔 Включить уведомления', subscribed ? 'news:off' : 'news:on')], ...nav()]],
    help: ['<b>Поможем разобраться</b>\n\n<b>Оплатили, но не нашли вход?</b> Откройте Tribute с того же Telegram-аккаунта, с которого оформляли подписку. Там будет переход в закрытый канал.\n\n<b>Забыли, где материалы?</b> Вернитесь в главное меню командой /menu.\n\n<b>Есть вопрос об оплате, веб-входе или онлайн-ведении?</b> Напишите Ярославу — кнопка ниже.', [[link('💬 Написать Ярославу', CONTACT)], [button('📲 Вход в приложение', 'access')], ...nav()]],
  };
  const [caption, rows] = cards[key] || cards.home;
  return { caption, photo: PHOTOS[key] || PHOTOS.home, rows };
}
