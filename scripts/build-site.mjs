import { readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const siteDir = resolve(root, 'site');
const source = await readFile(resolve(siteDir, 'assets/services-data.js'), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox, { filename: 'services-data.js' });
const catalog = sandbox.window.AMIR_SERVICES;
if (!catalog || !Array.isArray(catalog.groups)) throw new Error('Service catalog is invalid');

const baseUrl = String(process.env.SITE_URL || process.env.URL || 'https://amirdent.netlify.app').replace(/\/+$/, '');
const template = await readFile(resolve(siteDir, 'service.html'), 'utf8');
const outputDir = resolve(siteDir, 'uslugi');
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const services = catalog.groups.flatMap((group) =>
  group.items.filter((item) => item.match).map((item) => ({ ...item, group: group.title }))
);

for (const service of services) {
  const title = `${service.title} — цены и запись | АмирДент`;
  const description = String(service.desc || `${service.title} в клинике АмирДент в Москве.`).slice(0, 190);
  const url = `${baseUrl}/uslugi/${service.slug}/`;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: service.title,
    description,
    url,
    provider: {
      '@type': 'Dentist',
      name: 'АмирДент',
      telephone: '+7-926-203-18-28',
      address: {
        '@type': 'PostalAddress',
        streetAddress: 'Дмитровское шоссе, 96, корпус 5',
        addressLocality: 'Москва',
        postalCode: '127247',
        addressCountry: 'RU',
      },
    },
  };

  let html = template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(
      /<meta name="description" content="[^"]*">/,
      `<meta name="description" content="${escapeHtml(description)}">`
    )
    .replace(
      /<meta property="og:title" content="[^"]*">/,
      `<meta property="og:title" content="${escapeHtml(title)}">`
    )
    .replace(
      /<meta property="og:description" content="[^"]*">/,
      `<meta property="og:description" content="${escapeHtml(description)}">`
    )
    .replace(
      '<meta property="og:type" content="website">',
      `<meta property="og:type" content="website">\n<meta property="og:url" content="${escapeHtml(
        url
      )}">\n<link rel="canonical" href="${escapeHtml(url)}">\n<script type="application/ld+json">${JSON.stringify(
        schema
      ).replace(/</g, '\\u003c')}</script>`
    );
  html = html.replace('<body>', `<body data-service-slug="${escapeHtml(service.slug)}">`);

  const dir = resolve(outputDir, service.slug);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, 'index.html'), html);
}

const today = new Date().toISOString().slice(0, 10);
const sitemapUrls = [
  { path: '/', priority: '1.0' },
  { path: '/prices', priority: '0.8' },
  { path: '/privacy', priority: '0.2' },
  { path: '/legal', priority: '0.2' },
  ...services.map((service) => ({ path: `/uslugi/${service.slug}/`, priority: '0.8' })),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls
  .map(
    ({ path, priority }) => `  <url>
    <loc>${escapeHtml(baseUrl + path)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>${priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>
`;
await writeFile(resolve(siteDir, 'sitemap.xml'), sitemap);
await writeFile(
  resolve(siteDir, 'robots.txt'),
  `User-agent: *\nAllow: /\nDisallow: /admin.html\nDisallow: /api/cms/\n\nSitemap: ${baseUrl}/sitemap.xml\n`
);

console.log(`Generated ${services.length} service pages for ${baseUrl}`);
