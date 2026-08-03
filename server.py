#!/usr/bin/env python3
"""AmirDent static server + CMS save API + local lead intake.

Run:  python3 server.py
Site: http://localhost:8080
Admin: http://localhost:8080/admin.html

Логин админки — как на Netlify: CMS_LOGIN + CMS_PASSWORD_HASH в файле .env
(см. .env.example). Сессия в cookie amirdent_cms_session.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
SITE = ROOT / "site"
HOST = "127.0.0.1"
PORT = 8080
CONTENT_FILE = SITE / "assets" / "content.json"
UPLOADS_DIR = SITE / "assets" / "uploads"
LEADS_LOG = ROOT / "api" / "leads-local.log"

SESSION_COOKIE = "amirdent_cms_session"
SESSION_TTL_SEC = 8 * 60 * 60
SESSIONS_FILE = ROOT / "api" / "cms-sessions.local.json"
# token -> {login, expiresAt}
_SESSIONS: dict[str, dict] = {}


def _load_sessions() -> None:
    global _SESSIONS
    try:
        if not SESSIONS_FILE.exists():
            return
        data = json.loads(SESSIONS_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            _SESSIONS = {
                str(k): v
                for k, v in data.items()
                if isinstance(v, dict) and v.get("login") and v.get("expiresAt")
            }
    except Exception:
        _SESSIONS = {}


def _save_sessions() -> None:
    try:
        SESSIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = SESSIONS_FILE.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(_SESSIONS, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, SESSIONS_FILE)
    except Exception as e:
        print("[cms] session persist failed:", e)


def _load_dotenv():
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    try:
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val
    except Exception:
        pass


_load_dotenv()
_load_sessions()

PASS_HASH = os.environ.get("CMS_PASSWORD_HASH", "").strip().lower()
CMS_LOGIN = os.environ.get("CMS_LOGIN", "").strip()


def _sha256(value: str) -> str:
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()


def _same_secret(a: str, b: str) -> bool:
    aa = str(a or "").encode("utf-8")
    bb = str(b or "").encode("utf-8")
    return len(aa) == len(bb) and hmac.compare_digest(aa, bb)


def _cms_configured() -> bool:
    return bool(CMS_LOGIN) and len(PASS_HASH) == 64 and all(c in "0123456789abcdef" for c in PASS_HASH)


def _purge_expired_sessions() -> None:
    now_ms = int(time.time() * 1000)
    dead = [tok for tok, s in _SESSIONS.items() if int(s.get("expiresAt") or 0) <= now_ms]
    if not dead:
        return
    for tok in dead:
        _SESSIONS.pop(tok, None)
    _save_sessions()


def _session_cookie_header(token: str, *, clear: bool = False) -> str:
    # Без Secure: локально сайт на http://, иначе браузер cookie не сохранит.
    if clear:
        return f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"
    return (
        f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; "
        f"Max-Age={SESSION_TTL_SEC}"
    )


def _load_telegram_config():
    """Optional local Telegram: env vars or api/config.local.json."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    local = ROOT / "api" / "config.local.json"
    if local.exists():
        try:
            data = json.loads(local.read_text(encoding="utf-8"))
            token = token or str(data.get("bot_token") or "").strip()
            chat = chat or str(data.get("chat_id") or "").strip()
        except Exception:
            pass
    if token and chat and "ЗАМЕНИТЕ" not in token and chat != "000000000":
        return token, chat
    return None, None


