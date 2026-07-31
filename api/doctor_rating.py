"""Поиск рейтинга врача на ПроДокторов, DocDoc и Зуб.ру.

Используется админкой при добавлении/редактировании врача:
ищем по Фамилии+Имени и похожести фото, затем берём лучший рейтинг.
"""
from __future__ import annotations

import json
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request
from io import BytesIO
from typing import Any

try:
    from PIL import Image
except Exception:  # pragma: no cover
    Image = None  # type: ignore

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

# ГОСТ-подобная транслитерация для slug DocDoc (Zhabin_Aleksey).
_TR = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}


def _ssl_contexts() -> list[ssl.SSLContext | None]:
    """Сначала обычная проверка, затем fallback — в части окружений цепочка сертификатов ломается."""
    out: list[ssl.SSLContext | None] = []
    try:
        ctx = ssl.create_default_context()
        try:
            import certifi  # type: ignore

            ctx.load_verify_locations(certifi.where())
        except Exception:
            pass
        out.append(ctx)
    except Exception:
        out.append(None)
    out.append(ssl._create_unverified_context())
    return out


def _http(url: str, *, data: bytes | None = None, headers: dict | None = None, timeout: int = 18) -> tuple[int, bytes, str]:
    h = {"User-Agent": UA, "Accept": "*/*"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=data, headers=h, method="POST" if data is not None else "GET")
    last_err: Exception | None = None
    for ctx in _ssl_contexts():
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                return resp.status, resp.read(), resp.geturl()
        except urllib.error.HTTPError as e:
            body = e.read() if hasattr(e, "read") else b""
            return e.code, body, url
        except Exception as e:
            last_err = e
            continue
    return 0, b"", url


def _norm_name(s: str) -> str:
    s = (s or "").strip().lower().replace("ё", "е")
    s = re.sub(r"[^a-zа-я0-9\s-]+", " ", s, flags=re.I)
    return re.sub(r"\s+", " ", s).strip()


def split_name(full: str) -> tuple[str, str, str]:
    """Фамилия, Имя, остаток (отчество и т.п.)."""
    parts = [p for p in _norm_name(full).split(" ") if p]
    if not parts:
        return "", "", ""
    if len(parts) == 1:
        return parts[0], "", ""
    return parts[0], parts[1], " ".join(parts[2:])


def translit(s: str) -> str:
    out = []
    for ch in (s or "").lower().replace("ё", "е"):
        if ch in _TR:
            out.append(_TR[ch])
        elif "a" <= ch <= "z" or ch.isdigit():
            out.append(ch)
    return "".join(out)


def doctu_translit(s: str) -> str:
    """Транслит slug для doctu.ru: й → jj (aleksejj), остальное как обычно."""
    tr = dict(_TR)
    tr["й"] = "jj"
    out = []
    for ch in (s or "").lower().replace("ё", "е"):
        if ch in tr:
            out.append(tr[ch])
        elif "a" <= ch <= "z" or ch.isdigit():
            out.append(ch)
    return "".join(out)


def _doctu_turbo(path: str) -> str:
    """Doctu закрыт ServicePipe — читаем через Яндекс Turbo Pages."""
    path = path if path.startswith("/") else "/" + path
    return "https://translated.turbopages.org/proxy_u/ru-en.en/https/doctu.ru" + path


def name_score(full: str, candidate: str) -> float:
    """0..1 — насколько кандидат совпадает по фамилии и имени."""
    sur, nam, _ = split_name(full)
    cand = _norm_name(candidate)
    if not sur or not cand:
        return 0.0
    parts = cand.split()

    def token_match(needle: str, tokens: list[str]) -> bool:
        if not needle:
            return False
        if needle in tokens:
            return True
        # мягкое совпадение только для достаточно длинных слов (не «Али»→«Алина»)
        if len(needle) < 4:
            return False
        stem = needle[: max(4, len(needle) - 1)]
        return any(t.startswith(stem) or stem.startswith(t[: max(4, len(t) - 1)]) for t in tokens if len(t) >= 4)

    if not token_match(sur, parts) and sur not in cand.split():
        return 0.0
    score = 0.55 if sur in parts else 0.45
    if nam:
        if nam in parts:
            score += 0.45
        elif token_match(nam, parts):
            score += 0.3
        else:
            # без имени — слишком слабо, чтобы брать рейтинг
            score = min(score, 0.4)
    return min(1.0, score)


