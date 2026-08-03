import { readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const siteDir = resolve(root, 'site');
const contentPath = resolve(siteDir, 'assets/content.json');
const pricesPath = resolve(siteDir, 'prices.html');
const indexPath = resolve(siteDir, 'index.html');

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function isContentSnap(data) {
  return (
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    !!(data.services || data.textItems || data.doctors || data.priceHtml)
  );
}

async function readLocalContent() {
  try {
    return JSON.parse(await readFile(contentPath, 'utf8'));
  } catch (e) {
    return null;
  }
}

/** Подтянуть живой контент из blobs/API в статику перед публикацией. */
async function syncContentFromApi() {
  // 1) Netlify Blobs напрямую (надёжнее, чем HTTP к ещё не залитому деплою)
  if (process.env.NETLIFY || process.env.NETLIFY_BLOBS_CONTEXT) {
    try {
      const { getStore } = await import('@netlify/blobs');
      const store = getStore('cms');
      const data = await store.get('content', { type: 'json', consistency: 'strong' });
      if (isContentSnap(data)) {
        await writeFile(contentPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
        console.log('Synced content.json from Netlify Blobs');
        return data;
      }
    } catch (e) {
      console.warn('blobs content sync skip:', e && e.message ? e.message : e);
    }
  }

  // 2) HTTP fallback (прошлый прод / явный CMS_CONTENT_URL)
  const candidates = [
    process.env.CMS_CONTENT_URL,
    process.env.URL && `${String(process.env.URL).replace(/\/+$/, '')}/api/cms/content`,
  ].filter(Boolean);

  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) continue;
      const data = await res.json();
      if (!isContentSnap(data)) continue;
      await writeFile(contentPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
      console.log(`Synced content.json from ${url}`);
      return data;
    } catch (e) {
      console.warn(`content sync skip (${url}):`, e && e.message ? e.message : e);
    }
  }
  return readLocalContent();
}

function servicesToPriceHtml(services) {
  if (!Array.isArray(services)) return '';
  const esc = (t) =>
    String(t)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  return services
    .filter((s) => s && typeof s === 'object')
    .map((s) => {
      const name = String(s.name || 'Услуга');
      const tag = String(s.tag || '');
      const price = String(s.price || '');
      const cat = String(s.cat || 'therapy');
      const subcat = String(s.subcat || '');
      const doctor = String(s.doctor || '');
      let attrs = ` data-cat="${esc(cat)}" data-name="${esc(name.toLowerCase())}"`;
      if (subcat) attrs += ` data-subcat="${esc(subcat)}"`;
      if (doctor) attrs += ` data-doctor="${esc(doctor)}"`;
      return `<div class="prow"${attrs}><span class="pn">${esc(name)}</span><span class="ptag">${esc(tag)}</span><span class="pp">${esc(price)}</span></div>`;
    })
    .join('\n');
}

async function syncPricesData(content) {
  if (!content || typeof content !== 'object') return;
  let services = Array.isArray(content.services) ? content.services : [];
  if (!services.length && typeof content.priceHtml === 'string' && content.priceHtml.trim()) {
    // Legacy: распарсить HTML-снимок в массив не требуется — оставляем файл как есть
    return;
  }
  if (!services.length) {
    try {
      const prev = JSON.parse(await readFile(resolve(siteDir, 'assets/prices.json'), 'utf8'));
      if (Array.isArray(prev.services) && prev.services.length) services = prev.services;
    } catch {
      /* нет предыдущего файла */
    }
  }
  if (!services.length) return;

  const pricesJsonPath = resolve(siteDir, 'assets/prices.json');
  await writeFile(pricesJsonPath, `${JSON.stringify({ v: 1, services })}\n`, 'utf8');

  // prices.html — оболочка без 100+ КБ строк; список грузит main.js из prices.json
  let html = await readFile(pricesPath, 'utf8');
  const marker = 'class="price-list"';
  const start = html.indexOf(marker);
  if (start < 0) return;
  const openEnd = html.indexOf('>', start);
  if (openEnd < 0) return;
  const innerStart = openEnd + 1;
  let emptyPos = html.indexOf('<div class="price-empty"', innerStart);
  if (emptyPos < 0) emptyPos = html.indexOf('</div>', innerStart);
  if (emptyPos < 0) return;
  const openTag = html.slice(html.lastIndexOf('<', start), openEnd + 1);
  const withSrc = /data-prices-src=/.test(openTag)
    ? openTag
    : openTag.replace(
        'class="price-list"',
        'class="price-list" data-prices-src="/assets/prices.json"'
      );
  html =
    html.slice(0, html.lastIndexOf('<', start)) +
    withSrc +
    '\n      <!-- прайс подгружается из /assets/prices.json (main.js) -->\n      ' +
    html.slice(emptyPos);
  await writeFile(pricesPath, html, 'utf8');
  console.log(`Synced prices.json (${services.length} services); prices.html kept as shell`);
}

