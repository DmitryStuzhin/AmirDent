// Принимает заявку с формы записи и отправляет её ботом в Telegram.
// Запускается на стороне Netlify, поэтому токен не попадает в код страницы.
//
// Токен берётся из переменных окружения Netlify (BOT_TOKEN, CHAT_ID), а если они
// не заданы — из settings.mjs рядом. Так сайт работает сразу после развёртывания,
// а перенести токен в настройки Netlify можно позже, ничего не меняя в коде.

import settings from './settings.mjs';

const LIMITS = { name: 80, phone: 32, service: 60, page: 200 };

const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const json = (body, status) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

const clean = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const moscowTime = () =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const botToken = process.env.BOT_TOKEN || settings.bot_token;
  const chatId = process.env.CHAT_ID || settings.chat_id;
  if (!botToken || !chatId) {
    console.error('lead: не заданы BOT_TOKEN и CHAT_ID');
    return json({ error: 'not_configured' }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  // Скрытое поле-ловушка: живой посетитель его не видит и не заполняет.
  if (clean(payload.company, 10)) return json({ ok: true }, 200);

  const name = clean(payload.name, LIMITS.name);
  const phone = clean(payload.phone, LIMITS.phone);
  const service = clean(payload.service, LIMITS.service);
  const page = clean(payload.page, LIMITS.page);

  if (name.length < 2) return json({ error: 'invalid_name' }, 400);
  if ((phone.match(/\d/g) || []).length < 10) return json({ error: 'invalid_phone' }, 400);

  const lines = [
    '🦷 <b>Новая заявка с сайта АмирДент</b>',
    '',
    `<b>Имя:</b> ${escapeHtml(name)}`,
    `<b>Телефон:</b> ${escapeHtml(phone)}`,
  ];
  if (service) lines.push(`<b>Услуга:</b> ${escapeHtml(service)}`);
  lines.push(`<b>Время:</b> ${moscowTime()} (МСК)`);
  if (page) lines.push(`<b>Страница:</b> ${escapeHtml(page)}`);

  const tg = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: lines.join('\n'),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  if (!tg.ok) {
    // Заявку нельзя терять: она остаётся в журнале функции в панели Netlify.
    console.error(
      `lead: Telegram не принял заявку (${tg.status} ${await tg.text()}). ` +
        `Имя: ${name}, телефон: ${phone}, услуга: ${service}`
    );
    return json({ error: 'telegram_failed' }, 502);
  }

  return json({ ok: true }, 200);
};

// Адрес, по которому функция доступна на сайте
export const config = { path: '/api/lead' };
