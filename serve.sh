#!/bin/sh
# Запуск сайта на своём компьютере: ./serve.sh
# Открыть http://localhost:8123

set -e
cd "$(dirname "$0")"

PORT="${PORT:-8123}"

# netlify dev поднимает и страницы, и функцию приёма заявок — то же, что на сайте
if [ -x node_modules/.bin/netlify ] || command -v npx >/dev/null 2>&1; then
  echo "Сайт: http://localhost:$PORT   (страницы + приём заявок)"
  echo "Остановить: Ctrl+C"
  echo ""
  exec npx netlify dev --port "$PORT" --offline
fi

echo "Не найден Node.js — без него не запустить функцию приёма заявок."
echo "Установить: https://nodejs.org (нужна версия 20.12.2 или новее)"
echo ""
echo "Посмотреть только вёрстку, без отправки заявок, можно так:"
echo "  python3 -m http.server $PORT"
exit 1