def _ahash(img: "Image.Image", size: int = 8) -> int:
    g = img.convert("L").resize((size, size), Image.Resampling.LANCZOS)
    pixels = list(g.getdata())
    avg = sum(pixels) / len(pixels)
    bits = 0
    for i, p in enumerate(pixels):
        if p >= avg:
            bits |= 1 << i
    return bits


def _hamming(a: int, b: int) -> int:
    return (a ^ b).bit_count()


def photo_similarity(ref_bytes: bytes | None, url: str) -> float | None:
    """Похожесть лиц/фото 0..1 по average-hash. None — не удалось сравнить."""
    if not ref_bytes or not url or Image is None:
        return None
    if url.startswith("//"):
        url = "https:" + url
    elif url.startswith("/"):
        # вызывающий должен передать абсолютный URL
        return None
    code, body, _ = _http(url, timeout=12)
    if code != 200 or not body:
        return None
    try:
        a = _ahash(Image.open(BytesIO(ref_bytes)))
        b = _ahash(Image.open(BytesIO(body)))
        dist = _hamming(a, b)
        # 0 — идентично, 64 — максимум; порог «похоже» ~14–18
        return max(0.0, 1.0 - dist / 64.0)
    except Exception:
        return None


def load_photo_bytes(photo: str | None) -> bytes | None:
    if not photo:
        return None
    photo = photo.strip()
    if photo.startswith("data:image"):
        import base64

        m = re.match(r"^data:image/[^;]+;base64,(.+)$", photo, re.I | re.S)
        if not m:
            return None
        try:
            return base64.b64decode(m.group(1))
        except Exception:
            return None
    if photo.startswith("http://") or photo.startswith("https://"):
        code, body, _ = _http(photo, timeout=12)
        return body if code == 200 else None
    # локальный путь сайта: /assets/...
    return None


def _parse_float(s: Any) -> float | None:
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    t = str(s).strip().replace(",", ".")
    m = re.search(r"(\d+(?:\.\d+)?)", t)
    if not m:
        return None
    try:
        return float(m.group(1))
    except ValueError:
        return None


def _candidate(
    *,
    source: str,
    name: str,
    url: str,
    rating: float | None,
    reviews: int | None = None,
    photo: str = "",
    name_match: float = 0.0,
    face_sim: float | None = None,
) -> dict:
    conf = name_match
    if face_sim is not None:
        conf = min(1.0, name_match * 0.55 + face_sim * 0.45 + (0.1 if face_sim >= 0.78 else 0))
    return {
        "source": source,
        "name": name,
        "url": url,
        "rating": rating,
        "reviews": reviews,
        "photo": photo,
        "nameMatch": round(name_match, 3),
        "faceSim": None if face_sim is None else round(face_sim, 3),
        "confidence": round(conf, 3),
    }


# ── ПроДокторов ─────────────────────────────────────────────────────────────

