#!/usr/bin/env bash
# Обновление боевой установки одной командой, без ручного перезапуска контейнеров:
#
#   ./deploy/update.sh                # git pull → проверка .env → бэкап БД → сборка → перезапуск → проверка здоровья
#   ./deploy/update.sh --no-pull      # не делать git pull (код уже на месте)
#   ./deploy/update.sh --skip-backup  # без бэкапа БД (не рекомендуется)
#   ./deploy/update.sh --yes          # не задавать вопросов (для автоматизации)
#   ./deploy/update.sh -f deploy/docker-compose.yml   # другой compose-файл (полный стек deploy/)
#
# Принципы безопасности:
#   • .env НЕ меняется и не перезаписывается; секреты не печатаются.
#   • Новый образ собирается ДО остановки старого контейнера: если сборка упала — всё продолжает работать как прежде.
#   • Перед перезапуском делается дамп БД в backups/ (миграции применяются при старте контейнера автоматически).
#   • Порт, на котором сейчас слушает приложение, сохраняется (прокси продолжит работать без правок).
#   • Загрузки (файлы справки, аватары) из старого контейнера переносятся в постоянные тома.
#   • Если после обновления приложение не стало здоровым — скрипт покажет логи и подскажет ./deploy/rollback.sh.

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
DEPLOY_DIR="$ROOT/.deploy"
BACKUP_DIR="$ROOT/backups"
ENV_FILE="$ROOT/.env"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
DO_PULL=1; SKIP_BACKUP=0; ASSUME_YES=0; HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-300}"

# shellcheck source=deploy/lib.sh
. "$ROOT/deploy/lib.sh"

while [ $# -gt 0 ]; do
  case "$1" in
    --no-pull) DO_PULL=0 ;;
    --skip-backup) SKIP_BACKUP=1 ;;
    -y|--yes) ASSUME_YES=1 ;;
    -f|--file) shift; COMPOSE_FILE="${1:-}"; [ -n "$COMPOSE_FILE" ] || die "После -f нужен путь к compose-файлу." ;;
    -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Неизвестный аргумент: $1 (см. --help)" ;;
  esac
  shift
done
export ASSUME_YES

mkdir -p "$DEPLOY_DIR"; chmod 700 "$DEPLOY_DIR" 2>/dev/null || true
# Защита от одновременного запуска двух обновлений
if ! mkdir "$DEPLOY_DIR/lock" 2>/dev/null; then
  die "Уже выполняется другое обновление (или предыдущее было прервано). Если это не так — удалите каталог .deploy/lock."
fi
UPLOADS_TMP=""
cleanup() { rmdir "$DEPLOY_DIR/lock" 2>/dev/null || true; [ -n "$UPLOADS_TMP" ] && rm -rf "$UPLOADS_TMP" || true; }
trap cleanup EXIT

printf '%sОбновление Rocket.Chat Scheduler%s  (%s)\n' "$C_BLD" "$C_OFF" "$ROOT"

# ───────────────────────────── 1. Окружение ─────────────────────────────
step "1/8 Проверка окружения"
detect_compose
[ -f "$COMPOSE_FILE" ] || die "Не найден compose-файл: $COMPOSE_FILE"
[ -f "$ENV_FILE" ] || die "Не найден .env в $ROOT. Скрипт не создаёт и не меняет .env — положите рабочий файл рядом с docker-compose.yml."
ok "Docker и compose: $(docker compose version --short 2>/dev/null || echo ok); файл: $COMPOSE_FILE"

# ───────────────────────────── 2. Проверка .env ─────────────────────────────
step "2/8 Проверка .env (ничего не меняется)"
JWT="$(env_get JWT_SECRET)"; ENCK="$(env_get ENCRYPTION_KEY)"; DBURL="$(env_get DATABASE_URL)"
PROBLEMS=0
[ -n "$DBURL" ] || { warn "DATABASE_URL не задан в .env"; PROBLEMS=1; }
if is_weak_secret "$JWT"; then warn "JWT_SECRET пуст или является заглушкой — в production приложение не запустится."; PROBLEMS=1; fi
if is_weak_secret "$ENCK"; then warn "ENCRYPTION_KEY пуст или является заглушкой — в production приложение не запустится."; PROBLEMS=1; fi
if [ "$PROBLEMS" -ne 0 ]; then
  die "Исправьте .env и запустите снова. Текущий контейнер НЕ тронут. (ENCRYPTION_KEY на работающей БД менять нельзя — сохранённые пароли Rocket.Chat перестанут расшифровываться.)"
