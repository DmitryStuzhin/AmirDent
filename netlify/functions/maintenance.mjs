// Daily CMS backup + garbage collection for expired admin sessions.
// Scheduled invocations are managed by Netlify (`@daily`).
import { getStore } from '@netlify/blobs';

async function purgeExpiredSessions(store) {
  const listed = await store.list({ prefix: 'sessions/' });
  const keys = (listed.blobs || []).map((blob) => blob.key);
  const ts = Date.now();
  let removed = 0;

  for (const key of keys) {
    let session = null;
    try {
      session = await store.get(key, { type: 'json', consistency: 'strong' });
    } catch (err) {
      console.warn(`maintenance: failed to read ${key}`, err && err.message ? err.message : err);
      continue;
    }
    // Нет тела / нет expiresAt / срок вышел — мусор
    if (!session || typeof session !== 'object' || !session.expiresAt || Number(session.expiresAt) <= ts) {
      try {
        await store.delete(key);
        removed += 1;
      } catch (err) {
        console.warn(`maintenance: failed to delete ${key}`, err && err.message ? err.message : err);
      }
    }
  }

  return { scanned: keys.length, removed };
}

export default async () => {
  const store = getStore('cms');

  const sessions = await purgeExpiredSessions(store);
  console.log(`maintenance: sessions scanned=${sessions.scanned} removed=${sessions.removed}`);

  const content = await store.get('content', { type: 'json', consistency: 'strong' });
  if (!content) {
    console.error('maintenance: CMS content is missing');
    return new Response('content_missing', { status: 503 });
  }

  const date = new Date().toISOString().slice(0, 10);
  await getStore('cms-backups').setJSON(`daily/${date}`, {
    backedUpAt: new Date().toISOString(),
    content,
  });
  console.log(`maintenance: CMS backup ${date} created`);
  return new Response('ok');
};

export const config = { schedule: '@daily' };
