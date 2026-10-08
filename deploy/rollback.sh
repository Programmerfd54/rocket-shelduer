#!/usr/bin/env bash
# Откат после ./deploy/update.sh: возвращает предыдущий образ приложения и (по подтверждению) базу из бэкапа.
#
#   ./deploy/rollback.sh              # образ + БД из последнего бэкапа (спросит подтверждение)
#   ./deploy/rollback.sh --image-only # только вернуть образ (БД не трогать; НЕ подходит, если миграции уже применены)
#   ./deploy/rollback.sh --yes        # без вопросов
#
# ВАЖНО: восстановление БД возвращает данные на момент бэкапа — всё, что появилось после обновления
# (новые сообщения, пользователи, интенсивы), будет потеряно. Старый код не умеет работать с новой схемой БД,
# поэтому после успешных миграций «только образ» откатывать нельзя — нужен и образ, и БД.

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
DEPLOY_DIR="$ROOT/.deploy"
ENV_FILE="$ROOT/.env"
ASSUME_YES=0; IMAGE_ONLY=0; HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-300}"
# shellcheck source=deploy/lib.sh
. "$ROOT/deploy/lib.sh"

for a in "$@"; do
  case "$a" in
    -y|--yes) ASSUME_YES=1 ;;
    --image-only) IMAGE_ONLY=1 ;;
    -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Неизвестный аргумент: $a" ;;
  esac
done
export ASSUME_YES

[ -f "$DEPLOY_DIR/last-deploy.env" ] || die "Нет .deploy/last-deploy.env — откатывать нечего (update.sh ещё не запускался на этой машине)."
[ -f "$ENV_FILE" ] || die "Не найден .env"
# shellcheck disable=SC1091
. "$DEPLOY_DIR/last-deploy.env"
[ -z "${COMPOSE_PROJECT_NAME:-}" ] || export COMPOSE_PROJECT_NAME
[ -z "${COMPOSE_PROFILES:-}" ] || export COMPOSE_PROFILES
[ -z "${APP_PORT:-}" ] || export APP_PORT
[ -z "${APP_BIND_ADDRESS:-}" ] || export APP_BIND_ADDRESS

detect_compose
[ -f "$COMPOSE_FILE" ] || die "Не найден $COMPOSE_FILE"
mkdir -p "$DEPLOY_DIR"
step "Откат: $NEW_COMMIT → $PREV_COMMIT"
[ -n "${ROLLBACK_TAG:-}" ] && docker image inspect "$ROLLBACK_TAG" >/dev/null 2>&1 \
  || die "Сохранённый образ предыдущей версии ($ROLLBACK_TAG) не найден — откат невозможен. Соберите старую версию вручную: git checkout $PREV_COMMIT && docker compose up -d --build"

if [ "$IMAGE_ONLY" = "0" ]; then
  [ -n "${BACKUP_FILE:-}" ] && [ -f "$ROOT/$BACKUP_FILE" ] \
    || die "Бэкап БД не найден (${BACKUP_FILE:-не создавался}). Используйте --image-only, только если уверены, что миграции не применялись."
  warn "БД будет восстановлена из $BACKUP_FILE. Данные, появившиеся после обновления, будут ПОТЕРЯНЫ."
  confirm "Продолжить откат образа и базы?" || die "Отменено."
else
  confirm "Вернуть только образ ($ROLLBACK_TAG)? Если миграции уже применены, старая версия может не работать." || die "Отменено."
fi

APP_CID="$(dc ps -aq "$APP_SERVICE" | head -n 1 || true)"; export APP_CID
DBURL="$(env_get DATABASE_URL)"; [ -n "$DBURL" ] || die "DATABASE_URL не задан в .env"

step "Останавливаем приложение"
dc stop "$APP_SERVICE" >/dev/null 2>&1 || true

if [ "$IMAGE_ONLY" = "0" ]; then
  step "Восстанавливаем БД из бэкапа"
  TMP_SQL="$DEPLOY_DIR/restore-$$.sql"
  gzip -dc "$ROOT/$BACKUP_FILE" > "$TMP_SQL"
  CLEAN_URL="$(clean_db_url "$DBURL")"
  # APP_CID нужен только для способа «в сети приложения»; контейнер остановлен, поэтому пробуем способы 1 и 2
  PG_IN="$TMP_SQL"; PG_OUT=/dev/null; export PG_IN PG_OUT
  if ! run_pg_tool psql "$CLEAN_URL" -q -v ON_ERROR_STOP=0; then
    rm -f "$TMP_SQL"
    # способ 3 требует запущенного контейнера в сети приложения — временно запустим старый образ только ради сети
    warn "Не удалось восстановить БД доступными способами. Ошибки: .deploy/pg-tool.err"
    die "Восстановите БД вручную: gunzip -c $BACKUP_FILE | psql \"<DATABASE_URL без ?schema=...>\""
  fi
  rm -f "$TMP_SQL"; unset PG_IN PG_OUT
  ok "БД восстановлена"
fi

step "Запускаем предыдущий образ"
docker tag "$ROLLBACK_TAG" "$APP_IMAGE_NAME"
dc up -d --no-build --force-recreate "$APP_SERVICE"
NEW_CID="$(dc ps -q "$APP_SERVICE" | head -n 1)"
printf '  Ждём здоровья'
set +e; wait_healthy "$NEW_CID" "$HEALTH_TIMEOUT"; RC=$?; set -e; printf '\n'
if [ "$RC" -ne 0 ]; then
  dc logs --tail 40 "$APP_SERVICE" 2>&1 | sed 's/^/    /' >&2 || true
  die "Предыдущая версия не стала здоровой (код $RC). Проверьте логи выше."
fi
ok "Откат выполнен: работает предыдущая версия ($PREV_COMMIT)."
info "Код в git не откатывался. Чтобы повторить обновление позже: ./deploy/update.sh (после исправления причины)."
info "Не забудьте: git checkout $PREV_COMMIT — только если нужно вернуть и исходники."
