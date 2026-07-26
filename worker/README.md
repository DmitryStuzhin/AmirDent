# Приём заявок в Telegram

Форма «Записаться на приём» на amirdent.ru отправляет заявку в этот Worker,
а он пересылает её ботом [@amirDentBot](https://t.me/amirDentBot) в Telegram.

Токен бота **никогда не попадает в код сайта** — он живёт только в секретах
Cloudflare. Иначе его можно было бы прочитать в исходниках страницы и угнать бота.

```
браузер (форма)  ──POST /──▶  Cloudflare Worker  ──sendMessage──▶  Telegram
                              (BOT_TOKEN, CHAT_ID)
```

## Развёртывание

1. Установить Wrangler и войти в аккаунт Cloudflare:

   ```bash
   npm install -g wrangler && wrangler login
   ```

2. Узнать `CHAT_ID` получателя: написать боту `/start` в Telegram, затем

   ```bash
   curl -s "https://api.telegram.org/bot<ТОКЕН>/getUpdates"
   ```

   и взять `result[0].message.chat.id` из ответа.

3. Записать секреты (значения запрашиваются интерактивно, в файлы не пишутся):

   ```bash
   cd worker && wrangler secret put BOT_TOKEN && wrangler secret put CHAT_ID
   ```

4. Опубликовать:

   ```bash
   cd worker && wrangler deploy
   ```

   Wrangler напечатает адрес вида `https://amirdent-lead.<subdomain>.workers.dev`.

5. Вписать этот адрес в `LEAD_ENDPOINT` в начале `assets/main.js` и задеплоить сайт.

## Локальная разработка

```bash
cd worker && wrangler dev
```

Секреты для `wrangler dev` берутся из файла `worker/.dev.vars` (он в `.gitignore`):

```
BOT_TOKEN=...
CHAT_ID=...
```

## Настройки

| Переменная         | Где задаётся      | Назначение                                        |
| ------------------ | ----------------- | ------------------------------------------------- |
| `BOT_TOKEN`        | секрет            | Токен бота от @BotFather                          |
| `CHAT_ID`          | секрет            | Куда отправлять заявки                            |
| `ALLOWED_ORIGINS`  | `wrangler.toml`   | Домены, которым разрешено отправлять заявки (CORS) |

Заявки с других домённых адресов отклоняются с кодом 403, пустые и неполные — с 400.
Скрытое поле `company` в форме служит ловушкой для ботов: если оно заполнено,
Worker отвечает `ok`, но ничего не отправляет.
