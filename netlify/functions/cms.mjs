// Админ-панель: вход, сохранение, загрузка фото и выдача контента.
//
// Пароль проверяется здесь, на сервере. В файлах сайта его нет и быть не должно:
// всё, что лежит в папке site, скачивается посетителем по прямой ссылке.
//
// Переменные окружения:
//   CMS_LOGIN          — логин администратора (по умолчанию admin)
//   CMS_PASSWORD_HASH  — SHA-256 пароля в шестнадцатеричном виде

import { getStore } from '@netlify/blobs';
import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';

const STORE = 'cms';
const KEY = 'content';
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE = 900_000;

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
  const url = new URL(request.url);
  const path = url.pathname;

  if (path.endsWith('/content') || path.endsWith('/content.json')) {
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    const store = getStore(STORE);
    const saved = await store.get(KEY, { type: 'json', consistency: 'strong' });
    return json(saved || {});
  }

  // GET /api/cms/media?id=...
  if (path.endsWith('/media')) {
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    const id = (url.searchParams.get('id') || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!id) return json({ error: 'bad_id' }, 400);
    const store = getStore(STORE);
    const key = `media/${id}`;
    const buf = await store.get(key, { type: 'arrayBuffer', consistency: 'strong' });
    if (!buf) return json({ error: 'not_found' }, 404);
    const meta = await store.getMetadata(key);
    const type = (meta && meta.metadata && meta.metadata.contentType) || 'image/jpeg';
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
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

  if (path.endsWith('/upload')) {
    const auth = checkCredentials({ token });
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    const image = String(payload.image || '');
    const m = image.match(/^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,(.+)$/i);
    if (!m) return json({ error: 'bad_image' }, 400);

    let raw;
    try {
      raw = Buffer.from(m[2], 'base64');
    } catch {
      return json({ error: 'bad_image' }, 400);
    }
    if (raw.length > MAX_IMAGE) return json({ error: 'too_large' }, 413);

    const mime = m[1].toLowerCase().replace('image/jpg', 'image/jpeg');
    const id = createHash('sha256').update(raw).digest('hex').slice(0, 16);
    const store = getStore(STORE);
    await store.set(`media/${id}`, raw, { metadata: { contentType: mime } });
    console.log(`cms: фото сохранено ${id} (${raw.length} байт)`);
    return json({ ok: true, url: `/api/cms/media?id=${id}` });
  }

  if (path.endsWith('/save')) {
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
  path: ['/api/cms/login', '/api/cms/save', '/api/cms/content', '/api/cms/upload', '/api/cms/media'],
};