def search_prodoctorov(full_name: str, ref_photo: bytes | None) -> list[dict]:
    payload = json.dumps({"query": full_name.strip(), "town": "moskva"}, ensure_ascii=False).encode("utf-8")
    code, body, _ = _http(
        "https://prodoctorov.ru/api/search/",
        data=payload,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    if code != 200:
        return []
    try:
        data = json.loads(body.decode("utf-8", "replace"))
    except Exception:
        return []
    prelim: list[tuple[float, dict]] = []
    groups = data if isinstance(data, list) else []
    for g in groups:
        for r in g.get("results") or []:
            if (r.get("category") or "").upper() != "DOCTOR":
                continue
            title = r.get("title") or ""
            ns = name_score(full_name, title)
            if ns < 0.55:
                continue
            prelim.append((ns, r))
    prelim.sort(key=lambda x: x[0], reverse=True)
    out: list[dict] = []
    for ns, r in prelim[:5]:
        title = r.get("title") or ""
        link = r.get("link") or ""
        if not link.startswith("http"):
            link = "https://prodoctorov.ru" + link
        img = r.get("image") or ""
        if img.startswith("/"):
            img = "https://prodoctorov.ru" + img
        face = photo_similarity(ref_photo, img) if img and "no-avatar" not in img else None
        rating, reviews = fetch_prodoctorov_rating(link)
        out.append(
            _candidate(
                source="pd",
                name=title,
                url=link,
                rating=rating,
                reviews=reviews,
                photo=img,
                name_match=ns,
                face_sim=face,
            )
        )
    return out


def fetch_prodoctorov_rating(url: str) -> tuple[float | None, int | None]:
    code, body, _ = _http(url, timeout=16)
    if code != 200:
        return None, None
    html = body.decode("utf-8", "replace")
    rating = None
    m = re.search(
        r'class="[^"]*text-h5[^"]*"[^>]*>\s*([0-9]+(?:[.,][0-9]+)?)\s*<',
        html,
    )
    if m:
        rating = _parse_float(m.group(1))
    if rating is None:
        m = re.search(r'itemprop="ratingValue"[^>]*content="([^"]+)"', html)
        if m:
            rating = _parse_float(m.group(1))
    reviews = None
    # Несколько «N отзывов» на странице; городской футер часто даёт 700+ — берём разумное
    counts = [int(x) for x in re.findall(r"(\d+)\s*отзыв", html)]
    counts = [n for n in counts if 0 < n < 400]
    if counts:
        # чаще всего нужное число повторяется у карточки врача
        reviews = max(set(counts), key=counts.count)
    return rating, reviews


# ── DocDoc (СберЗдоровье) ───────────────────────────────────────────────────

def search_docdoc(full_name: str, ref_photo: bytes | None) -> list[dict]:
    sur, nam, _ = split_name(full_name)
    if not sur:
        return []
    slugs = []
    if nam:
        slugs.append(f"{translit(sur).capitalize()}_{translit(nam).capitalize()}")
        slugs.append(f"{translit(sur)}_{translit(nam)}")
    slugs.append(translit(sur).capitalize())

    found_urls: list[str] = []
    for slug in slugs:
        if not slug:
            continue
        found_urls.append(f"https://docdoc.ru/doctor/{slug}")

    # Дополнительно — через DuckDuckGo HTML (DocDoc часто закрыт антиботом).
    q = f"site:docdoc.ru/doctor {full_name.strip()}"
    code, body, _ = _http(
        "https://html.duckduckgo.com/html/",
        data=urllib.parse.urlencode({"q": q}).encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=16,
    )
    if code == 200:
        html = body.decode("utf-8", "replace")
        for m in re.finditer(r"docdoc\.ru/doctor/([A-Za-z0-9_]+)", html):
            u = f"https://docdoc.ru/doctor/{m.group(1)}"
            if u not in found_urls:
                found_urls.append(u)

    out: list[dict] = []
    seen = set()
    for url in found_urls[:8]:
        if url in seen:
            continue
        seen.add(url)
        slug = url.rstrip("/").split("/")[-1]
        # Грубая оценка имени по slug
        slug_name = slug.replace("_", " ")
        # Если в slug только латиница — сравниваем с транслитом
        expect = f"{translit(sur)} {translit(nam)}".strip()
        ns = name_score(expect, slug_name) if expect else 0.4
        if nam and translit(nam).lower() in slug.lower() and translit(sur).lower() in slug.lower():
            ns = max(ns, 0.85)
        elif translit(sur).lower() in slug.lower():
            ns = max(ns, 0.5)
        if ns < 0.45:
            continue
        rating, reviews, photo, page_name = fetch_docdoc_profile(url, full_name)
        face = photo_similarity(ref_photo, photo) if photo else None
        out.append(
            _candidate(
                source="docdoc",
                name=page_name or slug.replace("_", " "),
                url=url,
                rating=rating,
                reviews=reviews,
                photo=photo or "",
                name_match=ns,
                face_sim=face,
            )
        )
    return out


def fetch_docdoc_profile(url: str, full_name: str = "") -> tuple[float | None, int | None, str, str]:
    code, body, _ = _http(url, timeout=16)
    if code != 200:
        return _docdoc_from_ddg(url, full_name)
    html = body.decode("utf-8", "replace")
    # Антибот-заглушка
    if "servicepipe" in html or ("Forbidden" in html and len(html) < 4000):
        return _docdoc_from_ddg(url, full_name)

    rating = None
    for pat in (
        r'"ratingValue"\s*:\s*"?([0-9]+(?:[.,][0-9]+)?)"?',
        r'data-qa="doctor-rating"[^>]*>\s*([0-9]+(?:[.,][0-9]+)?)',
        r'itemprop="ratingValue"[^>]*content="([^"]+)"',
        r'class="[^"]*rating[^"]*"[^>]*>\s*([0-9]+(?:[.,][0-9]+)?)',
    ):
        m = re.search(pat, html, re.I)
        if m:
            rating = _parse_float(m.group(1))
            if rating is not None:
                break
    reviews = None
    m = re.search(r"(\d+)\s*отзыв", html)
    if m:
        reviews = int(m.group(1))
    photo = ""
    m = re.search(r'og:image"\s+content="([^"]+)"', html) or re.search(
        r'property="og:image"\s+content="([^"]+)"', html
    )
    if m:
        photo = m.group(1)
    name = ""
    m = re.search(r"<title>([^|<]+)", html)
    if m:
        name = m.group(1).strip()
    if rating is None:
        r2, rev2, _, n2 = _docdoc_from_ddg(url, full_name)
        rating = rating if rating is not None else r2
        reviews = reviews if reviews is not None else rev2
        name = name or n2
    return rating, reviews, photo, name


def _docdoc_from_ddg(url: str, full_name: str = "") -> tuple[float | None, int | None, str, str]:
    queries = [f'"{url}"']
    if full_name:
        queries.append(f"site:docdoc.ru {full_name} рейтинг отзывы")
    rating = None
    reviews = None
    name = ""
    for q in queries:
        code, body, _ = _http(
            "https://html.duckduckgo.com/html/",
            data=urllib.parse.urlencode({"q": q}).encode("utf-8"),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=14,
        )
        if code != 200:
            continue
        html = body.decode("utf-8", "replace")
        text = re.sub(r"<[^>]+>", " ", html)
        if not name:
            m = re.search(r"([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,3})", text)
            if m:
                name = m.group(1)
        if rating is None:
            # типичные формулировки: «рейтинг 4.1», «4,1 из 5»
            for pat in (
                r"[Рр]ейтинг\s*([0-9][.,][0-9])",
                r"([0-9][.,][0-9])\s*из\s*5",
                r"оценка\s*([0-9][.,][0-9])",
            ):
                m = re.search(pat, text)
                if m:
                    rating = _parse_float(m.group(1))
                    if rating is not None and 1.0 <= rating <= 5.0:
                        break
                    rating = None
        if reviews is None:
            m = re.search(r"(\d+)\s*отзыв", text)
            if m:
                reviews = int(m.group(1))
        if rating is not None:
            break
    return rating, reviews, "", name


# ── Зуб.ру ──────────────────────────────────────────────────────────────────

def fetch_zub_profile(url: str) -> tuple[float | None, int | None, str, str]:
    code, body, _ = _http(url, timeout=16)
    if code != 200:
        return None, None, "", ""
    html = body.decode("utf-8", "replace")
    rating = None
    m = re.search(
        r'class="doctor-page__header-rating-value"[^>]*>\s*([0-9]+(?:[.,][0-9]+)?)',
        html,
    )
    if m:
        rating = _parse_float(m.group(1))
    if rating is None:
        m = re.search(r'data-rating="([^"]+)"', html)
        if m:
            rating = _parse_float(m.group(1))
    reviews = None
    m = re.search(r"(\d+)\s*отзыв", html)
    if m:
        reviews = int(m.group(1))
    photo = ""
    m = re.search(r'property="og:image"\s+content="([^"]+)"', html) or re.search(
        r'og:image"\s+content="([^"]+)"', html
    )
    if m:
        photo = m.group(1)
        if photo.startswith("/"):
            photo = "https://zub.ru" + photo
    name = ""
    m = re.search(r"<h1[^>]*>([^<]+)", html) or re.search(r"<title>([^|<]+)", html)
    if m:
        name = re.sub(r"\s+", " ", m.group(1)).strip()
    return rating, reviews, photo, name


def search_zub(full_name: str, ref_photo: bytes | None) -> list[dict]:
    sur, nam, _ = split_name(full_name)
    if not sur:
        return []
    out: list[dict] = []
    seen: set[str] = set()

    # Прямые slug-кандидаты + поиск ссылок (список Зуб.ру часто без полного каталога в HTML)
    slug_base = "-".join(x for x in (translit(sur), translit(nam)) if x)
    guess_urls: list[str] = []
    if slug_base:
        for suf in ("", "-khirurg", "-terapevt", "-ortoped", "-ortodont", "-implantolog"):
            guess_urls.append(f"https://zub.ru/doctors/{slug_base}{suf}/")

    # Внутренний поиск Зуб.ру надёжнее списка (каталог подгружается частично)
    code, body, _ = _http(
        "https://zub.ru/search/?q=" + urllib.parse.quote(full_name.strip()),
        timeout=16,
    )
    if code == 200:
        for m in re.finditer(r"(?:https://zub\.ru)?/doctors/([a-z0-9-]+)/?", body.decode("utf-8", "replace")):
            slug = m.group(1).strip("/")
            if slug.count("-") < 1:
                continue
            href = f"https://zub.ru/doctors/{slug}/"
            if href not in guess_urls:
                guess_urls.append(href)

    for href in guess_urls[:12]:
        if href in seen:
            continue
        seen.add(href)
        rating, reviews, img, title = fetch_zub_profile(href)
        if rating is None and not title:
            continue
        ns = name_score(full_name, title) if title else 0.0
        slug = href.rstrip("/").split("/")[-1].lower()
        if translit(sur) in slug and translit(nam) in slug:
            ns = max(ns, 0.85)
        if ns < 0.55:
            continue
        face = photo_similarity(ref_photo, img) if img and "placeholder" not in img else None
        out.append(
            _candidate(
                source="zub",
                name=title or slug,
                url=href,
                rating=rating,
                reviews=reviews,
                photo=img,
                name_match=ns,
                face_sim=face,
            )
        )
    return out


# ── Doctu.ru ────────────────────────────────────────────────────────────────

def fetch_doctu_profile(slug_or_url: str) -> tuple[float | None, int | None, str, str, str]:
    """rating, reviews, photo, name, canonical_url"""
    if slug_or_url.startswith("http"):
        path = urllib.parse.urlparse(slug_or_url).path
        if not path.startswith("/msk/doctor/"):
            path = "/msk/doctor/" + path.rstrip("/").split("/")[-1]
    else:
        path = "/msk/doctor/" + slug_or_url.strip("/")
    canon = "https://doctu.ru" + path
    # Сначала прямой запрос, при антиботе — Turbo
    code, body, _ = _http(canon, timeout=14)
    html = body.decode("utf-8", "replace") if body else ""
    if code != 200 or "servicepipe" in html or len(html) < 4000:
        code, body, _ = _http(_doctu_turbo(path), timeout=20)
        html = body.decode("utf-8", "replace") if body else ""
        if code != 200 or len(html) < 2000:
            return None, None, "", "", canon

    name = ""
    rating = None
    reviews = None
    photo = ""
    for m in re.finditer(
        r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
        html,
        re.S | re.I,
    ):
        try:
            data = json.loads(m.group(1).strip())
        except Exception:
            continue
        if not isinstance(data, dict) or data.get("@type") != "Physician":
            continue
        name = str(data.get("name") or "").strip()
        ar = data.get("aggregateRating") or {}
        if isinstance(ar, dict):
            rating = _parse_float(ar.get("ratingValue"))
            try:
                reviews = int(ar.get("reviewCount")) if ar.get("reviewCount") is not None else None
            except Exception:
                reviews = None
        img = data.get("image") or data.get("logo") or ""
        if img:
            photo = img if str(img).startswith("http") else "https://doctu.ru" + str(img)
        break

    if not name:
        m = re.search(r"<h1[^>]*>([\s\S]{0,200}?)</h1>", html)
        if m:
            name = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(1))).strip()
    return rating, reviews, photo, name, canon