fi
ok "DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY — на месте"
[ "${#JWT}" -ge 32 ] || warn "JWT_SECRET короче 32 символов (рекомендуется openssl rand -base64 32). Смена разлогинит всех пользователей."
[ -n "$(env_get CRON_SECRET)" ] || info "CRON_SECRET не задан: HTTP-эндпоинты /api/cron/* будут закрыты (внутренний cron приложения работает независимо)."
[ -n "$(env_get HEALTH_CHECK_SECRET)" ] || info "HEALTH_CHECK_SECRET не задан: /api/health отвечает без секрета (как раньше). Рекомендуется задать."
if [ -z "$(env_get NEXT_PUBLIC_APP_URL)$(env_get APP_URL)" ]; then
  info "NEXT_PUBLIC_APP_URL/APP_URL не заданы: ссылки-приглашения и проверка Origin опираются на заголовки прокси (Host, X-Forwarded-Proto)."
fi
case "$(env_get COOKIE_SECURE)" in false) info "COOKIE_SECURE=false — cookie без флага Secure (доступ по HTTP).";; esac

# ───────────────────────────── 3. Состояние ─────────────────────────────
step "3/8 Что сейчас запущено"
detect_app_service
COMPOSE_DIR="$(cd "$(dirname "$COMPOSE_FILE")" && pwd)"
APP_CID="$(find_service_container "$COMPOSE_DIR" "$APP_SERVICE")"
# Установка могла быть поднята из полного стека deploy/docker-compose.yml (сервис app) — подхватываем его автоматически
if [ -z "$APP_CID" ] && [ "$COMPOSE_FILE" = "docker-compose.yml" ] && [ -f deploy/docker-compose.yml ] \
   && [ -n "$(find_service_container "$ROOT/deploy" app)" ]; then
  COMPOSE_FILE="deploy/docker-compose.yml"; COMPOSE_DIR="$ROOT/deploy"; detect_app_service
  APP_CID="$(find_service_container "$COMPOSE_DIR" "$APP_SERVICE")"
  info "Найдена установка из deploy/docker-compose.yml — обновляем её."
fi
export APP_CID
OLD_IMAGE_ID=""; OLD_PORT=""; OLD_BIND=""
if [ -n "$APP_CID" ]; then
  OLD_STATE="$(docker inspect -f '{{.State.Status}}' "$APP_CID")"
  OLD_IMAGE_ID="$(docker inspect -f '{{.Image}}' "$APP_CID")"
  PROJECT="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$APP_CID")"
  [ -n "$PROJECT" ] && export COMPOSE_PROJECT_NAME="$PROJECT"
  ok "Найден контейнер приложения ($APP_SERVICE, $OLD_STATE), проект «${PROJECT:-?}»"
  # Опубликованный порт: сохраняем, чтобы прокси продолжал работать без правок
  if grep -q 'APP_PORT' "$COMPOSE_FILE" 2>/dev/null; then
    PUB="$(docker port "$APP_CID" 3000/tcp 2>/dev/null | head -n 1 || true)"   # например 0.0.0.0:3000
    if [ -n "$PUB" ]; then
      OLD_PORT="${PUB##*:}"; OLD_BIND="${PUB%:*}"
      if [ -z "$(env_get APP_PORT)" ]; then export APP_PORT="$OLD_PORT"; info "Порт сохранён: $OLD_PORT (задайте APP_PORT в .env, чтобы изменить)"; fi
      if [ -z "$(env_get APP_BIND_ADDRESS)" ] && [ -n "$OLD_BIND" ] && [ "$OLD_BIND" != "[::]" ]; then export APP_BIND_ADDRESS="$OLD_BIND"; fi
    fi
  fi
  # Дополнительные сервисы, которые уже были в этом проекте (встроенная БД, cron-контейнер), остаются включёнными
  PROFILES=""
  if [ -n "$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=postgres" | head -n 1)" ] && grep -q 'profiles: \["db"\]' "$COMPOSE_FILE"; then PROFILES="db"; fi
  if [ -n "$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=cron" | head -n 1)" ] && grep -q 'profiles: \["cron"\]' "$COMPOSE_FILE"; then PROFILES="${PROFILES:+$PROFILES,}cron"; fi
  [ -n "$PROFILES" ] && { export COMPOSE_PROFILES="${COMPOSE_PROFILES:+$COMPOSE_PROFILES,}$PROFILES"; info "Профили compose: $COMPOSE_PROFILES"; }
else
  info "Контейнера приложения ещё нет — это первый запуск."
fi

# ───────────────────────────── 4. Код ─────────────────────────────
step "4/8 Обновление кода (git)"
PREV_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
if [ "$DO_PULL" = "1" ] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if ! git pull --ff-only; then
    die "git pull --ff-only не удался (локальные правки отслеживаемых файлов или расхождение веток). Контейнер НЕ тронут. Решите конфликт вручную или запустите с --no-pull."
  fi
  NEW_COMMIT="$(git rev-parse --short HEAD)"
  if [ "$PREV_COMMIT" = "$NEW_COMMIT" ]; then ok "Уже актуально: $NEW_COMMIT"; else ok "$PREV_COMMIT → $NEW_COMMIT"; git log --oneline "$PREV_COMMIT..$NEW_COMMIT" | head -n 15 | sed 's/^/    /'; fi
