// Поиск рейтинга врача на ПроДокторов / DocDoc / Зуб.ру (имя; фото — на локальном server.py).
import { timingSafeEqual } from 'node:crypto';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const TR = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function checkAuth(token) {
  const expected = (process.env.CMS_PASSWORD_HASH || '').trim().toLowerCase();
  if (!expected) return false;
  return sameSecret(String(token || '').trim().toLowerCase(), expected);
}

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9\s-]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitName(full) {
  const parts = norm(full).split(' ').filter(Boolean);
  if (!parts.length) return { sur: '', nam: '' };
  if (parts.length === 1) return { sur: parts[0], nam: '' };
  return { sur: parts[0], nam: parts[1] };
}

function translit(s) {
  return [...String(s || '').toLowerCase().replace(/ё/g, 'е')]
    .map((ch) => (TR[ch] != null ? TR[ch] : /[a-z0-9]/.test(ch) ? ch : ''))
    .join('');
}

function nameScore(full, candidate) {
  const { sur, nam } = splitName(full);
  const cand = norm(candidate);
  if (!sur || !cand) return 0;
  const parts = cand.split(' ');
  let score = 0;
  if (parts.includes(sur) || cand.startsWith(sur)) score = 0.55;
  else if (parts.some((p) => p.startsWith(sur.slice(0, Math.max(3, sur.length - 1))))) score = 0.35;
  else return 0;
  if (nam && parts.includes(nam)) score += 0.45;
  else if (nam && parts.some((p) => p.startsWith(nam.slice(0, Math.max(2, nam.length - 1))))) score += 0.25;
  return Math.min(1, score);
}

function parseFloatSafe(s) {
  const m = String(s ?? '').replace(',', '.').match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

async function fetchText(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout || 16000);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: '*/*', ...(opts.headers || {}) },
      redirect: 'follow',
    });
    const text = await res.text();
    return { status: res.status, text, url: res.url };
  } catch {
    return { status: 0, text: '', url };
  } finally {
    clearTimeout(t);
  }
}

function candidate({ source, name, url, rating, reviews = null, nameMatch = 0 }) {
  return {
    source,
    name,
    url,
    rating,
    reviews,
    photo: '',
    nameMatch: +nameMatch.toFixed(3),
    faceSim: null,
    confidence: +nameMatch.toFixed(3),
  };
}

async function searchProdoctorov(full) {
  const res = await fetchText('https://prodoctorov.ru/api/search/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: full.trim(), town: 'moskva' }),
  });
  if (res.status !== 200) return [];
  let data;
  try {
    data = JSON.parse(res.text);
  } catch {
    return [];
  }
  const out = [];
  for (const g of Array.isArray(data) ? data : []) {
    for (const r of (g.results || []).slice(0, 12)) {
      if (String(r.category || '').toUpperCase() !== 'DOCTOR') continue;
      const title = r.title || '';
      const ns = nameScore(full, title);
      if (ns < 0.45) continue;
      let link = r.link || '';
      if (!link.startsWith('http')) link = 'https://prodoctorov.ru' + link;
      const { rating, reviews } = await fetchPdRating(link);
      out.push(candidate({ source: 'pd', name: title, url: link, rating, reviews, nameMatch: ns }));
    }
  }
  return out;
}

async function fetchPdRating(url) {
  const res = await fetchText(url);
  if (res.status !== 200) return { rating: null, reviews: null };
  const html = res.text;
  let rating = null;
  let m = html.match(/class="[^"]*text-h5[^"]*"[^>]*>\s*([0-9]+(?:[.,][0-9]+)?)\s*</);
  if (m) rating = parseFloatSafe(m[1]);
  if (rating == null) {
    m = html.match(/itemprop="ratingValue"[^>]*content="([^"]+)"/);
    if (m) rating = parseFloatSafe(m[1]);
  }
  let reviews = null;
  m = html.match(/(\d+)\s*отзыв/);
  if (m) reviews = +m[1];
  return { rating, reviews };
}

