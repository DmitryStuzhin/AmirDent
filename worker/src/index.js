const LIMITS = { name: 80, phone: 32, service: 60, page: 200 };

const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });

const clean = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function moscowTime() {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const originOk = allowed.includes(origin);
    const cors = originOk
      ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
      : {};

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);
    if (!originOk) return json({ error: 'forbidden_origin' }, 403, {});

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'bad_json' }, 400, cors);
    }

    // Honeypot: real visitors never fill a field hidden from the layout.
    if (clean(payload.company, 10)) return json({ ok: true }, 200, cors);

    const name = clean(payload.name, LIMITS.name);
    const phone = clean(payload.phone, LIMITS.phone);
    const service = clean(payload.service, LIMITS.service);
    const page = clean(payload.page, LIMITS.page);

    if (name.length < 2) return json({ error: 'invalid_name' }, 400, cors);
    if ((phone.match(/\d/g) || []).length < 10) return json({ error: 'invalid_phone' }, 400, cors);

    const lines = [
      '🦷 <b>Новая заявка с сайта АмирДент</b>',
      '',
      `<b>Имя:</b> ${escapeHtml(name)}`,
      `<b>Телефон:</b> ${escapeHtml(phone)}`,
    ];
    if (service) lines.push(`<b>Услуга:</b> ${escapeHtml(service)}`);
    lines.push(`<b>Время:</b> ${moscowTime()} (МСК)`);
    if (page) lines.push(`<b>Страница:</b> ${escapeHtml(page)}`);

    const tg = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.CHAT_ID,
        text: lines.join('\n'),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    if (!tg.ok) {
      console.error('telegram_failed', tg.status, await tg.text());
      return json({ error: 'telegram_failed' }, 502, cors);
    }

    return json({ ok: true }, 200, cors);
  },
};
