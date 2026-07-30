// Receives appointment requests, stores them durably and notifies Telegram.

import { getStore } from '@netlify/blobs';
import { createHash, randomUUID } from 'node:crypto';

const LIMITS = { name: 80, phone: 32, service: 100, page: 300, consentVersion: 40 };
const MAX_BODY_BYTES = 8 * 1024;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 6;
const LEADS_STORE = 'leads';

const escapeHtml = (value) =>
  value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);

const json = (body, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });

const clean = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const clientIp = (request) =>
  request.headers.get('x-nf-client-connection-ip') ||
  (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
  'unknown';

function isSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function normalizePhone(value) {
  const digits = value.replace(/\D/g, '');
  const national = digits.length === 11 && (digits[0] === '7' || digits[0] === '8') ? digits.slice(1) : digits;
  return national.length === 10 ? `+7${national}` : '';
}

function moscowTime(date) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

async function rateLimit(store, request) {
  const key = `rate/${hash(clientIp(request)).slice(0, 24)}`;
  const saved = (await store.get(key, { type: 'json', consistency: 'strong' })) || {};
  const current = Date.now();
  const state =
    saved.startedAt && current - saved.startedAt < RATE_WINDOW_MS
      ? { startedAt: saved.startedAt, count: Number(saved.count) || 0 }
      : { startedAt: current, count: 0 };
  if (state.count >= RATE_MAX) {
    return { limited: true, retryAfter: Math.ceil((state.startedAt + RATE_WINDOW_MS - current) / 1000) };
  }
  await store.setJSON(key, { startedAt: state.startedAt, count: state.count + 1 });
  return { limited: false };
}

async function sendTelegram(botToken, chatId, text) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(7000),
      });
      if (response.ok) return { ok: true };
      const errorBody = (await response.text()).slice(0, 300);
      lastError = `telegram_${response.status}:${errorBody}`;
      if (response.status >= 400 && response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error?.name === 'TimeoutError' ? 'telegram_timeout' : 'telegram_network_error';
    }
  }
  return { ok: false, error: lastError || 'telegram_failed' };
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  if (!isSameOrigin(request)) return json({ error: 'bad_origin' }, 403);
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return json({ error: 'unsupported_media_type' }, 415);
  }
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) {
    return json({ error: 'too_large' }, 413);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  if (clean(payload.company, 10)) return json({ ok: true });

  const name = clean(payload.name, LIMITS.name);
  const phone = normalizePhone(clean(payload.phone, LIMITS.phone));
  const service = clean(payload.service, LIMITS.service);
  const page = clean(payload.page, LIMITS.page);
  const consentVersion = clean(payload.consentVersion, LIMITS.consentVersion);
  if (name.length < 2) return json({ error: 'invalid_name' }, 400);
  if (!phone) return json({ error: 'invalid_phone' }, 400);
  if (payload.consent !== true || !consentVersion) return json({ error: 'consent_required' }, 400);

  const store = getStore(LEADS_STORE);
  const rate = await rateLimit(store, request);
  if (rate.limited) {
    return json({ error: 'rate_limited' }, 429, { 'Retry-After': String(rate.retryAfter) });
  }

  const id = randomUUID();
  const createdAt = new Date();
  const lead = {
    id,
    createdAt: createdAt.toISOString(),
    name,
    phone,
    service,
    page,
    consent: { accepted: true, version: consentVersion, acceptedAt: createdAt.toISOString() },
    source: 'website',
    notification: { status: 'pending' },
  };
  await store.setJSON(`leads/${createdAt.toISOString().slice(0, 10)}/${id}`, lead);

  const botToken = (process.env.BOT_TOKEN || '').trim();
  const chatId = (process.env.CHAT_ID || '').trim();
  if (!/^\d{6,}:[\w-]{30,}$/.test(botToken) || !chatId) {
    console.error(`lead: notification is not configured; lead ${id} was stored`);
    return json({ ok: true, id, notification: 'pending' }, 202);
  }

  const lines = [
    '🦷 <b>Новая заявка с сайта АмирДент</b>',
    '',
    `<b>ID:</b> ${escapeHtml(id)}`,
    `<b>Имя:</b> ${escapeHtml(name)}`,
    `<b>Телефон:</b> ${escapeHtml(phone)}`,
  ];
  if (service) lines.push(`<b>Услуга:</b> ${escapeHtml(service)}`);
  lines.push(`<b>Время:</b> ${moscowTime(createdAt)} (МСК)`);
  if (page) lines.push(`<b>Страница:</b> ${escapeHtml(page)}`);

  const notification = await sendTelegram(botToken, chatId, lines.join('\n'));
  lead.notification = {
    status: notification.ok ? 'sent' : 'failed',
    updatedAt: new Date().toISOString(),
    error: notification.ok ? undefined : notification.error,
  };
  await store.setJSON(`leads/${createdAt.toISOString().slice(0, 10)}/${id}`, lead);

  if (!notification.ok) {
    console.error(`lead: Telegram delivery failed for stored lead ${id}: ${notification.error}`);
    return json({ ok: true, id, notification: 'pending' }, 202);
  }
  return json({ ok: true, id, notification: 'sent' });
};

export const config = { path: '/api/lead' };
