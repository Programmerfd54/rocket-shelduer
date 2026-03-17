#!/usr/bin/env bash
# Генерирует .env для деплоя: случайные JWT_SECRET, ENCRYPTION_KEY; URL приложения.
# Использование:
#   ./deploy/generate-env.sh [db_host]   # db_host по умолчанию postgres (для docker-compose)
#   APP_HOST=sheduler.yar.21-school.ru ./deploy/generate-env.sh > .env
# Вывод в stdout — сохранить в .env: ./deploy/generate-env.sh > .env

set -e
DB_HOST="${1:-postgres}"
APP_HOST="${APP_HOST:-sheduler.yar.21-school.ru}"
APP_PROTOCOL="${APP_PROTOCOL:-https}"
# Для https порт 443 не указываем в URL
APP_PORT="${APP_PORT:-443}"
BASE_URL="${APP_PROTOCOL}://${APP_HOST}$([ "${APP_PORT}" = "80" ] || [ "${APP_PORT}" = "443" ] && echo "" || echo ":${APP_PORT}")"

# Случайные секреты (openssl есть в Alpine и Debian)
JWT_SECRET="$(openssl rand -base64 32)"
ENCRYPTION_KEY="$(openssl rand -base64 32)"
CRON_SECRET="$(openssl rand -base64 32)"
HEALTH_CHECK_SECRET="$(openssl rand -base64 32)"

cat << EOF
# Сгенерировано deploy/generate-env.sh
DATABASE_URL="postgresql://postgres:password@${DB_HOST}:5432/rocketchat_scheduler"
JWT_SECRET="${JWT_SECRET}"
ENCRYPTION_KEY="${ENCRYPTION_KEY}"
CRON_SECRET="${CRON_SECRET}"
HEALTH_CHECK_SECRET="${HEALTH_CHECK_SECRET}"
COOKIE_SECURE="true"
NEXT_PUBLIC_APP_URL="${BASE_URL}"
APP_URL="${BASE_URL}"
EOF