else
  NEW_COMMIT="$PREV_COMMIT"; info "git pull пропущен (текущий коммит: $PREV_COMMIT)"
fi
# Мог измениться compose/.env-зависимые части — перечитываем сервис
detect_app_service

# ───────────────────────────── 5. Бэкап БД ─────────────────────────────
step "5/8 Резервная копия базы данных"
BACKUP_FILE=""
if [ "$SKIP_BACKUP" = "1" ]; then
  warn "Бэкап пропущен по --skip-backup."
else
  mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR" 2>/dev/null || true
  TS="$(date +%Y%m%d-%H%M%S)"; TMP_SQL="$DEPLOY_DIR/dump-$TS.sql"
  CLEAN_URL="$(clean_db_url "$DBURL")"
  PG_OUT="$TMP_SQL"; export PG_OUT
  if run_pg_tool pg_dump "$CLEAN_URL" --clean --if-exists --no-owner --no-privileges && [ -s "$TMP_SQL" ] && grep -q 'PostgreSQL database dump' "$TMP_SQL"; then
    BACKUP_FILE="$BACKUP_DIR/db-$TS-before-$NEW_COMMIT.sql.gz"
    gzip -c "$TMP_SQL" > "$BACKUP_FILE" && gzip -t "$BACKUP_FILE" && chmod 600 "$BACKUP_FILE"
    rm -f "$TMP_SQL"
    ok "Бэкап: ${BACKUP_FILE#"$ROOT"/} ($(du -h "$BACKUP_FILE" | cut -f1))"
    # храним последние 10 копий
    ls -1t "$BACKUP_DIR"/db-*.sql.gz 2>/dev/null | tail -n +11 | xargs -r rm -f 2>/dev/null || true
  else
    rm -f "$TMP_SQL"
    warn "Не удалось сделать дамп БД автоматически (последняя ошибка в .deploy/pg-tool.err)."
    warn "Миграции при старте изменят схему необратимо. Сделайте бэкап вручную (pg_dump) или продолжайте на свой риск."
    confirm "Продолжить БЕЗ бэкапа?" || die "Остановлено. Контейнер не тронут."
  fi
  unset PG_OUT
fi

# ───────────────────────────── 6. Сборка ─────────────────────────────
step "6/8 Сборка нового образа (старый контейнер пока работает)"
# Сохраняем текущий образ под тегом, чтобы к нему можно было вернуться
ROLLBACK_TAG=""
if [ -n "$OLD_IMAGE_ID" ]; then
  ROLLBACK_TAG="rcs-rollback:${PREV_COMMIT}-$(date +%Y%m%d%H%M%S)"
  docker tag "$OLD_IMAGE_ID" "$ROLLBACK_TAG" 2>/dev/null && info "Предыдущий образ сохранён как $ROLLBACK_TAG" || ROLLBACK_TAG=""
fi
if ! dc build; then
  die "Сборка не удалась. Работающий контейнер НЕ тронут. (На сервере без интернета не используйте build --no-cache.)"
fi
ok "Образ собран"

# Загрузки из слоя старого контейнера (если они не лежали в томе) — сохраняем, чтобы вернуть в постоянные тома
UPLOAD_PATHS=("/app/public/help-uploads" "/app/public/uploads/avatars")
if [ -n "$APP_CID" ]; then
  MOUNTS="$(docker inspect -f '{{range .Mounts}}{{.Destination}} {{end}}' "$APP_CID")"
  UPLOADS_TMP="$(mktemp -d "$DEPLOY_DIR/uploads.XXXXXX")"
  SAVED=0
  for p in "${UPLOAD_PATHS[@]}"; do
    case " $MOUNTS " in *" $p "*) continue ;; esac   # уже в томе — переживёт пересоздание
    name="$(basename "$p")"; mkdir -p "$UPLOADS_TMP/$name"
    if docker cp "$APP_CID:$p/." "$UPLOADS_TMP/$name/" 2>/dev/null; then
      n="$(find "$UPLOADS_TMP/$name" -type f | wc -l | tr -d ' ')"; [ "$n" -gt 0 ] && { SAVED=$((SAVED + n)); info "Сохранено файлов из $p: $n"; }
    fi
  done
  [ "$SAVED" -eq 0 ] && info "Файлов для переноса в тома нет."
fi

