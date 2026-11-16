# Веб-кабинет Плавательного острова VIP

Сборка использует опубликованные тренировки и страницы кабинета. В production на Timeweb сервер выдаёт страницы с vip.swimisland.ru и передаёт запросы кабинета существующему API чатов. Ученик и тренер работают с одной базой. Сборка также умеет запускаться с локальной SQLite для проверки и отдельного переноса.

## Веб-кабинет на Timeweb

Рабочий сервис запускается через Node.js 22.17 или новее. Для локальной базы используйте Node.js 24.

    node deploy/timeweb/build.mjs /path/to/checkout /opt/swim-island-vip/NEW_RELEASE

Для первой установки на сервере Debian с Nginx и Certbot:

    bash deploy/timeweb/install.sh /opt/swim-island-vip/NEW_RELEASE

Привяжите A-запись vip.swimisland.ru к серверу. После того как DNS обновится:

    bash deploy/timeweb/tls.sh

Проверьте /health, вход ученика по приглашению, каталог, чат и настоящее видео из внешнего плеера. Запросы кабинета идут на HTTPS. Сервер передаёт только свои cookies сессии, проверяет Origin и оставляет базу в текущем сервисе.

Для локальной отладки запустите server.mjs с SWIM_PUBLIC_ORIGIN, SWIM_DB и PORT. Создайте тестовую базу командой node database.mjs init /path/to/test.sqlite. SQL-экспорт D1 можно восстановить командой node database.mjs import /path/to/new.sqlite /path/to/export.sql.
