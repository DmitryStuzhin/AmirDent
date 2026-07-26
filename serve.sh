#!/bin/sh
# Запуск сайта на своём компьютере: ./serve.sh
# Открыть http://localhost:8123

set -e
cd "$(dirname "$0")"

PORT="${PORT:-8123}"

if ! command -v php >/dev/null 2>&1; then
  echo "Не найден PHP — он нужен, чтобы работала отправка заявок в Telegram."
  echo "Установить: brew install php"
  exit 1
fi

if [ ! -f api/config.php ]; then
  echo "Нет файла api/config.php — заявки в Telegram уходить не будут."
  echo "Создайте его по образцу:  cp api/config.example.php api/config.php"
  echo "и впишите токен бота и chat_id (подробности в api/README.md)."
  echo ""
fi

echo "Сайт: http://localhost:$PORT"
echo "Остановить: Ctrl+C"
echo ""
exec php -S "localhost:$PORT" -t .
