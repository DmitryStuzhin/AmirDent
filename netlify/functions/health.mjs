import { getStore } from '@netlify/blobs';

export default async (request) => {
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', Allow: 'GET' },
    });
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

  return new Response(
    JSON.stringify({
      status: healthy ? 'ok' : 'degraded',
      checks: { contentAvailable, notificationsConfigured, cmsConfigured },
      at: new Date().toISOString(),
    }),
    {
      status: healthy ? 200 : 503,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    }
  );
};

export const config = { path: '/api/health' };