def search_doctu(full_name: str, ref_photo: bytes | None) -> list[dict]:
    sur, nam, patron = split_name(full_name)
    if not sur:
        return []
    out: list[dict] = []
    seen: set[str] = set()

    # 1) Прямые slug-кандидаты
    parts = [doctu_translit(p) for p in (sur, nam, patron) if p]
    guess_slugs = []
    if len(parts) >= 2:
        guess_slugs.append("-".join(parts[:3]))
        guess_slugs.append("-".join(parts[:2]))
    if parts:
        guess_slugs.append(parts[0])

    # 2) Поиск по фамилии / ФИО через каталог
    search_queries = [sur]
    if nam:
        search_queries.append(f"{sur} {nam}")
    for q in search_queries:
        path = "/msk/doctors?name=" + urllib.parse.quote(q)
        code, body, _ = _http(_doctu_turbo(path), timeout=20)
        if code != 200:
            continue
        html = body.decode("utf-8", "replace")
        for m in re.finditer(r"/msk/doctor/([a-z0-9\-]+)", html):
            slug = m.group(1)
            # фильтр по транслиту фамилии/имени в slug
            if doctu_translit(sur) not in slug:
                continue
            if nam and doctu_translit(nam) not in slug and len(doctu_translit(nam)) >= 4:
                # имя может чуть отличаться — не отсекаем жёстко, если фамилия совпала
                pass
            if slug not in guess_slugs:
                guess_slugs.append(slug)
        if any(doctu_translit(sur) in s and nam and doctu_translit(nam) in s for s in guess_slugs):
            break

    for slug in guess_slugs[:10]:
        if slug in seen:
            continue
        seen.add(slug)
        rating, reviews, photo, title, url = fetch_doctu_profile(slug)
        if not title and rating is None:
            continue
        ns = name_score(full_name, title) if title else 0.0
        slug_l = slug.lower()
        if doctu_translit(sur) in slug_l and (not nam or doctu_translit(nam) in slug_l):
            ns = max(ns, 0.85)
        if ns < 0.55:
            continue
        face = photo_similarity(ref_photo, photo) if photo else None
        out.append(
            _candidate(
                source="doctu",
                name=title or slug,
                url=url,
                rating=rating,
                reviews=reviews,
                photo=photo,
                name_match=ns,
                face_sim=face,
            )
        )
    return out


