import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('CMS uses HttpOnly cookie sessions and does not expose a bearer hash', async () => {
  const server = await readFile(new URL('netlify/functions/cms.mjs', root), 'utf8');
  const client = await readFile(new URL('site/assets/cms-auth.js', root), 'utf8');
  assert.match(server, /HttpOnly; Secure; SameSite=Strict/);
  assert.match(server, /LOGIN_MAX_ATTEMPTS/);
  assert.doesNotMatch(client, /subtle\.digest|X-CMS-Token|sessionStorage/);
});

test('Lead endpoint stores first, requires consent and rate limits abuse', async () => {
  const lead = await readFile(new URL('netlify/functions/lead.mjs', root), 'utf8');
  assert.match(lead, /consent_required/);
  assert.match(lead, /RATE_MAX/);
  assert.match(lead, /store\.setJSON\(`leads\//);
  assert.doesNotMatch(lead, /телефон: \$\{phone\}/i);
});

test('Netlify config has baseline security headers and no service soft-404 rewrite', async () => {
  const config = await readFile(new URL('netlify.toml', root), 'utf8');
  assert.match(config, /Content-Security-Policy/);
  assert.match(config, /X-Content-Type-Options/);
  assert.doesNotMatch(config, /from = "\/uslugi\/\*"/);
});