def _send_telegram(token: str, chat_id: str, text: str) -> bool:
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    body = urllib.parse.urlencode(
        {"chat_id": chat_id, "text": text, "disable_web_page_preview": "1"}
    ).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return 200 <= resp.status < 300
    except (urllib.error.URLError, TimeoutError):
        return False


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SITE), **kwargs)

    def end_headers(self):
        path = urlparse(self.path).path
        if path.startswith("/api/") or path.startswith("/assets/cms"):
            self.send_header("Cache-Control", "no-store, max-age=0")
        elif path.startswith("/assets/content.json"):
            # Как на Netlify: короткая публичная кэш-метка, не serverless
            self.send_header("Cache-Control", "public, max-age=300, stale-while-revalidate=86400")
        elif (
            path.endswith("/service.js")
            or path.endswith("/service.html")
            or path.endswith("/styles.css")
            or path.endswith("/index.html")
            or path == "/"
        ):
            self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-CMS-Token")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        # Как на Netlify: читаемые адреса без .html (см. netlify.toml).
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        qs = ("?" + parsed.query) if parsed.query else ""
        if path == "/api/cms/session":
            return self._cms_session()
        if path == "/api/cms/content":
            return self._cms_content()
        if path == "/api/cms/leads":
            return self._cms_leads()
        pretty = {
            "/privacy": "/privacy.html",
            "/legal": "/legal.html",
            "/prices": "/prices.html",
        }
        if path in pretty:
            self.path = pretty[path] + qs
            return super().do_GET()
        if path == "/uslugi" or path.startswith("/uslugi/"):
            slug = path[len("/uslugi") :].strip("/")
            # /uslugi/foo/index.html → slug папки foo
            if slug.endswith("/index.html"):
                slug = slug[: -len("/index.html")]
            elif slug.endswith("index.html"):
                slug = slug[: -len("index.html")].rstrip("/")
            if slug and "/" not in slug:
                built = SITE / "uslugi" / slug / "index.html"
                if built.is_file():
                    self.path = f"/uslugi/{slug}/index.html" + qs
                    return super().do_GET()
            self.path = "/service.html" + qs
            return super().do_GET()
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        if path == "/api/cms/save":
            return self._save_content()
        if path == "/api/cms/login":
            return self._cms_login()
        if path == "/api/cms/logout":
            return self._cms_logout()
        if path == "/api/cms/session":
            return self._cms_session()
        if path == "/api/cms/upload":
            return self._cms_upload()
        if path == "/api/cms/doctor-rating":
            return self._cms_doctor_rating()
        if path in ("/api/lead.php", "/api/lead"):
            return self._save_lead()
        self.send_error(404, "Not Found")

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def _json_response(self, code: int, payload: dict, *, set_cookie: str | None = None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        if set_cookie:
            self.send_header("Set-Cookie", set_cookie)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _cookie_token(self) -> str:
        raw = self.headers.get("Cookie") or ""
        jar = SimpleCookie()
        try:
            jar.load(raw)
        except Exception:
            return ""
        morsel = jar.get(SESSION_COOKIE)
        return (morsel.value if morsel else "") or ""

    def _auth_session(self) -> dict | None:
        _purge_expired_sessions()
        token = self._cookie_token()
        if not token or len(token) < 24:
            return None
        session = _SESSIONS.get(token)
        if not session:
            return None
        if int(session.get("expiresAt") or 0) <= int(time.time() * 1000):
            _SESSIONS.pop(token, None)
            return None
        return {"token": token, "session": session}

    def _require_cms_auth(self, data: dict | None = None):
        """Cookie-сессия (как на Netlify) или устаревший X-CMS-Token = PASS_HASH."""
        auth = self._auth_session()
        if auth:
            return auth
        legacy = (
            self.headers.get("X-CMS-Token")
            or ((data or {}).get("token") if isinstance(data, dict) else None)
            or ""
        ).strip().lower()
        if PASS_HASH and _same_secret(legacy, PASS_HASH):
            return {"token": "", "session": {"login": CMS_LOGIN or "admin"}}
        return None

    def _cms_login(self):
        try:
            data = self._read_json()
        except Exception:
            return self._json_response(400, {"ok": False, "error": "Некорректный JSON"})

        if not _cms_configured():
            return self._json_response(
                500,
                {
                    "ok": False,
                    "error": "not_configured",
                    "message": "Задайте CMS_LOGIN и CMS_PASSWORD_HASH в файле .env (см. .env.example)",
                },
            )

        login = str((data or {}).get("login") or "").strip()
        password = str((data or {}).get("password") or "")
        # Совместимость со старым клиентом, который слал уже хеш в token
        legacy_token = str((data or {}).get("token") or "").strip().lower()
        password_hash = _sha256(password) if password else legacy_token

        if not (_same_secret(login, CMS_LOGIN) and _same_secret(password_hash, PASS_HASH)):
            return self._json_response(401, {"ok": False, "error": "Неверный логин или пароль"})

        token = secrets.token_urlsafe(32)
        expires_at = int(time.time() * 1000) + SESSION_TTL_SEC * 1000
        _SESSIONS[token] = {"login": CMS_LOGIN, "expiresAt": expires_at}
        _save_sessions()
        return self._json_response(
            200,
            {"ok": True, "user": {"login": CMS_LOGIN}, "expiresAt": expires_at},
            set_cookie=_session_cookie_header(token),
        )

    def _cms_logout(self):
        auth = self._auth_session()
        if auth and auth.get("token"):
            _SESSIONS.pop(auth["token"], None)
            _save_sessions()
        return self._json_response(
            200,
            {"ok": True},
            set_cookie=_session_cookie_header("", clear=True),
        )

    def _cms_session(self):
        auth = self._auth_session()
        if not auth:
            return self._json_response(200, {"authenticated": False})
        session = auth["session"]
        return self._json_response(
            200,
            {
                "authenticated": True,
                "user": {"login": session.get("login")},
                "expiresAt": session.get("expiresAt"),
            },
        )

    def _cms_content(self):
        """Живой снимок для админки (локально = assets/content.json)."""
        try:
            if CONTENT_FILE.is_file():
                data = json.loads(CONTENT_FILE.read_text(encoding="utf-8"))
            else:
                data = {}
        except Exception:
            data = {}
        if not isinstance(data, dict):
            data = {}
        return self._json_response(200, data)

    def _cms_leads(self):
        """Список локальных заявок для панели «Заявки» в админке."""
        if not self._auth_session():
            return self._json_response(401, {"ok": False, "error": "unauthorized"})
        leads = []
        if LEADS_LOG.is_file():
            try:
                lines = LEADS_LOG.read_text(encoding="utf-8").splitlines()
            except Exception:
                lines = []
            for line in reversed(lines[-80:]):
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except Exception:
                    continue
                if not isinstance(row, dict):
                    continue
                leads.append(
                    {
                        "id": row.get("id") or "",
                        "createdAt": row.get("createdAt") or row.get("at") or None,
                        "name": row.get("name") or "",
                        "phone": row.get("phone") or "",
                        "service": row.get("service") or "",
                        "page": row.get("page") or "",
                        "notification": row.get("notification")
                        or {
                            "status": "sent"
                            if row.get("telegram") is True
                            else ("pending" if row.get("telegram") is False else "unknown")
                        },
                    }
                )
        return self._json_response(200, {"ok": True, "leads": leads[:50]})

    def _cms_upload(self):
        """Save compressed doctor/site photo into site/assets/uploads/."""
        import base64
        import re

        try:
            data = self._read_json()
        except Exception:
            return self._json_response(400, {"ok": False, "error": "Некорректный JSON"})

        if not self._require_cms_auth(data):
            return self._json_response(401, {"ok": False, "error": "Нет доступа"})

        image = str((data or {}).get("image") or "")
        m = re.match(r"^data:(image/(?:jpeg|jpg|png|webp|gif));base64,(.+)$", image, re.I | re.S)
        if not m:
            return self._json_response(400, {"ok": False, "error": "Нужен data URL изображения"})

        mime = m.group(1).lower().replace("image/jpg", "image/jpeg")
        try:
            raw = base64.b64decode(m.group(2), validate=False)
        except Exception:
            return self._json_response(400, {"ok": False, "error": "Битые данные изображения"})

        if len(raw) > 900_000:
            return self._json_response(413, {"ok": False, "error": "Файл слишком большой после сжатия"})

        ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}.get(
            mime, ".jpg"
        )
        UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        name = secrets.token_hex(8) + ext
        path = UPLOADS_DIR / name
        path.write_bytes(raw)
        # Абсолютный путь от корня сайта — иначе на /uslugi/... относительный
        # assets/uploads/... превращается в /uslugi/assets/uploads/... и ломается.
        return self._json_response(200, {"ok": True, "url": "/assets/uploads/" + name})

    def _cms_doctor_rating(self):
        """Найти рейтинг врача на ПроДокторов / DocDoc / Зуб.ру и вернуть лучший."""
        import sys

        try:
            data = self._read_json()
        except Exception:
            return self._json_response(400, {"ok": False, "error": "Некорректный JSON"})

        if not self._require_cms_auth(data):
            return self._json_response(401, {"ok": False, "error": "Нет доступа"})

        name = str((data or {}).get("name") or "").strip()
        photo = str((data or {}).get("photo") or "").strip()
        photo_local = None
        if photo:
            # Локальные загрузки админки: assets/uploads/... или /assets/...
            rel = photo.split("?", 1)[0].lstrip("/")
            if rel.startswith("assets/"):
                p = SITE / rel
                if p.is_file():
                    try:
                        photo_local = p.read_bytes()
                    except Exception:
                        photo_local = None

        if str(ROOT) not in sys.path:
            sys.path.insert(0, str(ROOT))
        try:
            from api.doctor_rating import lookup_doctor_rating
        except Exception as e:
            return self._json_response(500, {"ok": False, "error": "Модуль поиска недоступен: " + str(e)})

        try:
            result = lookup_doctor_rating(
                name,
                photo=None if photo_local else photo,
                photo_local=photo_local,
            )
        except Exception as e:
            return self._json_response(500, {"ok": False, "error": "Ошибка поиска: " + str(e)})
        return self._json_response(200, result)

    def _save_content(self):
        try:
            data = self._read_json()
        except Exception:
            return self._json_response(400, {"ok": False, "error": "Некорректный JSON"})

        if not _cms_configured():
            return self._json_response(
                500,
                {"ok": False, "error": "Не заданы CMS_LOGIN / CMS_PASSWORD_HASH в .env"},
            )

        if not self._require_cms_auth(data):
            return self._json_response(401, {"ok": False, "error": "Нет доступа"})

        content = data.get("content") if isinstance(data, dict) else None
        if content is None:
            return self._json_response(400, {"ok": False, "error": "Нет поля content"})

        saved_at = datetime.now(timezone.utc).isoformat()
        revision = ""
        if isinstance(content, dict):
            content["savedAt"] = saved_at
            revision = str(content.get("revision") or "").strip() or _sha256(saved_at)[:16]
            content["revision"] = revision

        CONTENT_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = CONTENT_FILE.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(content, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, CONTENT_FILE)

        # Синхронизируем статику: посетители больше не тянут cms.js
        try:
            self._sync_prices_html(content)
        except Exception as e:
            print("[cms] prices.html sync failed:", e)
        try:
            self._sync_index_text_items(content)
        except Exception as e:
            print("[cms] index.html text sync failed:", e)
        try:
            self._sync_index_reels(content)
        except Exception as e:
            print("[cms] index.html reels sync failed:", e)
        try:
            self._sync_index_doctors(content)
        except Exception as e:
            print("[cms] index.html doctors sync failed:", e)

        return self._json_response(
            200,
            {"ok": True, "saved": "assets/content.json", "savedAt": saved_at, "revision": revision},
        )

    def _sync_index_text_items(self, content):
        """Вшить data-cms-text из снимка в index.html (публичная статика без cms.js)."""
        import re

        if not isinstance(content, dict):
            return
        items = content.get("textItems")
        if not isinstance(items, list):
            return
        index_path = SITE / "index.html"
        if not index_path.is_file():
            return
        html = index_path.read_text(encoding="utf-8")
        changed = 0
        for item in items:
            if not isinstance(item, dict):
                continue
            sel = str(item.get("sel") or "")
            body = item.get("html")
            if not isinstance(body, str):
                continue
            m = re.fullmatch(r'\[data-cms-text="([^"]+)"\]', sel)
            if not m:
                continue
            key = m.group(1)
            pattern = re.compile(
                rf'(<(?:h[1-6]|p|div|span|small|b|li)[^>]*\bdata-cms-text="{re.escape(key)}"[^>]*>)'
                rf'([\s\S]*?)'
                rf'(</(?:h[1-6]|p|div|span|small|b|li)>)',
                re.I,
            )
            new_html, n = pattern.subn(rf"\g<1>{body}\g<3>", html, count=1)
            if n:
                html = new_html
                changed += 1
        if not changed:
            return
        tmp = index_path.with_suffix(".html.tmp")
        tmp.write_text(html, encoding="utf-8")
        os.replace(tmp, index_path)

    def _sync_index_doctors(self, content):
        """Вшить врачей из снимка в .doc-grid на главной (публичная статика)."""
        if not isinstance(content, dict):
            return
        doctors = content.get("doctors")
        if not isinstance(doctors, list) or not doctors:
            return
        index_path = SITE / "index.html"
        if not index_path.is_file():
            return
        html = index_path.read_text(encoding="utf-8")
        start = html.find('<div class="doc-grid"')
        if start < 0:
            return
        open_end = html.find(">", start)
        if open_end < 0:
            return

        def esc(value: str) -> str:
            return (
                str(value or "")
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace('"', "&quot;")
            )

        docs_v = max(int(content.get("docsV") or 0), 7)
        cards = []
        for d in doctors:
            if not isinstance(d, dict):
                continue
            doc_id = str(d.get("id") or "")
            if not doc_id or doc_id == "massud" or d.get("cardHidden"):
                continue
            name = d.get("name") or "Врач"
            cards.append(
                f'<article class="doc reveal" data-doc="{esc(doc_id)}">'
                f'<div class="doc-photo"><img src="{esc(d.get("src") or d.get("photo") or "")}" '
                f'alt="{esc(name)}" loading="lazy" decoding="async"></div>'
                f'<div class="doc-body"><div class="role">{esc(d.get("role") or "")}</div>'
                f"<h3>{esc(name)}</h3>"
                f'<div class="exp">{esc(d.get("exp") or "")}</div></div></article>'
            )
        if not cards:
            return

        # Парный </div> по глубине — внутри карточек много вложенных div
        depth = 1
        i = open_end + 1
        close = -1
        while i < len(html) and depth > 0:
            next_open = html.find("<div", i)
            next_close = html.find("</div>", i)
            if next_close < 0:
                return
            if next_open >= 0 and next_open < next_close:
                depth += 1
                i = next_open + 4
            else:
                depth -= 1
                if depth == 0:
                    close = next_close
                    break
                i = next_close + 6
        if close < 0:
            return

        new_block = (
            f'<div class="doc-grid" data-docs-v="{docs_v}">\n      '
            + "\n      ".join(cards)
            + "\n    </div>"
        )
        html = html[:start] + new_block + html[close + len("</div>") :]
        tmp = index_path.with_suffix(".html.tmp")
        tmp.write_text(html, encoding="utf-8")
        os.replace(tmp, index_path)

    def _sync_index_reels(self, content):
        """Проставить data-video и hidden у #reels по снимку CMS."""
        import re

        if not isinstance(content, dict):
            return
        reels = content.get("reels")
        if not isinstance(reels, list):
            reels = []
        index_path = SITE / "index.html"
        if not index_path.is_file():
            return
        html = index_path.read_text(encoding="utf-8")
        has_video = any(
            isinstance(r, dict) and str(r.get("video") or "").strip() for r in reels
        )
        html = re.sub(
            r'<section class="pad" id="reels"[^>]*>',
            '<section class="pad" id="reels">'
            if has_video
            else '<section class="pad" id="reels" hidden>',
            html,
            count=1,
        )

        def esc_attr(value: str) -> str:
            return (
                value.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace('"', "&quot;")
            )

        idx = {"i": 0}

        def repl_btn(match: re.Match) -> str:
            item = reels[idx["i"]] if idx["i"] < len(reels) else {}
            idx["i"] += 1
            video = ""
            if isinstance(item, dict):
                video = str(item.get("video") or "").strip()
            if video:
                return f'<button class="reel" data-video="{esc_attr(video)}"'
            return '<button class="reel" data-video="" hidden'

        html2, n = re.subn(
            r'<button class="reel" data-video="[^"]*"(?:\s+hidden)?',
            repl_btn,
            html,
        )
        if n:
            html = html2
        tmp = index_path.with_suffix(".html.tmp")
        tmp.write_text(html, encoding="utf-8")
        os.replace(tmp, index_path)

    def _sync_prices_html(self, content):
        """Пишет /assets/prices.json и оставляет prices.html оболочкой без огромного списка."""
        if not isinstance(content, dict):
            return
        services = content.get("services")
        if not isinstance(services, list) or not services:
            return

        prices_json = SITE / "assets" / "prices.json"
        prices_json.parent.mkdir(parents=True, exist_ok=True)
        tmp_json = prices_json.with_suffix(".json.tmp")
        tmp_json.write_text(
            json.dumps({"v": 1, "services": services}, ensure_ascii=False, separators=(",", ":"))
            + "\n",
            encoding="utf-8",
        )
        os.replace(tmp_json, prices_json)

        prices_path = SITE / "prices.html"
        if not prices_path.exists():
            return
        html = prices_path.read_text(encoding="utf-8")
        marker = 'class="price-list"'
        start = html.find(marker)
        if start < 0:
            return
        tag_start = html.rfind("<", 0, start)
        open_end = html.find(">", start)
        if tag_start < 0 or open_end < 0:
            return
        inner_start = open_end + 1
        empty_pos = html.find('<div class="price-empty"', inner_start)
        if empty_pos < 0:
            empty_pos = html.find("</div>", inner_start)
            if empty_pos < 0:
                return
        open_tag = html[tag_start : open_end + 1]
        if "data-prices-src=" not in open_tag:
            open_tag = open_tag.replace(
                'class="price-list"',
                'class="price-list" data-prices-src="/assets/prices.json"',
            )
        new_html = (
            html[:tag_start]
            + open_tag
            + "\n      <!-- прайс подгружается из /assets/prices.json (main.js) -->\n      "
            + html[empty_pos:]
        )
        tmp = prices_path.with_suffix(".html.tmp")
        tmp.write_text(new_html, encoding="utf-8")
        os.replace(tmp, prices_path)

    def _save_lead(self):
        """Local stand-in for api/lead.php while developing with python3 server.py."""
        try:
            data = self._read_json()
        except Exception:
            return self._json_response(400, {"ok": False, "error": "bad_json"})

        if not isinstance(data, dict):
            return self._json_response(400, {"ok": False, "error": "bad_json"})

        # honeypot
        if str(data.get("company") or "").strip():
            return self._json_response(200, {"ok": True})

        name = str(data.get("name") or "").strip()[:80]
        phone = str(data.get("phone") or "").strip()[:40]
        service = str(data.get("service") or "").strip()[:120]
        page = str(data.get("page") or "").strip()[:300]

        if len(name) < 2 or len(phone) < 5:
            return self._json_response(400, {"ok": False, "error": "validation"})

        created_at = datetime.now(timezone.utc).isoformat()
        lead_id = secrets.token_hex(8)
        text = (
            "Новая заявка с сайта АмирДент\n"
            f"Имя: {name}\n"
            f"Телефон: {phone}\n"
            f"Услуга: {service or '—'}\n"
            f"Страница: {page or '—'}"
        )
        token, chat = _load_telegram_config()
        telegram_ok = False
        if token and chat:
            telegram_ok = _send_telegram(token, chat, text)

        notification_status = "sent" if telegram_ok else "pending"
        entry = {
            "id": lead_id,
            "at": created_at,
            "createdAt": created_at,
            "name": name,
            "phone": phone,
            "service": service,
            "page": page,
            "telegram": telegram_ok,
            "notification": {"status": notification_status},
        }
        LEADS_LOG.parent.mkdir(parents=True, exist_ok=True)
        with LEADS_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

        print(f"[lead] stored locally; telegram={'ok' if telegram_ok else 'skip'}")
        code = 200 if telegram_ok else 202
        return self._json_response(
            code,
            {
                "ok": True,
                "id": lead_id,
                "notification": notification_status,
                "telegram": telegram_ok,
                "local": True,
            },
        )

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))


def main():
    if not CONTENT_FILE.exists():
        CONTENT_FILE.write_text("{}\n", encoding="utf-8")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"AmirDent server: http://{HOST}:{PORT}")
    print(f"Admin login:     http://{HOST}:{PORT}/admin.html")
    if _cms_configured():
        print(f"CMS auth:        ok (login={CMS_LOGIN!r})")
    else:
        print("CMS auth:        NOT CONFIGURED")
        print("  Создайте .env в корне проекта:")
        print("    CMS_LOGIN=ваш_логин")
        print("    CMS_PASSWORD_HASH=<sha256 от пароля>")
        print("  Хеш пароля:")
        print("    python3 -c \"import hashlib,sys; print(hashlib.sha256(sys.argv[1].encode()).hexdigest())\" 'ПАРОЛЬ'")
        print("  Пример — см. .env.example")
    print("Local leads -> api/leads-local.log  (Telegram optional via api/config.local.json)")
    print("Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped")
        server.server_close()


if __name__ == "__main__":
    main()
