#!/usr/bin/env bash
# Общие функции для deploy/update.sh и deploy/rollback.sh. Не запускается напрямую.
# shellcheck shell=bash

# ---------- вывод ----------
if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'; C_DIM=$'\033[2m'; C_BLD=$'\033[1m'; C_OFF=$'\033[0m'
else
  C_RED=""; C_GRN=""; C_YEL=""; C_DIM=""; C_BLD=""; C_OFF=""
fi
step() { printf '\n%s▶ %s%s\n' "$C_BLD" "$*" "$C_OFF"; }
ok()   { printf '  %s✓%s %s\n' "$C_GRN" "$C_OFF" "$*"; }
info() { printf '  %s%s%s\n' "$C_DIM" "$*" "$C_OFF"; }
warn() { printf '  %s⚠ %s%s\n' "$C_YEL" "$*" "$C_OFF" >&2; }
die()  { printf '\n%s✗ %s%s\n' "$C_RED" "$*" "$C_OFF" >&2; exit 1; }

# Подтверждение (y/N). При --yes (ASSUME_YES=1) отвечает «да». Без TTY — «нет».
confirm() {
  local prompt="$1"
  if [ "${ASSUME_YES:-0}" = "1" ]; then return 0; fi
  if [ ! -t 0 ]; then return 1; fi
  local ans
  read -r -p "  $prompt [y/N] " ans || return 1
  [ "$ans" = "y" ] || [ "$ans" = "Y" ] || [ "$ans" = "д" ] || [ "$ans" = "Д" ]
}

# ---------- .env ----------
# Значение переменной из .env без `source` (в значениях могут быть пробелы/спецсимволы). Последнее вхождение побеждает.
env_get() {
  local key="$1" line
  line=$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$ENV_FILE" 2>/dev/null | tail -n 1) || true
  [ -z "$line" ] && return 0
  line="${line#*=}"
  # убрать обрамляющие кавычки и хвостовые пробелы
  line="${line%"${line##*[![:space:]]}"}"
  case "$line" in
    \"*\") line="${line#\"}"; line="${line%\"}" ;;
    \'*\') line="${line#\'}"; line="${line%\'}" ;;
  esac
  printf '%s' "$line"
}

is_weak_secret() {
  local v
  v=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
  case "$v" in
    ""|"your-secret-key"|"default-secret-key"|"changeme"|"change-me"|"secret"|"password"|"admin"|"test"|"jwt_secret"|"jwt-secret"|"your-jwt-secret"|"your_secret_key") return 0 ;;
  esac
  return 1
}

# ---------- docker compose ----------
detect_compose() {
  command -v docker >/dev/null 2>&1 || die "Docker не найден. Установите Docker и Docker Compose."
  docker compose version >/dev/null 2>&1 || die "Нужен плагин «docker compose» (v2)."
  docker info >/dev/null 2>&1 || die "Docker-демон недоступен (запущен ли он? есть ли права у пользователя?)."
}

# dc — docker compose с нужным файлом и без интерактивщины
dc() { docker compose -f "$COMPOSE_FILE" "$@"; }

# Имя сервиса приложения в compose-файле: web (корневой docker-compose.yml) или app (deploy/docker-compose.yml)
detect_app_service() {
  local services
  services=$(dc config --services 2>/dev/null) || die "Не удалось прочитать $COMPOSE_FILE (docker compose config). Проверьте файл и .env."
  if printf '%s\n' "$services" | grep -qx "web"; then APP_SERVICE=web
  elif printf '%s\n' "$services" | grep -qx "app"; then APP_SERVICE=app
  else die "В $COMPOSE_FILE нет сервиса web/app."; fi
}

# ---------- резервная копия БД ----------
# Строка подключения без параметров запроса (pg_dump/psql не понимают ?schema=public из Prisma)
clean_db_url() { printf '%s' "${1%%\?*}"; }

# Запуск pg-утилиты (pg_dump/psql) доступными способами. Аргументы: <команда> <url> [доп. аргументы...]
# Вход/выход — через переменные PG_IN (файл для stdin, по умолчанию /dev/null) и PG_OUT (файл для stdout, по умолчанию
# /dev/null); каждая попытка перезаписывает PG_OUT с нуля, поэтому обрывки неудачной попытки в итог не попадают.
# Порядок: утилита на хосте → контейнер postgres из compose → одноразовый контейнер в сети приложения
# (последний видит БД ровно так же, как приложение, даже если host = host.docker.internal / имя сервиса).
run_pg_tool() {
  local tool="$1" url="$2"; shift 2
  local in="${PG_IN:-/dev/null}" out="${PG_OUT:-/dev/null}" cid="${APP_CID:-}" err="$DEPLOY_DIR/pg-tool.err"
  : > "$err"
  # 1) утилита на хосте
  if command -v "$tool" >/dev/null 2>&1; then
    if "$tool" "$url" "$@" <"$in" >"$out" 2>>"$err"; then return 0; fi
  fi
  # 2) контейнер postgres из этого compose (встроенная БД)
  local pgcid
  pgcid=$(dc ps -q postgres 2>/dev/null | head -n 1) || true
  if [ -n "$pgcid" ]; then
    if docker exec -i "$pgcid" "$tool" "$url" "$@" <"$in" >"$out" 2>>"$err"; then return 0; fi
  fi
  # 3) одноразовый контейнер в сети приложения (запущенный контейнер приложения или сеть compose-проекта)
  local net=""
  if [ -n "$cid" ] && [ "$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null)" = "true" ]; then
    net="container:$cid"
  elif [ -n "${COMPOSE_PROJECT_NAME:-}" ] && docker network inspect "${COMPOSE_PROJECT_NAME}_default" >/dev/null 2>&1; then
    net="${COMPOSE_PROJECT_NAME}_default"
  fi
  if [ -n "$net" ]; then
    local image="${PG_TOOLS_IMAGE:-}"
    if [ -z "$image" ]; then
      image=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^postgres:[0-9]+' | sort -t: -k2 -V | tail -n 1) || true
      [ -z "$image" ] && image="postgres:17-alpine"
    fi
    if docker run --rm -i --network "$net" "$image" "$tool" "$url" "$@" <"$in" >"$out" 2>>"$err"; then return 0; fi
  fi
  return 1
}

# ---------- проверка здоровья ----------
# Ждёт, пока контейнер станет healthy (или просто запустится, если healthcheck отсутствует).
wait_healthy() {
  local cid="$1" timeout="${2:-240}" waited=0 status restarting
  while [ "$waited" -lt "$timeout" ]; do
    status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo "gone")
    restarting=$(docker inspect -f '{{.State.Restarting}}' "$cid" 2>/dev/null || echo "false")
    case "$status" in
      healthy) return 0 ;;
      gone) return 2 ;;
    esac
    if [ "$restarting" = "true" ]; then return 3; fi
    if [ "$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null)" != "true" ]; then return 4; fi
    sleep 3; waited=$((waited + 3))
    printf '.'
  done
  return 1
}
