#!/usr/bin/env bash
# Запуск деплоя из корня репо: ./deploy/up.sh
# Генерирует .env (если ещё нет), собирает образы и поднимает postgres + app.

set -e
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Генерация .env..."
  ./deploy/generate-env.sh > .env
  echo "Создан .env. При необходимости отредактируйте APP_HOST (по умолчанию sheduler.yar.21-school.ru)."
fi

echo "Запуск контейнеров..."
docker compose -f deploy/docker-compose.yml up -d --build

echo "Готово. Приложение: https://sheduler.yar.21-school.ru (порт 4001, логин admin / admin)."
