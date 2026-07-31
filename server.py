#!/usr/bin/env python3
"""AmirDent static server + CMS save API + local lead intake.

Run:  python3 server.py
Site: http://localhost:8080
Admin: http://localhost:8080/admin.html
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
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

# Устаревший локальный сервер не должен иметь встроенных реквизитов.
# Для админки используйте `npm run dev`, который запускает реальные Netlify Functions.
PASS_HASH = os.environ.get("CMS_PASSWORD_HASH", "").strip().lower()
CMS_LOGIN = os.environ.get("CMS_LOGIN", "").strip()


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
        if (
            path.startswith("/assets/content.json")
            or path.startswith("/api/")
            or path.startswith("/assets/cms")
            or path.endswith("/service.js")
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
        # Как на Netlify: /uslugi/<направление> отдаёт service.html,
        # а адрес в браузере остаётся читаемым (не редирект).
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        if path == "/uslugi" or path.startswith("/uslugi/"):
            qs = ("?" + parsed.query) if parsed.query else ""
            self.path = "/service.html" + qs
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        if path == "/api/cms/save":
            return self._save_content()
        if path == "/api/cms/login":
            return self._cms_login()
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

    def _json_response(self, code: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _cms_login(self):
        try:
            data = self._read_json()
        except Exception:
            return self._json_response(400, {"ok": False, "error": "Некорректный JSON"})

        login = str((data or {}).get("login") or "").strip()
        token = (
            self.headers.get("X-CMS-Token")
            or (data.get("token") if isinstance(data, dict) else None)
            or ""
        ).strip().lower()

        if login != CMS_LOGIN or token != PASS_HASH:
            return self._json_response(401, {"ok": False, "error": "Неверный логин или пароль"})
        return self._json_response(200, {"ok": True})

    def _cms_upload(self):
        """Save compressed doctor/site photo into site/assets/uploads/."""
        import base64
        import re
        import secrets

        try:
            data = self._read_json()
        except Exception:
            return self._json_response(400, {"ok": False, "error": "Некорректный JSON"})

        token = (
            self.headers.get("X-CMS-Token")
            or (data.get("token") if isinstance(data, dict) else None)
            or ""
        ).strip().lower()
        if token != PASS_HASH:
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

        token = (
            self.headers.get("X-CMS-Token")
            or (data.get("token") if isinstance(data, dict) else None)
            or ""
        ).strip().lower()
        if token != PASS_HASH:
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

        token = (
            self.headers.get("X-CMS-Token")
            or (data.get("token") if isinstance(data, dict) else None)
            or ""
        ).strip().lower()

        if not PASS_HASH:
            return self._json_response(
                500,
                {"ok": False, "error": "Не задана переменная CMS_PASSWORD_HASH"},
            )

        if token != PASS_HASH:
            return self._json_response(401, {"ok": False, "error": "Нет доступа"})

        content = data.get("content") if isinstance(data, dict) else None
        if content is None:
            return self._json_response(400, {"ok": False, "error": "Нет поля content"})

        CONTENT_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = CONTENT_FILE.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(content, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, CONTENT_FILE)

        # Синхронизируем prices.html, иначе удалённые услуги возвращаются из статики
        try:
            self._sync_prices_html(content)
        except Exception as e:
            print("[cms] prices.html sync failed:", e)

        return self._json_response(200, {"ok": True, "saved": "assets/content.json"})

    def _sync_prices_html(self, content):
        if not isinstance(content, dict):
            return
        price_html = content.get("priceHtml")
        if not price_html and isinstance(content.get("services"), list):
            # Соберём HTML из services, если priceHtml нет
            parts = []
            for s in content["services"]:
                if not isinstance(s, dict):
                    continue
                name = str(s.get("name") or "Услуга")
                tag = str(s.get("tag") or "")
                price = str(s.get("price") or "")
                cat = str(s.get("cat") or "therapy")
                subcat = str(s.get("subcat") or "")
                doctor = str(s.get("doctor") or "")

                def esc(t: str) -> str:
                    return (
                        t.replace("&", "&amp;")
                        .replace("<", "&lt;")
                        .replace('"', "&quot;")
                    )

                attrs = f' data-cat="{esc(cat)}" data-name="{esc(name.lower())}"'
                if subcat:
                    attrs += f' data-subcat="{esc(subcat)}"'
                if doctor:
                    attrs += f' data-doctor="{esc(doctor)}"'
                parts.append(
                    f'<div class="prow"{attrs}>'
                    f'<span class="pn">{esc(name)}</span>'
                    f'<span class="ptag">{esc(tag)}</span>'
                    f'<span class="pp">{esc(price)}</span></div>'
                )
            price_html = "\n".join(parts)
        if not isinstance(price_html, str) or not price_html.strip():
            return

        prices_path = SITE / "prices.html"
        if not prices_path.exists():
            return
        html = prices_path.read_text(encoding="utf-8")
        start = html.find('<div class="price-list">')
        if start < 0:
            return
        inner_start = start + len('<div class="price-list">')
        # price-empty живёт внутри .price-list — сохраняем его
        empty_pos = html.find('<div class="price-empty"', inner_start)
        if empty_pos < 0:
            # запасной: закрывающий тег price-list
            empty_pos = html.find("</div>", inner_start)
            if empty_pos < 0:
                return
        new_html = (
            html[:inner_start]
            + "\n"
            + price_html.strip()
            + "\n      "
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

        entry = {
            "at": datetime.now(timezone.utc).isoformat(),
            "name": name,
            "phone": phone,
            "service": service,
            "page": page,
        }
        LEADS_LOG.parent.mkdir(parents=True, exist_ok=True)
        with LEADS_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

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

        print(f"[lead] stored locally; telegram={'ok' if telegram_ok else 'skip'}")
        return self._json_response(200, {"ok": True, "telegram": telegram_ok, "local": True})

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))


def main():
    if not CONTENT_FILE.exists():
        CONTENT_FILE.write_text("{}\n", encoding="utf-8")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"AmirDent server: http://{HOST}:{PORT}")
    print(f"Admin login:     http://{HOST}:{PORT}/admin.html")
    print("Local leads -> api/leads-local.log  (Telegram optional via api/config.local.json)")
    print("Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped")
        server.server_close()


if __name__ == "__main__":
    main()