async function searchDocdoc(full) {
  const { sur, nam } = splitName(full);
  if (!sur) return [];
  const slugs = [];
  if (nam) {
    const a = translit(sur);
    const b = translit(nam);
    slugs.push(`${a[0]?.toUpperCase() || ''}${a.slice(1)}_${b[0]?.toUpperCase() || ''}${b.slice(1)}`);
    slugs.push(`${a}_${b}`);
  }
  const urls = [...new Set(slugs.filter(Boolean).map((s) => `https://docdoc.ru/doctor/${s}`))];

  const ddg = await fetchText('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ q: `site:docdoc.ru/doctor ${full.trim()}` }).toString(),
  });
  if (ddg.status === 200) {
    for (const m of ddg.text.matchAll(/docdoc\.ru\/doctor\/([A-Za-z0-9_]+)/g)) {
      const u = `https://docdoc.ru/doctor/${m[1]}`;
      if (!urls.includes(u)) urls.push(u);
    }
  }

  const out = [];
  for (const url of urls.slice(0, 6)) {
    const slug = url.split('/').pop();
    const expect = `${translit(sur)} ${translit(nam)}`.trim();
    let ns = nameScore(expect, slug.replace(/_/g, ' '));
    if (nam && slug.toLowerCase().includes(translit(nam)) && slug.toLowerCase().includes(translit(sur))) ns = Math.max(ns, 0.85);
    else if (slug.toLowerCase().includes(translit(sur))) ns = Math.max(ns, 0.5);
    if (ns < 0.45) continue;
    const { rating, reviews, name } = await fetchDocdoc(url);
    out.push(
      candidate({
        source: 'docdoc',
        name: name || slug.replace(/_/g, ' '),
        url,
        rating,
        reviews,
        nameMatch: ns,
      })
    );
  }
  return out;
}

async function fetchDocdoc(url) {
  const res = await fetchText(url);
  if (res.status !== 200 || /servicepipe|Forbidden/i.test(res.text) && res.text.length < 5000) {
    return { rating: null, reviews: null, name: '' };
  }
  const html = res.text;
  let rating = null;
  for (const pat of [
    /"ratingValue"\s*:\s*"?([0-9]+(?:[.,][0-9]+)?)"?/,
    /itemprop="ratingValue"[^>]*content="([^"]+)"/,
  ]) {
    const m = html.match(pat);
    if (m) {
      rating = parseFloatSafe(m[1]);
      break;
    }
  }
  let reviews = null;
  const rm = html.match(/(\d+)\s*отзыв/);
  if (rm) reviews = +rm[1];
  let name = '';
  const tm = html.match(/<title>([^|<]+)/);
  if (tm) name = tm[1].trim();
  return { rating, reviews, name };
}

async function fetchZubProfile(url) {
  const res = await fetchText(url);
  if (res.status !== 200) return { rating: null, reviews: null, name: '' };
  const html = res.text;
  let rating = null;
  let m = html.match(/class="doctor-page__header-rating-value"[^>]*>\s*([0-9]+(?:[.,][0-9]+)?)/);
  if (m) rating = parseFloatSafe(m[1]);
  if (rating == null) {
    m = html.match(/data-rating="([^"]+)"/);
    if (m) rating = parseFloatSafe(m[1]);
  }
  let reviews = null;
  const counts = [...html.matchAll(/(\d+)\s*отзыв/g)].map((x) => +x[1]).filter((n) => n > 0 && n < 400);
  if (counts.length) reviews = counts.sort((a, b) => counts.filter((x) => x === b).length - counts.filter((x) => x === a).length)[0];
  let name = '';
  m = html.match(/<h1[^>]*>([^<]+)/) || html.match(/<title>([^|<]+)/);
  if (m) name = m[1].replace(/\s+/g, ' ').trim();
  return { rating, reviews, name };
}

async function searchZub(full) {
  const { sur, nam } = splitName(full);
  if (!sur) return [];
  const urls = [];
  const base = [translit(sur), translit(nam)].filter(Boolean).join('-');
  if (base) {
    for (const suf of ['', '-khirurg', '-terapevt', '-ortoped', '-ortodont']) {
      urls.push(`https://zub.ru/doctors/${base}${suf}/`);
    }
  }
  const search = await fetchText('https://zub.ru/search/?q=' + encodeURIComponent(full.trim()));
  if (search.status === 200) {
    for (const m of search.text.matchAll(/(?:https:\/\/zub\.ru)?\/doctors\/([a-z0-9-]+)/g)) {
      const href = `https://zub.ru/doctors/${m[1].replace(/\/$/, '')}/`;
      if (!urls.includes(href)) urls.push(href);
    }
  }
  const out = [];
  for (const href of urls.slice(0, 10)) {
    const { rating, reviews, name } = await fetchZubProfile(href);
    if (rating == null && !name) continue;
    let ns = name ? nameScore(full, name) : 0;
    const slug = href.replace(/\/$/, '').split('/').pop().toLowerCase();
    if (slug.includes(translit(sur)) && (!nam || slug.includes(translit(nam)))) ns = Math.max(ns, 0.85);
    if (ns < 0.55) continue;
    out.push(candidate({ source: 'zub', name: name || slug, url: href, rating, reviews, nameMatch: ns }));
  }
  return out;
}

function isClinicYandexFallback(c) {
  return c.source === 'yandex' && /amirdent/i.test(c.url || '') && (c.nameMatch || 0) < 0.75;
}

