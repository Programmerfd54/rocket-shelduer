#!/usr/bin/env bash
# Запуск деплоя из корня репо: ./deploy/up.sh
# Генерирует .env (если ещё нет), собирает образы и поднимает postgres + app.

set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Генерация .env..."
  # .env содержит секреты — доступ только владельцу
  (umask 077 && bash ./deploy/generate-env.sh > .env)
  echo "Создан .env. При необходимости отредактируйте APP_HOST (по умолчанию sheduler.yar.21-school.ru)."
fi
chmod 600 .env 2>/dev/null || true

echo "Запуск контейнеров..."
# --env-file: подстановка POSTGRES_PASSWORD / APP_BIND_ADDRESS в deploy/docker-compose.yml из корневого .env
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build

echo "Готово. Приложение: https://sheduler.yar.21-school.ru (порт 4001)."
echo "Первый вход: логин admin, временный пароль — в логе контейнера app:"
echo "  docker compose --env-file .env -f deploy/docker-compose.yml logs app | grep -A1 'Временный пароль'"
