// AmirDent CMS API: server-side sessions, versioned content and media uploads.
//
// Environment variables:
//   CMS_LOGIN          — administrator login (required)
//   CMS_PASSWORD_HASH  — SHA-256 of the password (required; legacy-compatible)

import { getStore } from '@netlify/blobs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const STORE = 'cms';
const CONTENT_KEY = 'content';
const MAX_CONTENT_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 900_000;
const SESSION_COOKIE = 'amirdent_cms_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

const securityHeaders = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
};

const json = (body, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...securityHeaders, ...extraHeaders },
  });

const sha256 = (value) => createHash('sha256').update(String(value), 'utf8').digest('hex');
const now = () => Date.now();

function sameSecret(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function cookieValue(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return '';
}

function sessionCookie(token) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(
    SESSION_TTL_MS / 1000
  )}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function clientIp(request) {
  return (
    request.headers.get('x-nf-client-connection-ip') ||
    (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown'
  );
}

function isSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function readJson(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw Object.assign(new Error('unsupported_media_type'), { status: 415 });
  }
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_CONTENT_BYTES + MAX_IMAGE_BYTES) {
    throw Object.assign(new Error('too_large'), { status: 413 });
  }
  try {
    return await request.json();
  } catch {
    throw Object.assign(new Error('bad_json'), { status: 400 });
  }
}

async function authenticate(request, store) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token || token.length < 40 || token.length > 100) return null;
  const key = `sessions/${sha256(token)}`;
  const session = await store.get(key, { type: 'json', consistency: 'strong' });
  if (!session || !session.expiresAt || session.expiresAt <= now()) {
    if (session) await store.delete(key);
    return null;
  }
  return { token, key, session };
}

async function loginState(store, request) {
  const key = `login-attempts/${sha256(clientIp(request)).slice(0, 24)}`;
  const saved = (await store.get(key, { type: 'json', consistency: 'strong' })) || {};
  if (!saved.startedAt || now() - saved.startedAt > LOGIN_WINDOW_MS) {
    return { key, attempts: 0, startedAt: now() };
  }
  return { key, attempts: Number(saved.attempts) || 0, startedAt: saved.startedAt };
}

async function handleLogin(request, store) {
  const expectedLogin = (process.env.CMS_LOGIN || '').trim();
  const expectedHash = (process.env.CMS_PASSWORD_HASH || '').trim().toLowerCase();
  if (!expectedLogin || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    console.error('cms: CMS_LOGIN/CMS_PASSWORD_HASH are not configured');
    return json({ error: 'not_configured' }, 500);
  }

  const state = await loginState(store, request);
  if (state.attempts >= LOGIN_MAX_ATTEMPTS) {
    return json(
      { error: 'rate_limited', retryAfter: Math.ceil((state.startedAt + LOGIN_WINDOW_MS - now()) / 1000) },
      429,
      { 'Retry-After': String(Math.max(1, Math.ceil((state.startedAt + LOGIN_WINDOW_MS - now()) / 1000))) }
    );
  }

  const payload = await readJson(request);
  const login = String(payload.login || '').trim();
  const password = String(payload.password || '');
  const validLogin = sameSecret(sha256(login), sha256(expectedLogin));
  const validPassword = sameSecret(sha256(password), expectedHash);

  if (!validLogin || !validPassword) {
    await store.setJSON(state.key, {
      attempts: state.attempts + 1,
      startedAt: state.startedAt,
    });
    console.warn(`cms: failed login from ${sha256(clientIp(request)).slice(0, 12)}`);
    return json({ error: 'unauthorized' }, 401);
  }

  await store.delete(state.key);
  const token = randomBytes(32).toString('base64url');
  const session = {
    login: expectedLogin,
    createdAt: now(),
    expiresAt: now() + SESSION_TTL_MS,
    ipHash: sha256(clientIp(request)).slice(0, 24),
  };
  await store.setJSON(`sessions/${sha256(token)}`, session);
  return json(
    { ok: true, user: { login: expectedLogin }, expiresAt: session.expiresAt },
    200,
    { 'Set-Cookie': sessionCookie(token) }
  );
}

function validImageType(raw, declared) {
  const signatures = [
    { mime: 'image/jpeg', ok: raw[0] === 0xff && raw[1] === 0xd8 && raw[2] === 0xff },
    {
      mime: 'image/png',
      ok:
        raw.length >= 8 &&
        raw.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    },
    {
      mime: 'image/webp',
      ok: raw.length >= 12 && raw.toString('ascii', 0, 4) === 'RIFF' && raw.toString('ascii', 8, 12) === 'WEBP',
    },
  ];
  return signatures.some((item) => item.mime === declared && item.ok);
}

function revisionFor(content) {
  return String(content?.revision || content?.savedAt || '');
}