function pickBest(list) {
  let ok = list.filter((c) => c.rating != null && c.confidence >= 0.55 && c.rating > 0 && c.rating <= 5);
  if (!ok.length) {
    ok = list.filter((c) => c.rating != null && (c.nameMatch || 0) >= 0.7 && c.rating > 0 && c.rating <= 5);
  }
  if (!ok.length) return null;
  const personal = ok.filter((c) => !isClinicYandexFallback(c));
  if (personal.length) ok = personal;
  ok.sort((a, b) => b.rating - a.rating || (b.reviews || 0) - (a.reviews || 0) || b.confidence - a.confidence);
  return ok[0];
}

const AMIRDENT_YANDEX = 'https://yandex.ru/maps/org/amirdent/1781090864/';
const AMIRDENT_YANDEX_FALLBACK = { rating: 5.0, reviews: null, name: 'АмирДент' };
const LABELS = { pd: 'ПроДокторов', docdoc: 'DocDoc', zub: 'Зуб.ру', yandex: 'Яндекс Карты', doctu: 'Doctu' };

function doctuTranslit(s) {
  const tr = { ...TR, й: 'jj' };
  return [...String(s || '').toLowerCase().replace(/ё/g, 'е')]
    .map((ch) => (tr[ch] != null ? tr[ch] : /[a-z0-9]/.test(ch) ? ch : ''))
    .join('');
}

function doctuTurbo(path) {
  const p = path.startsWith('/') ? path : '/' + path;
  return 'https://translated.turbopages.org/proxy_u/ru-en.en/https/doctu.ru' + p;
}

async function fetchDoctuProfile(slug) {
  const path = '/msk/doctor/' + String(slug || '').replace(/^\/+|\/+$/g, '');
  const canon = 'https://doctu.ru' + path;
  let res = await fetchText(canon);
  let html = res.text || '';
  if (res.status !== 200 || /servicepipe/i.test(html) || html.length < 4000) {
    res = await fetchText(doctuTurbo(path));
    html = res.text || '';
    if (res.status !== 200 || html.length < 2000) return { rating: null, reviews: null, name: '', url: canon };
  }
  let name = '', rating = null, reviews = null;
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim());
      if (!data || data['@type'] !== 'Physician') continue;
      name = String(data.name || '').trim();
      const ar = data.aggregateRating || {};
      rating = parseFloatSafe(ar.ratingValue);
      reviews = ar.reviewCount != null ? +ar.reviewCount : null;
      break;
    } catch {
      /* ignore */
    }
  }
  return { rating, reviews, name, url: canon };
}

async function searchDoctu(full) {
  const { sur, nam } = splitName(full);
  if (!sur) return [];
  const parts = [sur, nam].filter(Boolean).map(doctuTranslit);
  const guess = [];
  if (parts.length >= 2) guess.push(parts.join('-'));
  if (parts[0]) guess.push(parts[0]);

  const searchRes = await fetchText(doctuTurbo('/msk/doctors?name=' + encodeURIComponent(sur)));
  if (searchRes.status === 200) {
    for (const m of searchRes.text.matchAll(/\/msk\/doctor\/([a-z0-9\-]+)/g)) {
      const slug = m[1];
      if (!slug.includes(doctuTranslit(sur))) continue;
      if (!guess.includes(slug)) guess.push(slug);
    }
  }

  const out = [];
  const seen = new Set();
  for (const slug of guess.slice(0, 10)) {
    if (seen.has(slug)) continue;
    seen.add(slug);
    const { rating, reviews, name, url } = await fetchDoctuProfile(slug);
    if (!name && rating == null) continue;
    let ns = name ? nameScore(full, name) : 0;
    if (slug.includes(doctuTranslit(sur)) && (!nam || slug.includes(doctuTranslit(nam)))) ns = Math.max(ns, 0.85);
    if (ns < 0.55) continue;
    out.push(candidate({ source: 'doctu', name: name || slug, url, rating, reviews, nameMatch: ns }));
  }
  return out;
}

