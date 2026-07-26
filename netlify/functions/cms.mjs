// Админ-панель: вход, сохранение и выдача контента сайта.
//
// Пароль проверяется здесь, на сервере. В файлах сайта его нет и быть не должно:
// всё, что лежит в папке site, скачивается посетителем по прямой ссылке.
//
// Переменные окружения:
//   CMS_LOGIN          — логин администратора (по умолчанию admin)
//   CMS_PASSWORD_HASH  — SHA-256 пароля в шестнадцатеричном виде
//
// Клиент присылает не сам пароль, а его SHA-256 — тот же протокол, что и раньше,
// поэтому админка коллеги работает без переделок.

import { getStore } from '@netlify/blobs';
import { createHash, timingSafeEqual } from 'node:crypto';

const STORE = 'cms';
const KEY = 'content';
const MAX_BYTES = 2 * 1024 * 1024;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Логин присылается открытым текстом, пароль — уже хешированным
function checkCredentials({ login, token }) {
  const expectedLogin = (process.env.CMS_LOGIN || 'admin').trim();
  const expectedHash = (process.env.CMS_PASSWORD_HASH || '').trim().toLowerCase();
  if (!expectedHash) return { ok: false, status: 500, error: 'not_configured' };

  const loginOk = login === undefined || sameSecret(sha256(String(login).trim()), sha256(expectedLogin));
  const tokenOk = sameSecret(String(token || '').trim().toLowerCase(), expectedHash);
  if (!loginOk || !tokenOk) return { ok: false, status: 401, error: 'unauthorized' };
  return { ok: true };
}

export default async (request) => {
  const path = new URL(request.url).pathname;

  // Контент нужен каждому посетителю — отдаём без пароля
  if (path.endsWith('/content') || path.endsWith('/content.json')) {
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    const store = getStore(STORE);
    const saved = await store.get(KEY, { type: 'json', consistency: 'strong' });
    return json(saved || {});
  }

  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  const token = request.headers.get('X-CMS-Token') || payload.token;

  if (path.endsWith('/login')) {
    const auth = checkCredentials({ login: payload.login, token });
    if (!auth.ok) {
      console.warn(`cms: неудачный вход (${auth.error})`);
      return json({ error: auth.error }, auth.status);
    }
    return json({ ok: true });
  }

  if (path.endsWith('/save')) {
    // Логин при сохранении не присылается — проверяем только пароль
    const auth = checkCredentials({ token });
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    const content = payload.content;
    if (!content || typeof content !== 'object') return json({ error: 'bad_content' }, 400);

    const body = JSON.stringify(content);
    if (body.length > MAX_BYTES) return json({ error: 'too_large' }, 413);

    const store = getStore(STORE);
    await store.set(KEY, body, { metadata: { savedAt: content.savedAt || null } });
    console.log(`cms: контент сохранён (${body.length} байт)`);
    return json({ ok: true, saved: 'netlify-blobs' });
  }

  return json({ error: 'not_found' }, 404);
};

export const config = {
  path: ['/api/cms/login', '/api/cms/save', '/api/cms/content'],
};