async function handleSave(payload, store, session) {
  const content = payload.content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return json({ error: 'bad_content' }, 400);
  }

  const previous = (await store.get(CONTENT_KEY, { type: 'json', consistency: 'strong' })) || {};
  const expectedRevision = String(payload.revision || '');
  const currentRevision = revisionFor(previous);
  if (expectedRevision && currentRevision && expectedRevision !== currentRevision) {
    return json({ error: 'revision_conflict', currentRevision }, 409);
  }

  const savedAt = new Date().toISOString();
  const revision = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  const next = { ...content, savedAt, revision };
  const body = JSON.stringify(next);
  if (Buffer.byteLength(body, 'utf8') > MAX_CONTENT_BYTES) return json({ error: 'too_large' }, 413);

  if (Object.keys(previous).length) {
    const versionKey = `versions/${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`;
    await store.setJSON(versionKey, {
      content: previous,
      archivedAt: savedAt,
      archivedBy: session.login,
    });
  }
  await store.set(CONTENT_KEY, body, { metadata: { savedAt, revision } });
  console.log(`cms: content saved by ${session.login} (${Buffer.byteLength(body, 'utf8')} bytes)`);
  return json({ ok: true, saved: 'netlify-blobs', savedAt, revision });
}

export default async (request) => {
  const url = new URL(request.url);
  const path = url.pathname;
  const store = getStore(STORE);

  try {
    if (path.endsWith('/content') || path.endsWith('/content.json')) {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
      const saved = await store.get(CONTENT_KEY, { type: 'json', consistency: 'strong' });
      return json(saved || {});
    }

    if (path.endsWith('/media')) {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
      const id = (url.searchParams.get('id') || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!id) return json({ error: 'bad_id' }, 400);
      const key = `media/${id}`;
      const buf = await store.get(key, { type: 'arrayBuffer', consistency: 'strong' });
      if (!buf) return json({ error: 'not_found' }, 404);
      const meta = await store.getMetadata(key);
      const type = meta?.metadata?.contentType || 'image/jpeg';
      return new Response(buf, {
        status: 200,
        headers: {
          'Content-Type': type,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    if (request.method === 'POST' && !isSameOrigin(request)) return json({ error: 'bad_origin' }, 403);

    if (path.endsWith('/login')) {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
      return await handleLogin(request, store);
    }

    if (path.endsWith('/session')) {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
      const auth = await authenticate(request, store);
      if (!auth) return json({ authenticated: false }, 401, { 'Set-Cookie': clearSessionCookie() });
      return json({
        authenticated: true,
        user: { login: auth.session.login },
        expiresAt: auth.session.expiresAt,
      });
    }

    if (path.endsWith('/logout')) {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
      const auth = await authenticate(request, store);
      if (auth) await store.delete(auth.key);
      return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
    }

    const auth = await authenticate(request, store);
    if (!auth) return json({ error: 'unauthorized' }, 401, { 'Set-Cookie': clearSessionCookie() });

    if (path.endsWith('/versions')) {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
      const listed = await store.list({ prefix: 'versions/' });
      const keys = listed.blobs.map((blob) => blob.key).sort().reverse().slice(0, 30);
      const versions = [];
      for (const key of keys) {
        const archived = await store.get(key, { type: 'json', consistency: 'strong' });
        if (!archived) continue;
        versions.push({
          key,
          archivedAt: archived.archivedAt || null,
          archivedBy: archived.archivedBy || null,
          savedAt: archived.content?.savedAt || null,
        });
      }
      return json({ ok: true, versions });
    }

    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    const payload = await readJson(request);

    if (path.endsWith('/upload')) {
      const image = String(payload.image || '');
      const match = image.match(/^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/=\s]+)$/);
      if (!match) return json({ error: 'bad_image' }, 400);
      const raw = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
      if (!raw.length || raw.length > MAX_IMAGE_BYTES) return json({ error: 'too_large' }, 413);
      const mime = match[1].toLowerCase();
      if (!validImageType(raw, mime)) return json({ error: 'bad_image_signature' }, 400);
      const id = createHash('sha256').update(raw).digest('hex').slice(0, 24);
      await store.set(`media/${id}`, raw, { metadata: { contentType: mime, uploadedBy: auth.session.login } });
      return json({ ok: true, url: `/api/cms/media?id=${id}` });
    }

    if (path.endsWith('/save')) return await handleSave(payload, store, auth.session);

    if (path.endsWith('/restore')) {
      const key = String(payload.key || '');
      if (!/^versions\/[a-zA-Z0-9_-]+$/.test(key)) return json({ error: 'bad_version' }, 400);
      const archived = await store.get(key, { type: 'json', consistency: 'strong' });
      if (!archived?.content) return json({ error: 'not_found' }, 404);
      const current = (await store.get(CONTENT_KEY, { type: 'json', consistency: 'strong' })) || {};
      const restoredAt = new Date().toISOString();
      if (Object.keys(current).length) {
        await store.setJSON(
          `versions/${restoredAt.replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`,
          { content: current, archivedAt: restoredAt, archivedBy: auth.session.login }
        );
      }
      const restored = {
        ...archived.content,
        savedAt: restoredAt,
        revision: `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`,
      };
      await store.setJSON(CONTENT_KEY, restored, {
        metadata: { savedAt: restored.savedAt, revision: restored.revision },
      });
      console.log(`cms: version restored by ${auth.session.login}`);
      return json({ ok: true, savedAt: restored.savedAt, revision: restored.revision });
    }

    return json({ error: 'not_found' }, 404);
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error('cms: unexpected error', error);
    return json({ error: status >= 500 ? 'server_error' : error.message }, status);
  }
};

export const config = {
  path: [
    '/api/cms/login',
    '/api/cms/logout',
    '/api/cms/session',
    '/api/cms/versions',
    '/api/cms/restore',
    '/api/cms/save',
    '/api/cms/content',
    '/api/cms/upload',
    '/api/cms/media',
  ],
};