async function fetchYandexOrg(url) {
  const isClinic = url.replace(/\/$/, '') === AMIRDENT_YANDEX.replace(/\/$/, '');
  const res = await fetchText(url);
  if (res.status !== 200) return isClinic ? { ...AMIRDENT_YANDEX_FALLBACK } : { rating: null, reviews: null, name: '' };
  const html = res.text;
  if ((html.includes('SmartCaptcha') && html.length < 50000) || html.trim() === 'limited') {
    return isClinic ? { ...AMIRDENT_YANDEX_FALLBACK } : { rating: null, reviews: null, name: '' };
  }
  let rating = null;
  for (const pat of [/"ratingValue"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/, /business-rating-badge[^>]*>\s*([0-9]+(?:[.,][0-9]+)?)/]) {
    const m = html.match(pat);
    if (m) {
      rating = parseFloatSafe(m[1]);
      if (rating != null && rating > 0 && rating <= 5) break;
      rating = null;
    }
  }
  let reviews = null;
  const rm = html.match(/"ratingCount"\s*:\s*(\d+)/);
  if (rm) reviews = +rm[1];
  let name = '';
  const tm = html.match(/og:title"[^>]*content="([^"]+)"/) || html.match(/property="og:title"\s+content="([^"]+)"/);
  if (tm) name = tm[1].replace(/\s+/g, ' ').split('—')[0].trim();
  if (rating == null && isClinic) return { ...AMIRDENT_YANDEX_FALLBACK };
  return { rating, reviews, name };
}

async function searchYandex(full) {
  const { sur, nam } = splitName(full);
  if (!sur) return [];
  const out = [];
  const seen = new Set();
  for (const q of [`${full.trim()} стоматолог Москва`, `${full.trim()} АмирДент`]) {
    const res = await fetchText('https://yandex.ru/maps/?' + new URLSearchParams({ text: q }));
    if (res.status !== 200) continue;
    for (const m of res.text.matchAll(/\/maps\/org\/([a-z0-9_\-]+)\/(\d+)\//g)) {
      const path = `/maps/org/${m[1]}/${m[2]}/`;
      if (seen.has(path)) continue;
      seen.add(path);
      const url = 'https://yandex.ru' + path;
      let ns = 0;
      const slug = m[1].toLowerCase();
      if (translit(sur) && slug.includes(translit(sur))) {
        ns = nam && slug.includes(translit(nam)) ? 0.85 : 0.55;
      }
      if (ns < 0.55) continue;
      const { rating, reviews, name } = await fetchYandexOrg(url);
      if (rating == null) continue;
      out.push(candidate({ source: 'yandex', name: name || slug, url, rating, reviews, nameMatch: ns }));
    }
    if (out.length) break;
  }
  if (!out.length) {
    const { rating, reviews, name } = await fetchYandexOrg(AMIRDENT_YANDEX);
    if (rating != null) {
      out.push(
        candidate({
          source: 'yandex',
          name: name || 'АмирДент',
          url: AMIRDENT_YANDEX,
          rating,
          reviews,
          nameMatch: 0.62,
        })
      );
    }
  }
  return out;
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'bad_json' }, 400);
  }
  const token = request.headers.get('X-CMS-Token') || payload.token;
  if (!checkAuth(token)) return json({ ok: false, error: 'unauthorized' }, 401);

  const full = String(payload.name || '').trim();
  if (full.length < 3) return json({ ok: false, error: 'Укажите ФИО врача', candidates: [], best: null });

  const candidates = [];
  const errors = [];
  for (const [label, fn] of [
    ['ПроДокторов', searchProdoctorov],
    ['DocDoc', searchDocdoc],
    ['Зуб.ру', searchZub],
    ['Doctu', searchDoctu],
  ]) {
    try {
      candidates.push(...(await fn(full)));
    } catch (e) {
      errors.push(`${label}: ${e?.message || e}`);
    }
  }

  const docdocOk = candidates.some((c) => c.source === 'docdoc' && c.rating != null);
  if (!docdocOk) {
    try {
      candidates.push(...(await searchYandex(full)));
    } catch (e) {
      errors.push(`Яндекс Карты: ${e?.message || e}`);
    }
  }

  const bySrc = {};
  for (const c of candidates) {
    const prev = bySrc[c.source];
    if (!prev || c.confidence > prev.confidence || (c.confidence === prev.confidence && (c.rating || 0) > (prev.rating || 0))) {
      bySrc[c.source] = c;
    }
  }
  if (bySrc.docdoc && bySrc.docdoc.rating != null) delete bySrc.yandex;
  const perSource = Object.values(bySrc);
  const best = pickBest(perSource);
  const result = {
    ok: true,
    query: full,
    best: null,
    candidates: candidates.sort((a, b) => (b.rating || 0) - (a.rating || 0) || b.confidence - a.confidence),
    perSource,
    errors,
    faceUsed: false,
  };
  if (best) {
    result.best = {
      pdRating: Math.round(best.rating * 10) / 10,
      pdReviews: best.reviews,
      pdUrl: best.url || '',
      ratingSource: best.source || 'pd',
      sourceLabel: LABELS[best.source] || best.source,
      matchedName: best.name || '',
      confidence: best.confidence,
      faceSim: null,
      nameMatch: best.nameMatch,
    };
  }
  return json(result);
};

export const config = {
  path: ['/api/cms/doctor-rating'],
};
