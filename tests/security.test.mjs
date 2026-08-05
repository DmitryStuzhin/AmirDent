import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('CMS uses HttpOnly cookie sessions and does not expose a bearer hash', async () => {
  const server = await readFile(new URL('netlify/functions/cms.mjs', root), 'utf8');
  const client = await readFile(new URL('site/assets/cms-auth.js', root), 'utf8');
  assert.match(server, /HttpOnly; Secure; SameSite=Strict/);
  assert.match(server, /LOGIN_MAX_ATTEMPTS/);
  assert.doesNotMatch(client, /subtle\.digest|X-CMS-Token/);
  // sessionStorage допустим только как флаг режима правки, не как хранилище токена
  assert.match(client, /amirdent_cms_edit/);
  assert.doesNotMatch(client, /sessionStorage\.setItem\([^)]*token/i);
});

test('Lead endpoint stores first, requires consent and rate limits abuse', async () => {
  const lead = await readFile(new URL('netlify/functions/lead.mjs', root), 'utf8');
  const cms = await readFile(new URL('netlify/functions/cms.mjs', root), 'utf8');
  assert.match(lead, /consent_required/);
  assert.match(lead, /RATE_MAX/);
  assert.match(lead, /store\.setJSON\(`leads\//);
  assert.doesNotMatch(lead, /телефон: \$\{phone\}/i);
  // B12: заявки из blobs доступны админу
  assert.match(cms, /\/api\/cms\/leads|'\/api\/cms\/leads'|endsWith\('\/leads'\)/);
});

test('Netlify config has baseline security headers and no service soft-404 rewrite', async () => {
  const config = await readFile(new URL('netlify.toml', root), 'utf8');
  assert.match(config, /Content-Security-Policy/);
  assert.match(config, /X-Content-Type-Options/);
  assert.doesNotMatch(config, /from = "\/uslugi\/\*"/);
  // B4: посетители не ходят в функцию за content.json
  assert.doesNotMatch(config, /from = "\/assets\/content\.json"/);
  assert.match(config, /\/assets\/content\.json/);
});

test('Public pages load cms only via cms-boot (not cms.js directly)', async () => {
  const index = await readFile(new URL('site/index.html', root), 'utf8');
  const service = await readFile(new URL('site/service.html', root), 'utf8');
  const boot = await readFile(new URL('site/assets/cms-boot.js', root), 'utf8');
  assert.match(index, /cms-boot\.js/);
  assert.match(service, /cms-boot\.js/);
  assert.doesNotMatch(index, /cms\.js\?/);
  assert.doesNotMatch(service, /cms\.js\?/);
  assert.match(boot, /amirdent_cms_edit/);
  assert.match(boot, /cms\.js/);
  // Правка только после login: ?edit=1 не открывает CMS
  assert.doesNotMatch(boot, /qsHas\(['"]edit['"]/);
  assert.match(boot, /refreshSession/);
});

test('Admin login page always requires password (no cookie auto-redirect)', async () => {
  const admin = await readFile(new URL('site/admin.html', root), 'utf8');
  assert.doesNotMatch(admin, /refreshSession\(\)\.then/);
  assert.match(admin, /logout/);
  assert.match(admin, /AmirCMS\.login/);
});

test('Public nav uses canonical / and /prices (no redirect hops)', async () => {
  const index = await readFile(new URL('site/index.html', root), 'utf8');
  const service = await readFile(new URL('site/service.html', root), 'utf8');
  assert.match(index, /href="\/"[^>]*>[\s\S]*?Амир/);
  assert.match(index, /href="\/"[^>]*>Главная/);
  assert.doesNotMatch(index, /href="index\.html"/);
  assert.doesNotMatch(index, /href="\/prices\.html"/);
  assert.match(index, /href="\/prices"/);
  assert.match(service, /href="\/prices"/);
  assert.doesNotMatch(service, /href="\/prices\.html"/);
});

test('Every video review card opens the clinic Telegram channel', async () => {
  const index = await readFile(new URL('site/index.html', root), 'utf8');
  const cards = index.match(
    /<a class="reel"[^>]*href="https:\/\/t\.me\/kmcorthoway"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/g
  );
  assert.equal(cards?.length, 5);
  assert.match(index, /<section class="pad" id="reels">/);
  assert.doesNotMatch(index, /<button class="reel"/);
});

test('Maintenance purges expired CMS sessions from blobs', async () => {
  const maintenance = await readFile(new URL('netlify/functions/maintenance.mjs', root), 'utf8');
  assert.match(maintenance, /prefix:\s*['"]sessions\//);
  assert.match(maintenance, /expiresAt/);
  assert.match(maintenance, /\.delete\(/);
  assert.match(maintenance, /purgeExpiredSessions|sessions scanned/);
});

test('Health endpoint requires HEALTH_TOKEN and does not leak checks anonymously', async () => {
  const health = await readFile(new URL('netlify/functions/health.mjs', root), 'utf8');
  assert.match(health, /HEALTH_TOKEN/);
  assert.match(health, /unauthorized/);
  assert.match(health, /timingSafeEqual/);
  assert.match(health, /Bearer|x-health-token|searchParams\.get\('token'\)/);
});