# ───────────────────────────── 7. Перезапуск ─────────────────────────────
step "7/8 Перезапуск (миграции БД применятся автоматически при старте)"
cat > "$DEPLOY_DIR/last-deploy.env" <<EOF
# Служебный файл deploy/update.sh — используется deploy/rollback.sh
PREV_COMMIT=$PREV_COMMIT
NEW_COMMIT=$NEW_COMMIT
ROLLBACK_TAG=$ROLLBACK_TAG
BACKUP_FILE=${BACKUP_FILE#"$ROOT"/}
COMPOSE_FILE=$COMPOSE_FILE
APP_SERVICE=$APP_SERVICE
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-}
COMPOSE_PROFILES=${COMPOSE_PROFILES:-}
APP_PORT=${APP_PORT:-}
APP_BIND_ADDRESS=${APP_BIND_ADDRESS:-}
EOF
chmod 600 "$DEPLOY_DIR/last-deploy.env"

dc up -d --remove-orphans
NEW_CID="$(dc ps -q "$APP_SERVICE" | head -n 1)"
[ -n "$NEW_CID" ] || die "Контейнер приложения не создан. Смотрите: docker compose logs"
IMAGE_NAME="$(docker inspect -f '{{.Config.Image}}' "$NEW_CID")"
printf 'APP_IMAGE_NAME=%s\n' "$IMAGE_NAME" >> "$DEPLOY_DIR/last-deploy.env"

# Возвращаем загрузки в тома и выставляем владельца процесса приложения (uid 1001).
# У контейнера приложения отброшены все capabilities (cap_drop: ALL), поэтому даже root внутри него не может менять
# владельца файлов — делаем это одноразовым контейнером с явным CAP_CHOWN, примонтировав сам том.
if [ -n "$UPLOADS_TMP" ] && [ "${SAVED:-0}" -gt 0 ]; then
  for p in "${UPLOAD_PATHS[@]}"; do
    name="$(basename "$p")"
    [ -d "$UPLOADS_TMP/$name" ] && [ -n "$(find "$UPLOADS_TMP/$name" -type f -print -quit)" ] || continue
    VOL="$(docker inspect -f "{{range .Mounts}}{{if eq .Destination \"$p\"}}{{.Name}}{{end}}{{end}}" "$NEW_CID")"
    if [ -n "$VOL" ]; then
      if docker run --rm -u 0 --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --entrypoint sh \
           -v "$UPLOADS_TMP/$name":/src:ro -v "$VOL":/dst "$IMAGE_NAME" \
           -c 'cp -a /src/. /dst/ && chown -R 1001:1001 /dst' 2>>"$DEPLOY_DIR/pg-tool.err"; then
        ok "Загрузки возвращены в том ($name)"
      else
        warn "Не удалось вернуть файлы в том для $p (детали: .deploy/pg-tool.err). Файлы сохранены в $UPLOADS_TMP — скопируйте вручную."; UPLOADS_TMP=""
      fi
    else
      docker cp "$UPLOADS_TMP/$name/." "$NEW_CID:$p/" 2>/dev/null && ok "Загрузки возвращены ($name)" || warn "Не удалось вернуть файлы в $p"
    fi
  done
fi

printf '  Ждём, пока приложение станет здоровым (до %s с; первый старт включает миграции)' "$HEALTH_TIMEOUT"
set +e
wait_healthy "$NEW_CID" "$HEALTH_TIMEOUT"; RC=$?
set -e
printf '\n'
if [ "$RC" -ne 0 ]; then
  warn "Приложение не стало здоровым (код $RC: 1=таймаут, 2=нет контейнера, 3=перезапускается, 4=остановлен). Последние строки лога:"
  dc logs --tail 60 "$APP_SERVICE" 2>&1 | sed 's/^/    /' >&2 || true
  printf '\n%sЧто делать:%s\n' "$C_BLD" "$C_OFF" >&2
  printf '  • Если в логе ошибка .env (JWT_SECRET/ENCRYPTION_KEY/DATABASE_URL) — исправьте .env и выполните: docker compose up -d\n' >&2
  printf '  • Вернуть предыдущую версию и БД из бэкапа: ./deploy/rollback.sh\n' >&2
  exit 1
fi
ok "Контейнер здоров"

# ───────────────────────────── 8. Итог ─────────────────────────────
step "8/8 Итог"
dc logs --tail 80 "$APP_SERVICE" 2>&1 | grep -E "migrat|Временный пароль|Lead_SUP|ready|Ready|Listening|error|Error" | tail -n 8 | sed 's/^/    /' || true
SHOW_PORT="$(docker port "$NEW_CID" 3000/tcp 2>/dev/null | head -n 1 || true)"
ok "Готово: ${PREV_COMMIT} → ${NEW_COMMIT}${SHOW_PORT:+; приложение на $SHOW_PORT}"
[ -n "$BACKUP_FILE" ] && info "Бэкап до обновления: ${BACKUP_FILE#"$ROOT"/}"
info "Один раз все пользователи будут разлогинены (новый формат сессий) — это нормально."
info "Если что-то пошло не так: ./deploy/rollback.sh"