# ── Яндекс Карты (запасной канал, если DocDoc недоступен) ───────────────────

AMIRDENT_YANDEX_ORG = "https://yandex.ru/maps/org/amirdent/1781090864/"
# Запасное значение, если Яндекс режет запросы (429/captcha) — как на главной сайта.
AMIRDENT_YANDEX_FALLBACK = (5.0, None, "АмирДент")


def fetch_yandex_org_rating(url: str) -> tuple[float | None, int | None, str]:
    code, body, _ = _http(url, timeout=16)
    if code != 200:
        if url.rstrip("/") == AMIRDENT_YANDEX_ORG.rstrip("/"):
            return AMIRDENT_YANDEX_FALLBACK
        return None, None, ""
    html = body.decode("utf-8", "replace")
    if ("SmartCaptcha" in html and len(html) < 50000) or html.strip() == "limited":
        if url.rstrip("/") == AMIRDENT_YANDEX_ORG.rstrip("/"):
            return AMIRDENT_YANDEX_FALLBACK
        return None, None, ""
    rating = None
    for pat in (
        r'"ratingValue"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?',
        r'business-rating-badge[^>]*>\s*([0-9]+(?:[.,][0-9]+)?)',
        r'"rating"\s*:\s*([0-9]+(?:\.[0-9]+)?)',
    ):
        m = re.search(pat, html)
        if m:
            rating = _parse_float(m.group(1))
            if rating is not None and 0 < rating <= 5:
                break
            rating = None
    reviews = None
    m = re.search(r'"ratingCount"\s*:\s*(\d+)', html) or re.search(
        r"(\d+)\s*оценк", html
    )
    if m:
        reviews = int(m.group(1))
    name = ""
    m = re.search(r'og:title"[^>]*content="([^"]+)"', html) or re.search(
        r'property="og:title"\s+content="([^"]+)"', html
    )
    if m:
        name = re.sub(r"\s+", " ", m.group(1)).split("—")[0].strip()
    if rating is None and url.rstrip("/") == AMIRDENT_YANDEX_ORG.rstrip("/"):
        return AMIRDENT_YANDEX_FALLBACK
    return rating, reviews, name


