// Daily independent CMS snapshot. Scheduled invocations are managed by Netlify.
import { getStore } from '@netlify/blobs';

export default async () => {
  const content = await getStore('cms').get('content', { type: 'json', consistency: 'strong' });
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
