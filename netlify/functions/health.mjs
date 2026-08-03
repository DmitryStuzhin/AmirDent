import { getStore } from '@netlify/blobs';
import { timingSafeEqual } from 'node:crypto';

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
  });

function sameSecret(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  return aa.length === bb.length && aa.length > 0 && timingSafeEqual(aa, bb);
}

function requestToken(request) {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get('token');
  if (fromQuery) return fromQuery;
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.match(/^Bearer\s+(\S+)/i);
  if (bearer) return bearer[1];
  return request.headers.get('x-health-token') || '';
}

export default async (request) => {
  if (request.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }

  const expected = String(process.env.HEALTH_TOKEN || '').trim();
  if (!expected || expected.length < 16) {
    return json(
      {
        error: 'not_configured',
        message: 'Задайте HEALTH_TOKEN (не короче 16 символов) в переменных окружения',
      },
      503
    );
  }

  if (!sameSecret(requestToken(request), expected)) {
    return json({ error: 'unauthorized' }, 401);
  }

  let contentAvailable = false;
  try {
    contentAvailable = !!(await getStore('cms').get('content', { type: 'json', consistency: 'strong' }));
  } catch (error) {
    console.error('health: CMS storage check failed', error);
  }
  const notificationsConfigured = !!(process.env.BOT_TOKEN && process.env.CHAT_ID);
  const cmsConfigured = !!(process.env.CMS_LOGIN && process.env.CMS_PASSWORD_HASH);
  const healthy = contentAvailable && notificationsConfigured && cmsConfigured;

  return json(
    {
      status: healthy ? 'ok' : 'degraded',
      checks: { contentAvailable, notificationsConfigured, cmsConfigured },
      at: new Date().toISOString(),
    },
    healthy ? 200 : 503
  );
};

export const config = { path: '/api/health' };