function escapeAttr(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

function replaceDocGrid(html, innerHtml, docsV) {
  const start = html.indexOf('<div class="doc-grid"');
  if (start < 0) return null;
  const openEnd = html.indexOf('>', start);
  if (openEnd < 0) return null;
  // Ищем парный </div> по глубине — внутри карточек много вложенных div
  let depth = 1;
  let i = openEnd + 1;
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf('<div', i);
    const nextClose = html.indexOf('</div>', i);
    if (nextClose < 0) return null;
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1;
      i = nextOpen + 4;
    } else {
      depth -= 1;
      if (depth === 0) {
        return (
          html.slice(0, start) +
          `<div class="doc-grid" data-docs-v="${docsV}">\n      ${innerHtml}\n    </div>` +
          html.slice(nextClose + '</div>'.length)
        );
      }
      i = nextClose + 6;
    }
  }
  return null;
}

/** Вшить карточки врачей из content.json в .doc-grid (без cms.js у посетителя). */
async function bakeIndexDoctors(content) {
  if (!content || !Array.isArray(content.doctors) || !content.doctors.length) return;
  let html = await readFile(indexPath, 'utf8');
  const docsV = Math.max(parseInt(content.docsV, 10) || 0, 7);
  const list = content.doctors.filter((d) => d && d.id && d.id !== 'massud' && !d.cardHidden);
  const cards = list
    .map((d) => {
      const src = escapeAttr(d.src || d.photo || '');
      const name = escapeAttr(d.name || 'Врач');
      const role = escapeAttr(d.role || '');
      const exp = escapeAttr(d.exp || '');
      const id = escapeAttr(d.id);
      return (
        `<article class="doc reveal" data-doc="${id}">` +
        `<div class="doc-photo"><img src="${src}" alt="${name}" loading="lazy" decoding="async"></div>` +
        `<div class="doc-body"><div class="role">${role}</div><h3>${name}</h3><div class="exp">${exp}</div></div>` +
        `</article>`
      );
    })
    .join('\n      ');

  const next = replaceDocGrid(html, cards, docsV);
  if (!next) {
    console.warn('bakeIndexDoctors: doc-grid not found/replaced');
    return;
  }
  await writeFile(indexPath, next, 'utf8');
  console.log(`Baked ${list.length} doctors into index.html`);
}

/** Показать/скрыть #reels и проставить data-video из content.json. */
async function bakeIndexReels(content) {
  let html = await readFile(indexPath, 'utf8');
  const reels = Array.isArray(content && content.reels) ? content.reels : [];
  const hasVideo = reels.some((r) => r && String(r.video || '').trim());

  html = html.replace(
    /<section class="pad" id="reels"[^>]*>/,
    hasVideo ? '<section class="pad" id="reels">' : '<section class="pad" id="reels" hidden>'
  );

  let i = 0;
  html = html.replace(/<button class="reel" data-video="[^"]*"(?:\s+hidden)?/g, () => {
    const item = reels[i++] || {};
    const video = escapeHtml(String(item.video || '').trim());
    return video
      ? `<button class="reel" data-video="${video}"`
      : `<button class="reel" data-video="" hidden`;
  });

  await writeFile(indexPath, html, 'utf8');
  console.log(hasVideo ? 'Baked reels with videos into index.html' : 'Reels section kept hidden (no videos)');
}

/** Вшить textItems с data-cms-text в index.html — без cms.js у посетителя. */
async function bakeIndexTextItems(content) {
  if (!content || !Array.isArray(content.textItems)) return;
  let html = await readFile(indexPath, 'utf8');
  let changed = 0;
  for (const item of content.textItems) {
    const sel = item && item.sel;
    if (!sel || typeof item.html !== 'string') continue;
    const m = /^\[data-cms-text="([^"]+)"\]$/.exec(sel);
    if (!m) continue;
    const key = m[1];
    const re = new RegExp(
      `(<(?:h[1-6]|p|div|span|small|b|li)[^>]*\\bdata-cms-text="${key}"[^>]*>)([\\s\\S]*?)(</(?:h[1-6]|p|div|span|small|b|li)>)`,
      'i'
    );
    if (!re.test(html)) continue;
    html = html.replace(re, `$1${item.html}$3`);
    changed += 1;
  }
  if (changed) {
    await writeFile(indexPath, html, 'utf8');
    console.log(`Baked ${changed} data-cms-text items into index.html`);
  }
}

const content = await syncContentFromApi();
await syncPricesData(content);
await bakeIndexTextItems(content);
await bakeIndexDoctors(content);
await bakeIndexReels(content);

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

// Страницы строим для всех услуг со slug — в т.ч. косметология без match в прайсе
const services = catalog.groups.flatMap((group) =>
  (group.items || [])
    .filter((item) => item && item.slug && item.title)
    .map((item) => ({ ...item, group: group.title }))
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

  const bodyTitle = escapeHtml(service.title);
  const bodyDesc = escapeHtml(service.desc || description);
  const bodyGroup = escapeHtml(service.group || 'Услуги');

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
  html = html
    .replace(
      '<span class="crumbs-now" id="dirCrumb">Услуга</span>',
      `<span class="crumbs-now" id="dirCrumb">${bodyTitle}</span>`
    )
    .replace(
      '<span class="eyebrow" id="dirGroup"><span class="dot"></span>Направление</span>',
      `<span class="eyebrow" id="dirGroup"><span class="dot"></span>${bodyGroup}</span>`
    )
    .replace('<h1 id="dirTitle">Услуга</h1>', `<h1 id="dirTitle">${bodyTitle}</h1>`)
    .replace('<p class="dp-desc" id="dirDesc"></p>', `<p class="dp-desc" id="dirDesc">${bodyDesc}</p>`);
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