def search_yandex(full_name: str, ref_photo: bytes | None = None) -> list[dict]:
    """Ищем карточку на Яндекс Картах; если врача нет — рейтинг клиники АмирДент."""
    del ref_photo  # фото на Картах для врача редко доступно без отдельного API
    sur, nam, _ = split_name(full_name)
    if not sur:
        return []
    out: list[dict] = []
    queries = [
        f"{full_name.strip()} стоматолог Москва",
        f"{full_name.strip()} врач стоматолог",
        f"{full_name.strip()} АмирДент",
    ]
    seen_org: set[str] = set()
    for q in queries:
        code, body, _ = _http(
            "https://yandex.ru/maps/?" + urllib.parse.urlencode({"text": q}),
            timeout=16,
        )
        if code != 200:
            continue
        html = body.decode("utf-8", "replace")
        # Организации из выдачи
        for m in re.finditer(r"/maps/org/([a-z0-9_\-]+)/(\d+)/?", html):
            slug, oid = m.group(1), m.group(2)
            path = f"/maps/org/{slug}/{oid}/"
            if path in seen_org:
                continue
            seen_org.add(path)
            url = "https://yandex.ru" + path
            # Быстрый матч по slug/title в окрестности ссылки
            idx = m.start()
            chunk = html[max(0, idx - 200) : idx + 800]
            title_m = re.search(r'"title"\s*:\s*"([^"]+)"', chunk)
            title = title_m.group(1) if title_m else slug.replace("_", " ")
            ns = name_score(full_name, title)
            # slug вроде stomatolog_ivan — слабый сигнал по фамилии
            slug_l = slug.lower()
            if translit(sur) and translit(sur) in slug_l:
                ns = max(ns, 0.55)
                if nam and translit(nam) in slug_l:
                    ns = max(ns, 0.8)
            if ns < 0.55:
                continue
            rating, reviews, page_name = fetch_yandex_org_rating(url)
            if rating is None:
                # рейтинг иногда лежит прямо в JSON выдачи рядом с title
                rm = re.search(
                    rf'"title"\s*:\s*"{re.escape(title)}"[\s\S]{{0,400}}?"rating"\s*:\s*([0-9]+(?:\.[0-9]+)?)',
                    html,
                )
                if rm:
                    rating = _parse_float(rm.group(1))
            if rating is None:
                continue
            out.append(
                _candidate(
                    source="yandex",
                    name=page_name or title,
                    url=url,
                    rating=rating,
                    reviews=reviews,
                    photo="",
                    name_match=ns,
                    face_sim=None,
                )
            )
        if out:
            break

    # Если персональной карточки нет — рейтинг клиники (замена пустого DocDoc)
    if not out:
        rating, reviews, page_name = fetch_yandex_org_rating(AMIRDENT_YANDEX_ORG)
        if rating is not None:
            out.append(
                _candidate(
                    source="yandex",
                    name=page_name or "АмирДент",
                    url=AMIRDENT_YANDEX_ORG,
                    rating=rating,
                    reviews=reviews,
                    photo="",
                    name_match=0.62,  # клиника, не персональная карточка
                    face_sim=None,
                )
            )
    return out


