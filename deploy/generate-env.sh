#!/usr/bin/env bash
# Генерирует .env для деплоя: случайные JWT_SECRET, ENCRYPTION_KEY, CRON_SECRET, HEALTH_CHECK_SECRET,
# пароль PostgreSQL; URL приложения.
# Использование:
#   ./deploy/generate-env.sh [db_host]   # db_host по умолчанию postgres (для docker-compose)
#   APP_HOST=sheduler.yar.21-school.ru ./deploy/generate-env.sh > .env
# Вывод в stdout — сохранить в .env с правами только для владельца:
#   (umask 077; ./deploy/generate-env.sh > .env)
# ВНИМАНИЕ: не перегенерируйте .env на работающей инсталляции — смена ENCRYPTION_KEY сделает
# сохранённые пароли/токены Rocket.Chat нерасшифровываемыми, а POSTGRES_PASSWORD не применится
# к уже созданному volume БД.

set -euo pipefail
DB_HOST="${1:-postgres}"
APP_HOST="${APP_HOST:-sheduler.yar.21-school.ru}"
APP_PROTOCOL="${APP_PROTOCOL:-https}"
# Для https порт 443 не указываем в URL
APP_PORT="${APP_PORT:-443}"
BASE_URL="${APP_PROTOCOL}://${APP_HOST}$( { [ "${APP_PORT}" = "80" ] || [ "${APP_PORT}" = "443" ]; } && echo "" || echo ":${APP_PORT}")"

# Случайные секреты (openssl есть в Alpine и Debian); 32 байта = 256 бит энтропии
JWT_SECRET="$(openssl rand -base64 32)"
ENCRYPTION_KEY="$(openssl rand -base64 32)"
CRON_SECRET="$(openssl rand -hex 32)"
HEALTH_CHECK_SECRET="$(openssl rand -hex 32)"
# hex — без символов, требующих URL-экранирования в DATABASE_URL
POSTGRES_PASSWORD="$(openssl rand -hex 24)"

cat << ENVEOF
# Сгенерировано deploy/generate-env.sh — храните с правами 600, не коммитьте.
POSTGRES_PASSWORD="${POSTGRES_PASSWORD}"
DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@${DB_HOST}:5432/rocketchat_scheduler"
JWT_SECRET="${JWT_SECRET}"
ENCRYPTION_KEY="${ENCRYPTION_KEY}"
CRON_SECRET="${CRON_SECRET}"
HEALTH_CHECK_SECRET="${HEALTH_CHECK_SECRET}"
COOKIE_SECURE="true"
NEXT_PUBLIC_APP_URL="${BASE_URL}"
APP_URL="${BASE_URL}"
# Сколько обратных прокси перед приложением (nginx/Caddy = 1; Cloudflare + nginx = 2)
TRUSTED_PROXY_HOPS="1"
# Порт 4001 только для прокси на этом хосте (уберите, если нужен прямой доступ http://IP:4001)
APP_BIND_ADDRESS="127.0.0.1"
ENVEOF
