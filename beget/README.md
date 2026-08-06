# Развёртывание АмирДент на Beget

Этот пакет заменяет Netlify Functions и Netlify Blobs автономным Node.js-сервером
и файловым хранилищем. Работают публичные страницы, формы, Telegram, админка,
загрузка фотографий, список заявок и поиск рейтинга врача.

## 1. Что требуется

- виртуальный хостинг Beget с SSH;
- Node.js 20.12.2 или новее (рекомендуется доступная у Beget 20.20.2);
- домен с включённым HTTPS;
- Python 3 для кнопки поиска рейтинга врача (без Python остальной сайт работает).

Официальная инструкция Beget по Node.js и Passenger:
https://beget.com/ru/kb/how-to/web-apps/node-js

## 2. До переключения домена

Сначала соберите пакет локально, указав основной домен для canonical, OpenGraph,
robots.txt и sitemap:

```bash
SITE_URL=https://amirdent.ru npm run build:beget
```

Если администратор уже менял контент на Netlify, выгрузите живой снимок и
загруженные изображения прямо в пакет:

```bash
npm run export:netlify -- https://amirdent.netlify.app dist/beget/amirdent/storage
```

Не отключайте Netlify, пока эта команда не завершится успешно. Заявки из
Netlify Blobs автоматически выгрузить без действующей админской сессии нельзя:
при необходимости сохраните их из раздела «Заявки» до переключения домена.

Создайте архив для загрузки:

```bash
tar -C dist/beget -czf dist/amirdent-beget.tar.gz amirdent
```

## 3. Установка на Beget

1. В панели Beget создайте сайт, прикрепите домен и включите SSL.
2. Подключитесь по SSH, затем войдите в Docker-окружение командой
   `ssh localhost -p 222`.
3. Установите Node.js по официальной инструкции Beget и проверьте `node -v`.
4. Загрузите и распакуйте каталог `amirdent` рядом с `public_html`, например:

```bash
cd ~/DOMAIN
tar -xzf ~/amirdent-beget.tar.gz
cd amirdent
cp .env.example .env
chmod 600 .env
find storage -type d -exec chmod 700 {} \;
find storage -type f -exec chmod 600 {} \;
```

5. Заполните `.env`. Хэш пароля и секрет health-check можно создать так:

```bash
printf '%s' 'ОЧЕНЬ-ДЛИННЫЙ-ПАРОЛЬ' | sha256sum
openssl rand -hex 24
```

В `.env` укажите `CMS_LOGIN`, полученный `CMS_PASSWORD_HASH`, `BOT_TOKEN`,
`CHAT_ID` и `HEALTH_TOKEN`. Не помещайте `.env` внутрь `site`/`public_html`.

6. Скопируйте `.htaccess.example` в корень сайта Beget (рядом с
   `public_html`), назовите `.htaccess` и замените `LOGIN`, `DOMAIN` и пути:

```bash
cp amirdent/.htaccess.example .htaccess
```

7. Для безопасного переключения сначала переименуйте старый `public_html`,
   затем создайте ссылку на статику:

```bash
mv public_html public_html.before-amirdent
ln -s amirdent/site public_html
touch amirdent/tmp/restart.txt
```

Не выполняйте `rm -rf public_html`: резервная копия позволяет быстро откатиться.

## 4. Проверка до смены DNS

Откройте технический домен Beget и проверьте:

- `/`, `/prices`, `/uslugi/ultrazvukovaya-diagnostika/`;
- `/admin.html`: вход, сохранение текста и загрузку фотографии;
- отправку тестовой заявки и её появление в Telegram и разделе «Заявки»;
- health-check:

```bash
curl -H "Authorization: Bearer ВАШ_HEALTH_TOKEN" https://DOMAIN/api/health
```

Ответ должен содержать `"status":"ok"`. Если `degraded`, поле `checks`
покажет, что именно не настроено.

## 5. Переключение и откат

После успешной проверки направьте домен на Beget и дождитесь обновления DNS.
Netlify оставьте включённым минимум на 48 часов. После переключения повторите
проверку формы и админки на основном домене.

Быстрый откат на старую папку Beget:

```bash
mv public_html public_html.amirdent
mv public_html.before-amirdent public_html
```

Возврат на Netlify выполняется обратной сменой DNS-записей.

## Хранение данных и резервные копии

- `storage/content.json` — актуальный снимок CMS;
- `storage/media/` — загруженные через админку изображения;
- `storage/leads/` — заявки с сайта;
- `storage/sessions/` — временные сессии администратора.

Добавьте `storage/content.json`, `storage/media` и `storage/leads` в резервное
копирование Beget. Каталог `storage` расположен вне `public_html` и не должен
быть доступен по HTTP.