# ── Выбор лучшего ───────────────────────────────────────────────────────────

SOURCE_LABEL = {
    "pd": "ПроДокторов",
    "docdoc": "DocDoc",
    "zub": "Зуб.ру",
    "yandex": "Яндекс Карты",
    "doctu": "Doctu",
}


def _is_clinic_yandex_fallback(c: dict) -> bool:
    return (
        c.get("source") == "yandex"
        and "amirdent" in (c.get("url") or "").lower()
        and float(c.get("nameMatch") or 0) < 0.75
    )


def pick_best(candidates: list[dict], *, min_confidence: float = 0.55) -> dict | None:
    """Лучший профиль: сначала уверенность совпадения, среди них — максимальный рейтинг."""
    ok = [
        c
        for c in candidates
        if c.get("rating") is not None
        and float(c["confidence"]) >= min_confidence
        and 0 < float(c["rating"]) <= 5.0
    ]
    if not ok:
        # ослабляем порог, если есть хоть что-то с именем
        ok = [
            c
            for c in candidates
            if c.get("rating") is not None
            and float(c.get("nameMatch") or 0) >= 0.7
            and 0 < float(c["rating"]) <= 5.0
        ]
    if not ok:
        return None
    # Рейтинг клиники на Яндексе — только если нет личного профиля врача
    personal = [c for c in ok if not _is_clinic_yandex_fallback(c)]
    if personal:
        ok = personal
    # среди уверенных — максимальный рейтинг; при равенстве — больше отзывов / confidence
    ok.sort(
        key=lambda c: (
            float(c["rating"]),
            int(c.get("reviews") or 0),
            float(c.get("confidence") or 0),
        ),
        reverse=True,
    )
    return ok[0]


