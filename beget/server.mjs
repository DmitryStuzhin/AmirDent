import http from 'node:http';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const MODULE_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)));
const APP_ROOT = existsSync(join(MODULE_DIR, 'site')) ? MODULE_DIR : resolve(MODULE_DIR, '..');
const SITE_DIR = resolve(process.env.BEGET_SITE_DIR || join(APP_ROOT, 'site'));
const STORAGE_DIR = resolve(process.env.BEGET_STORAGE_DIR || join(APP_ROOT, 'storage'));
const CONTENT_FILE = join(STORAGE_DIR, 'content.json');
const STATIC_CONTENT_FILE = join(SITE_DIR, 'assets', 'content.json');
const SESSION_COOKIE = 'amirdent_cms_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const LEAD_WINDOW_MS = 60 * 60 * 1000;
const LEAD_RATE_MAX = 6;
const MAX_JSON_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_BYTES = 900_000;

loadEnv(join(APP_ROOT, '.env'));

const MIME = {
  '.avif': 'image/avif', '.css': 'text/css; charset=utf-8', '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon', '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8', '.mp4': 'video/mp4', '.pdf': 'application/pdf',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webm': 'video/webm', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.xml': 'application/xml; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https://static.tildacdn.com https://avatars.mds.yandex.net https://yastatic.net; connect-src 'self'; frame-src https://yandex.ru https://yandex.com; upgrade-insecure-requests",
};

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] != null) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value.replace(/\\n/g, '\n');
  }
}

const sha256 = (value) => createHash('sha256').update(String(value), 'utf8').digest('hex');
const clean = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const safeEqual = (a, b) => {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  return aa.length > 0 && aa.length === bb.length && timingSafeEqual(aa, bb);
};

async function ensureStorage() {
  for (const dir of ['sessions', 'login-rate', 'lead-rate', 'leads', 'media']) await mkdir(join(STORAGE_DIR, dir), { recursive: true });
  if (!existsSync(CONTENT_FILE) && existsSync(STATIC_CONTENT_FILE)) {
    await atomicWrite(CONTENT_FILE, await readFile(STATIC_CONTENT_FILE));
  }
}

async function atomicWrite(path, data) {
  await mkdir(resolve(path, '..'), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

async function readJsonFile(path, fallback = null) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

function send(res, status, body = '', headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  if (res.req.method === 'HEAD') return res.end();
  res.end(body);
}

function json(res, status, body, headers = {}) {
  send(res, status, JSON.stringify(body), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
}

async function readJsonBody(req, max = MAX_JSON_BYTES) {
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw httpError(415, 'unsupported_media_type');
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > max) throw httpError(413, 'too_large');
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > max) throw httpError(413, 'too_large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw httpError(400, 'bad_json'); }
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

function requestOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')).split(',')[0];
  return `${proto}://${req.headers.host || 'localhost'}`;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(requestOrigin(req)).origin; } catch { return false; }
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key) out[key] = decodeURIComponent(rest.join('='));
  }
  return out;
}

