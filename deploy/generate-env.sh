#!/usr/bin/env bash
# Генерирует .env для деплоя: случайные JWT_SECRET, ENCRYPTION_KEY; URL приложения 10.76.52.21.
# Использование:
#   ./deploy/generate-env.sh [db_host]   # db_host по умолчанию postgres (для docker-compose)
#   ./deploy/generate-env.sh localhost   # если Postgres на той же машине без Docker
# Вывод в stdout — сохранить в .env: ./deploy/generate-env.sh > .env

set -e
DB_HOST="${1:-postgres}"
APP_HOST="${APP_HOST:-10.76.52.21}"
APP_PORT="${APP_PORT:-3000}"
BASE_URL="http://${APP_HOST}:${APP_PORT}"

# Случайные секреты (openssl есть в Alpine и Debian)
JWT_SECRET="$(openssl rand -base64 32)"
ENCRYPTION_KEY="$(openssl rand -base64 32)"

cat << EOF
# Сгенерировано deploy/generate-env.sh
DATABASE_URL="postgresql://postgres:password@${DB_HOST}:5432/rocketchat_scheduler"
JWT_SECRET="${JWT_SECRET}"
ENCRYPTION_KEY="${ENCRYPTION_KEY}"
CRON_SECRET=""
HEALTH_CHECK_SECRET=""
COOKIE_SECURE="false"
NEXT_PUBLIC_APP_URL="${BASE_URL}"
APP_URL="${BASE_URL}"
EOF