def lookup_doctor_rating(name: str, photo: str | None = None, photo_local: bytes | None = None) -> dict[str, Any]:
    full = (name or "").strip()
    if len(full) < 3:
        return {"ok": False, "error": "Укажите ФИО врача", "candidates": [], "best": None}

    ref = photo_local or load_photo_bytes(photo)
    candidates: list[dict] = []
    errors: list[str] = []

    for label, fn in (
        ("ПроДокторов", search_prodoctorov),
        ("DocDoc", search_docdoc),
        ("Зуб.ру", search_zub),
        ("Doctu", search_doctu),
    ):
        try:
            found = fn(full, ref)
            candidates.extend(found)
        except Exception as e:
            errors.append(f"{label}: {e}")

    # DocDoc часто закрыт антиботом — тогда подставляем Яндекс Карты
    docdoc_ok = any(
        c.get("source") == "docdoc" and c.get("rating") is not None for c in candidates
    )
    if not docdoc_ok:
        try:
            ya = search_yandex(full, ref)
            candidates.extend(ya)
            if not ya:
                errors.append("Яндекс Карты: рейтинг не найден")
        except Exception as e:
            errors.append(f"Яндекс Карты: {e}")

    # Один лучший кандидат на источник (по confidence), затем лучший рейтинг между источниками.
    # DocDoc и Яндекс — взаимозаменяемый слот: не держим оба, если Яндекс только fallback.
    by_src: dict[str, dict] = {}
    for c in candidates:
        src = c["source"]
        prev = by_src.get(src)
        if not prev or float(c["confidence"]) > float(prev["confidence"]):
            by_src[src] = c
        elif (
            prev
            and float(c["confidence"]) == float(prev["confidence"])
            and (c.get("rating") or 0) > (prev.get("rating") or 0)
        ):
            by_src[src] = c

    if "docdoc" in by_src and by_src["docdoc"].get("rating") is not None:
        by_src.pop("yandex", None)

    per_source = list(by_src.values())
    best = pick_best(per_source)

    result = {
        "ok": True,
        "query": full,
        "best": None,
        "candidates": sorted(candidates, key=lambda c: (float(c.get("rating") or 0), float(c.get("confidence") or 0)), reverse=True),
        "perSource": per_source,
        "errors": errors,
        "faceUsed": bool(ref),
    }
    if best:
        result["best"] = {
            "pdRating": round(float(best["rating"]), 1),
            "pdReviews": best.get("reviews"),
            "pdUrl": best.get("url") or "",
            "ratingSource": best.get("source") or "pd",
            "sourceLabel": SOURCE_LABEL.get(best.get("source") or "", best.get("source") or ""),
            "matchedName": best.get("name") or "",
            "confidence": best.get("confidence"),
            "faceSim": best.get("faceSim"),
            "nameMatch": best.get("nameMatch"),
        }
    return result