function sessionCookie(req, token) {
  const secure = requestOrigin(req).startsWith('https://') ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

function clearSessionCookie(req) {
  const secure = requestOrigin(req).startsWith('https://') ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=0`;
}

async function authenticate(req) {
  const token = cookies(req)[SESSION_COOKIE] || '';
  if (token.length < 40 || token.length > 100) return null;
  const path = join(STORAGE_DIR, 'sessions', `${sha256(token)}.json`);
  const session = await readJsonFile(path);
  if (!session || Number(session.expiresAt) <= Date.now()) {
    if (session) await unlink(path).catch(() => {});
    return null;
  }
  return { token, path, session };
}

async function handleCms(req, res, url) {
  const action = url.pathname.slice('/api/cms/'.length).replace(/\/+$/, '');
  if (req.method === 'POST' && !sameOrigin(req)) return json(res, 403, { error: 'bad_origin' });

  if (action === 'content' || action === 'content.json') {
    if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' }, { Allow: 'GET' });
    return serveContentJson(req, res, false);
  }
  if (action === 'media') return serveCmsMedia(req, res, url);
  if (action === 'login') return cmsLogin(req, res);

  if (action === 'session') {
    if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' }, { Allow: 'GET' });
    const auth = await authenticate(req);
    if (!auth) return json(res, 401, { authenticated: false }, { 'Set-Cookie': clearSessionCookie(req) });
    return json(res, 200, { authenticated: true, user: { login: auth.session.login }, expiresAt: auth.session.expiresAt });
  }

  if (action === 'logout') {
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
    const auth = await authenticate(req);
    if (auth) await unlink(auth.path).catch(() => {});
    return json(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(req) });
  }

  const auth = await authenticate(req);
  if (!auth) return json(res, 401, { error: 'unauthorized' }, { 'Set-Cookie': clearSessionCookie(req) });

  if (action === 'leads') {
    if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' }, { Allow: 'GET' });
    return json(res, 200, { ok: true, leads: await listLeads() });
  }
  if (action === 'doctor-rating') return cmsDoctorRating(req, res);
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
  const payload = await readJsonBody(req, MAX_JSON_BYTES + MAX_IMAGE_BYTES);
  if (action === 'save') return cmsSave(res, payload, auth.session);
  if (action === 'upload') return cmsUpload(res, payload, auth.session);
  return json(res, 404, { error: 'not_found' });
}

async function cmsLogin(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
  const expectedLogin = clean(process.env.CMS_LOGIN, 100);
  const expectedHash = clean(process.env.CMS_PASSWORD_HASH, 64).toLowerCase();
  if (!expectedLogin || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    return json(res, 500, { error: 'not_configured', message: 'Задайте CMS_LOGIN и CMS_PASSWORD_HASH в .env' });
  }
  const key = sha256(clientIp(req)).slice(0, 24);
  const ratePath = join(STORAGE_DIR, 'login-rate', `${key}.json`);
  const saved = await readJsonFile(ratePath, {});
  const state = saved.startedAt && Date.now() - saved.startedAt < LOGIN_WINDOW_MS ? saved : { startedAt: Date.now(), attempts: 0 };
  if (Number(state.attempts) >= LOGIN_MAX_ATTEMPTS) {
    const retryAfter = Math.max(1, Math.ceil((state.startedAt + LOGIN_WINDOW_MS - Date.now()) / 1000));
    return json(res, 429, { error: 'rate_limited', retryAfter }, { 'Retry-After': String(retryAfter) });
  }
  const payload = await readJsonBody(req, 16 * 1024);
  const validLogin = safeEqual(sha256(clean(payload.login, 100)), sha256(expectedLogin));
  const validPassword = safeEqual(sha256(String(payload.password || '')), expectedHash);
  if (!validLogin || !validPassword) {
    await atomicWrite(ratePath, JSON.stringify({ startedAt: state.startedAt, attempts: Number(state.attempts || 0) + 1 }));
    return json(res, 401, { error: 'unauthorized' });
  }
  await unlink(ratePath).catch(() => {});
  const token = randomBytes(32).toString('base64url');
  const session = { login: expectedLogin, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS, ipHash: key };
  await atomicWrite(join(STORAGE_DIR, 'sessions', `${sha256(token)}.json`), JSON.stringify(session));
  return json(res, 200, { ok: true, user: { login: expectedLogin }, expiresAt: session.expiresAt }, { 'Set-Cookie': sessionCookie(req, token) });
}

async function cmsSave(res, payload, session) {
  const content = payload.content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) return json(res, 400, { error: 'bad_content' });
  const current = await readJsonFile(CONTENT_FILE, {});
  const currentRevision = String(current.revision || current.savedAt || '');
  const expectedRevision = String(payload.revision || '');
  if (expectedRevision && currentRevision && expectedRevision !== currentRevision) {
    return json(res, 409, { error: 'revision_conflict', currentRevision });
  }
  const savedAt = new Date().toISOString();
  const revision = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  const next = { ...content, savedAt, revision };
  const body = JSON.stringify(next, null, 2) + '\n';
  if (Buffer.byteLength(body) > MAX_JSON_BYTES) return json(res, 413, { error: 'too_large' });
  await atomicWrite(CONTENT_FILE, body);
  // public_html у Beget обычно ссылается прямо на site, и Nginx может отдать
  // этот JSON без участия Passenger. Поэтому обновляем и публичный снимок.
  if (process.env.BEGET_SYNC_PUBLIC_CONTENT !== '0') await atomicWrite(STATIC_CONTENT_FILE, body);
  console.log(`cms: content saved by ${session.login}`);
  return json(res, 200, { ok: true, saved: 'beget-files', savedAt, revision });
}

function validImage(raw, mime) {
  if (mime === 'image/jpeg') return raw.length >= 3 && raw[0] === 0xff && raw[1] === 0xd8 && raw[2] === 0xff;
  if (mime === 'image/png') return raw.length >= 8 && raw.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return mime === 'image/webp' && raw.length >= 12 && raw.toString('ascii', 0, 4) === 'RIFF' && raw.toString('ascii', 8, 12) === 'WEBP';
}

async function cmsUpload(res, payload, session) {
  const match = String(payload.image || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/=\s]+)$/);
  if (!match) return json(res, 400, { error: 'bad_image' });
  const raw = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  const mime = match[1].toLowerCase();
  if (!raw.length || raw.length > MAX_IMAGE_BYTES) return json(res, 413, { error: 'too_large' });
  if (!validImage(raw, mime)) return json(res, 400, { error: 'bad_image_signature' });
  const id = sha256(raw).slice(0, 24);
  const ext = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
  await atomicWrite(join(STORAGE_DIR, 'media', `${id}.${ext}`), raw);
  await atomicWrite(join(STORAGE_DIR, 'media', `${id}.json`), JSON.stringify({ mime, uploadedBy: session.login, uploadedAt: new Date().toISOString() }));
  return json(res, 200, { ok: true, url: `/api/cms/media?id=${id}` });
}

async function serveCmsMedia(req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'method_not_allowed' }, { Allow: 'GET, HEAD' });
  const id = clean(url.searchParams.get('id'), 24);
  if (!/^[a-f0-9]{24}$/.test(id)) return json(res, 400, { error: 'bad_id' });
  for (const ext of ['jpg', 'png', 'webp']) {
    const path = join(STORAGE_DIR, 'media', `${id}.${ext}`);
    if (existsSync(path)) return streamFile(req, res, path, 'public, max-age=31536000, immutable');
  }
  return json(res, 404, { error: 'not_found' });
}

async function listLeads() {
  const root = join(STORAGE_DIR, 'leads');
  const rows = [];
  for (const day of await readdir(root).catch(() => [])) {
    for (const file of await readdir(join(root, day)).catch(() => [])) {
      if (!file.endsWith('.json')) continue;
      const row = await readJsonFile(join(root, day, file));
      if (row) rows.push({ id: row.id, createdAt: row.createdAt, name: row.name, phone: row.phone, service: row.service, page: row.page, notification: row.notification });
    }
  }
  return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 50);
}

async function cmsDoctorRating(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
  const payload = await readJsonBody(req, 64 * 1024);
  const name = clean(payload.name, 180);
  if (name.length < 3) return json(res, 400, { ok: false, error: 'Укажите ФИО врача', candidates: [], best: null });
  const python = process.env.PYTHON_BIN || 'python3';
  const cli = join(APP_ROOT, 'doctor-rating-cli.py');
  if (!existsSync(cli)) return json(res, 503, { ok: false, error: 'Модуль поиска рейтинга не установлен' });
  const input = { name, photo: clean(payload.photo, 1000) };
  const localPhoto = await resolveLocalPhoto(input.photo);
  if (localPhoto) input.photoLocalBase64 = localPhoto.toString('base64');
  try {
    const result = await runPython(python, cli, input);
    return json(res, result.ok === false ? 422 : 200, result);
  } catch (error) {
    console.error('doctor-rating:', error.message);
    return json(res, 502, { ok: false, error: 'Не удалось выполнить поиск рейтинга' });
  }
}

async function resolveLocalPhoto(photo) {
  try {
    if (photo.startsWith('/api/cms/media?')) {
      const id = new URL(photo, 'https://local').searchParams.get('id') || '';
      if (/^[a-f0-9]{24}$/.test(id)) for (const ext of ['jpg', 'png', 'webp']) {
        const path = join(STORAGE_DIR, 'media', `${id}.${ext}`);
        if (existsSync(path)) return readFile(path);
      }
    }
    if (photo.startsWith('/assets/')) {
      const path = resolve(SITE_DIR, `.${photo}`);
      if (path.startsWith(SITE_DIR + sep) && existsSync(path)) return readFile(path);
    }
  } catch {}
  return null;
}

function runPython(bin, cli, payload) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, [cli], { cwd: APP_ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('timeout')); }, 75_000);
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(Buffer.concat(err).toString('utf8').slice(0, 500) || `exit ${code}`));
      try { resolvePromise(JSON.parse(Buffer.concat(out).toString('utf8'))); } catch { reject(new Error('bad_python_json')); }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const national = digits.length === 11 && ['7', '8'].includes(digits[0]) ? digits.slice(1) : digits;
  return national.length === 10 ? `+7${national}` : '';
}

async function handleLead(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
  if (!sameOrigin(req)) return json(res, 403, { error: 'bad_origin' });
  const payload = await readJsonBody(req, 8 * 1024);
  if (clean(payload.company, 10)) return json(res, 200, { ok: true });
  const name = clean(payload.name, 80);
  const phone = normalizePhone(clean(payload.phone, 32));
  const service = clean(payload.service, 100);
  const page = clean(payload.page, 300);
  const consentVersion = clean(payload.consentVersion, 40);
  if (name.length < 2) return json(res, 400, { error: 'invalid_name' });
  if (!phone) return json(res, 400, { error: 'invalid_phone' });
  if (payload.consent !== true || !consentVersion) return json(res, 400, { error: 'consent_required' });

  const rateKey = sha256(clientIp(req)).slice(0, 24);
  const ratePath = join(STORAGE_DIR, 'lead-rate', `${rateKey}.json`);
  const saved = await readJsonFile(ratePath, {});
  const rate = saved.startedAt && Date.now() - saved.startedAt < LEAD_WINDOW_MS ? saved : { startedAt: Date.now(), count: 0 };
  if (Number(rate.count) >= LEAD_RATE_MAX) {
    const retryAfter = Math.max(1, Math.ceil((rate.startedAt + LEAD_WINDOW_MS - Date.now()) / 1000));
    return json(res, 429, { error: 'rate_limited' }, { 'Retry-After': String(retryAfter) });
  }
  await atomicWrite(ratePath, JSON.stringify({ startedAt: rate.startedAt, count: Number(rate.count || 0) + 1 }));

  const id = randomUUID();
  const createdAt = new Date();
  const lead = { id, createdAt: createdAt.toISOString(), name, phone, service, page, consent: { accepted: true, version: consentVersion, acceptedAt: createdAt.toISOString() }, source: 'website', notification: { status: 'pending' } };
  const leadPath = join(STORAGE_DIR, 'leads', createdAt.toISOString().slice(0, 10), `${id}.json`);
  await atomicWrite(leadPath, JSON.stringify(lead, null, 2));

  const botToken = clean(process.env.BOT_TOKEN, 200);
  const chatId = clean(process.env.CHAT_ID, 100);
  if (!/^\d{6,}:[\w-]{30,}$/.test(botToken) || !chatId) return json(res, 202, { ok: true, id, notification: 'pending' });
  const esc = (v) => String(v).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const time = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' }).format(createdAt);
  const lines = ['🦷 <b>Новая заявка с сайта АмирДент</b>', '', `<b>ID:</b> ${esc(id)}`, `<b>Имя:</b> ${esc(name)}`, `<b>Телефон:</b> ${esc(phone)}`];
  if (service) lines.push(`<b>Услуга:</b> ${esc(service)}`);
  lines.push(`<b>Время:</b> ${esc(time)} (МСК)`);
  if (page) lines.push(`<b>Страница:</b> ${esc(page)}`);
  const notification = await sendTelegram(botToken, chatId, lines.join('\n'));
  lead.notification = { status: notification.ok ? 'sent' : 'failed', updatedAt: new Date().toISOString(), ...(notification.ok ? {} : { error: notification.error }) };
  await atomicWrite(leadPath, JSON.stringify(lead, null, 2));
  return json(res, notification.ok ? 200 : 202, { ok: true, id, notification: notification.ok ? 'sent' : 'pending' });
}

async function sendTelegram(token, chatId, text) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(7000),
    });
    return response.ok ? { ok: true } : { ok: false, error: `telegram_${response.status}` };
  } catch (error) { return { ok: false, error: error.name === 'TimeoutError' ? 'telegram_timeout' : 'telegram_network_error' }; }
}

async function handleHealth(req, res, url) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' }, { Allow: 'GET' });
  const expected = clean(process.env.HEALTH_TOKEN, 300);
  if (expected.length < 16) return json(res, 503, { error: 'not_configured' });
  const bearer = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)/i)?.[1] || '';
  const supplied = url.searchParams.get('token') || bearer || req.headers['x-health-token'] || '';
  if (!safeEqual(supplied, expected)) return json(res, 401, { error: 'unauthorized' });
  const checks = {
    contentAvailable: existsSync(CONTENT_FILE),
    notificationsConfigured: !!(process.env.BOT_TOKEN && process.env.CHAT_ID),
    cmsConfigured: !!(process.env.CMS_LOGIN && /^[a-f0-9]{64}$/i.test(process.env.CMS_PASSWORD_HASH || '')),
    storageWritable: await storageWritable(),
  };
  const healthy = Object.values(checks).every(Boolean);
  return json(res, healthy ? 200 : 503, { status: healthy ? 'ok' : 'degraded', checks, at: new Date().toISOString() });
}

async function storageWritable() {
  const probe = join(STORAGE_DIR, `.health-${process.pid}`);
  try { await writeFile(probe, 'ok'); await unlink(probe); return true; } catch { return false; }
}

async function serveContentJson(req, res, publicCache = true) {
  const path = existsSync(CONTENT_FILE) ? CONTENT_FILE : STATIC_CONTENT_FILE;
  if (!existsSync(path)) return json(res, 404, { error: 'not_found' });
  return streamFile(req, res, path, publicCache ? 'public, max-age=300, stale-while-revalidate=86400' : 'no-store');
}

async function streamFile(req, res, path, cache = 'public, max-age=300') {
  const info = await stat(path);
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[extname(path).toLowerCase()] || 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': cache });
  if (req.method === 'HEAD') return res.end();
  createReadStream(path).pipe(res);
}

function staticTarget(pathname) {
  if (pathname === '/') return join(SITE_DIR, 'index.html');
  if (pathname === '/prices') return join(SITE_DIR, 'prices.html');
  if (pathname === '/privacy') return join(SITE_DIR, 'privacy.html');
  if (pathname === '/legal') return join(SITE_DIR, 'legal.html');
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0') || decoded.split('/').some((part) => part.startsWith('.'))) return null;
  const candidate = resolve(SITE_DIR, `.${normalize(decoded)}`);
  if (candidate !== SITE_DIR && !candidate.startsWith(SITE_DIR + sep)) return null;
  return candidate;
}

async function serveStatic(req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'method_not_allowed' }, { Allow: 'GET, HEAD' });
  if (url.pathname === '/index.html') return send(res, 301, '', { Location: '/', 'Cache-Control': 'public, max-age=3600' });
  if (url.pathname === '/prices.html') return send(res, 301, '', { Location: '/prices', 'Cache-Control': 'public, max-age=3600' });
  if (url.pathname === '/service.html') return send(res, 301, '', { Location: '/prices', 'Cache-Control': 'public, max-age=3600' });
  if (url.pathname === '/assets/content.json') return serveContentJson(req, res, true);
  let path = staticTarget(url.pathname);
  if (path) {
    const info = await stat(path).catch(() => null);
    if (info?.isDirectory()) path = join(path, 'index.html');
    if (existsSync(path)) {
      const cache = url.pathname === '/admin.html' ? 'no-store' : (url.pathname.startsWith('/assets/') ? 'public, max-age=604800, stale-while-revalidate=86400' : 'public, max-age=300');
      return streamFile(req, res, path, cache);
    }
  }
  const notFound = join(SITE_DIR, '404.html');
  if (existsSync(notFound)) {
    const body = await readFile(notFound);
    return send(res, 404, body, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  }
  return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
}

async function handler(req, res) {
  try {
    const url = new URL(req.url, requestOrigin(req));
    if (url.pathname === '/api/lead' || url.pathname === '/api/lead.php') return await handleLead(req, res);
    if (url.pathname === '/api/health') return await handleHealth(req, res, url);
    if (url.pathname.startsWith('/api/cms/')) return await handleCms(req, res, url);
    return await serveStatic(req, res, url);
  } catch (error) {
    const status = Number(error.status) || 500;
    if (status >= 500) console.error(error);
    if (!res.headersSent) return json(res, status, { error: status >= 500 ? 'server_error' : error.message });
    res.destroy();
  }
}

const server = http.createServer(handler);
const port = Number(process.env.PORT || 3000);

ensureStorage()
  .then(() => {
    server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`AmirDent Beget server listening on ${port}`));
  })
  .catch((error) => {
    console.error('Failed to initialize AmirDent storage', error);
    process.exitCode = 1;
  });

export { server };
