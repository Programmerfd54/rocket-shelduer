#!/usr/bin/env bash
# Диагностика «сообщения не отправляются»: ничего не меняет, секреты не печатает.
#   ./deploy/diagnose.sh
# Показывает: запущен ли внутренний cron, когда был последний тик очереди, сколько сообщений просрочено,
# последние ошибки отправки и резолвятся ли адреса Rocket.Chat во внутреннюю сеть (блокируется защитой SSRF).

set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"; DEPLOY_DIR="$ROOT/.deploy"; ENV_FILE="$ROOT/.env"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
# shellcheck source=deploy/lib.sh
. "$ROOT/deploy/lib.sh"
mkdir -p "$DEPLOY_DIR"
[ "${1:-}" = "-f" ] && COMPOSE_FILE="${2:-$COMPOSE_FILE}"

detect_compose
[ -f "$ENV_FILE" ] || die "Нет .env"
detect_app_service
COMPOSE_DIR="$(cd "$(dirname "$COMPOSE_FILE")" && pwd)"
APP_CID="$(find_service_container "$COMPOSE_DIR" "$APP_SERVICE")"
if [ -z "$APP_CID" ] && [ "$COMPOSE_FILE" = "docker-compose.yml" ] && [ -n "$(find_service_container "$ROOT/deploy" app)" ]; then
  COMPOSE_FILE="deploy/docker-compose.yml"; detect_app_service; APP_CID="$(find_service_container "$ROOT/deploy" "$APP_SERVICE")"
fi
export APP_CID
[ -n "$APP_CID" ] || die "Контейнер приложения не найден — сначала ./deploy/update.sh"
PROJECT="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$APP_CID")"; [ -n "$PROJECT" ] && export COMPOSE_PROJECT_NAME="$PROJECT"

step "1. Контейнер приложения"
docker inspect -f '  состояние: {{.State.Status}}, здоровье: {{if .State.Health}}{{.State.Health.Status}}{{else}}нет healthcheck{{end}}, запущен: {{.State.StartedAt}}' "$APP_CID"

step "2. Внутренний cron (отправка раз в минуту)"
LOGS="$(docker logs --tail 4000 "$APP_CID" 2>&1 || true)"
if printf '%s' "$LOGS" | grep -q "Internal cron started"; then ok "внутренний cron запущен";
elif printf '%s' "$LOGS" | grep -q "Internal cron is disabled"; then warn "внутренний cron ОТКЛЮЧЁН (DISABLE_INTERNAL_CRON=true) — нужен внешний cron";
else warn "в логе нет строки «Internal cron started» — вероятно, работает СТАРАЯ версия образа. Выполните ./deploy/update.sh (версия с исправлением cron)."; fi
[ -n "$(env_get CRON_SECRET)" ] && info "CRON_SECRET задан (с этой версии внутренний cron работает независимо от него)" || info "CRON_SECRET не задан"
printf '%s\n' "$LOGS" | grep -E "Cron: sent|Failed to send|Found [0-9]+ messages|Cron job error" | tail -n 8 | sed 's/^/    /' || true

DBURL="$(env_get DATABASE_URL)"; CLEAN="$(clean_db_url "$DBURL")"
q() { # q "<sql>" → строки результата
  PG_OUT="$DEPLOY_DIR/diag.out"; export PG_OUT
  if run_pg_tool psql "$CLEAN" -At -F ' | ' -c "$1"; then cat "$DEPLOY_DIR/diag.out"; else warn "не удалось выполнить запрос к БД (см. .deploy/pg-tool.err)"; fi
  rm -f "$DEPLOY_DIR/diag.out"
}
step "3. Очередь"
info "Последний тик отправщика (heartbeat):"; q "select coalesce(value,'—')||'  (сейчас '||to_char(now() at time zone 'utc','YYYY-MM-DD\"T\"HH24:MI:SS')||'Z)' from \"SystemSetting\" where key='cron:lastSendTick' union all select 'нет записи — отправщик с этой версией ещё не работал' where not exists (select 1 from \"SystemSetting\" where key='cron:lastSendTick')" | sed 's/^/    /'
info "Просроченные (PENDING, время прошло):"; q "select count(*)||' шт., самое старое: '||coalesce(min(\"scheduledFor\")::text,'—') from \"ScheduledMessage\" where status='PENDING' and \"scheduledFor\" < now()" | sed 's/^/    /'
info "Последние ошибки отправки:"; q "select to_char(\"updatedAt\",'MM-DD HH24:MI')||' · #'||\"channelName\"||' · '||left(coalesce(error,'?'),180) from \"ScheduledMessage\" where status='FAILED' order by \"updatedAt\" desc limit 5" | sed 's/^/    /'

step "4. Адреса Rocket.Chat → внутренняя сеть? (блокируется защитой SSRF)"
HOSTS="$(q "select distinct split_part(split_part(\"workspaceUrl\",'://',2),'/',1) from \"WorkspaceConnection\" where \"isActive\" and not \"isArchived\"" | tr -d '\r')"
ALLOW="$(env_get SSRF_ALLOWED_HOSTS)"
[ -n "$ALLOW" ] && info "SSRF_ALLOWED_HOSTS=$ALLOW" || info "SSRF_ALLOWED_HOSTS не задан"
printf '%s\n' "$HOSTS" | while read -r h; do
  [ -z "$h" ] && continue
  host="${h%%:*}"
  r="$(docker exec "$APP_CID" node -e "
    const dns=require('dns').promises;
    const priv=a=>/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|198\.1[89]\.|127\.|169\.254\.|fc|fd|::1)/i.test(a);
    dns.lookup(process.argv[1],{all:true}).then(r=>console.log(r.map(x=>x.address+(priv(x.address)?' [ВНУТРЕННИЙ]':'')).join(', '))).catch(e=>console.log('DNS: '+e.code));
  " "$host" 2>/dev/null)"
  case "$r" in
    *ВНУТРЕННИЙ*) case ",$ALLOW," in *",$host,"*) ok "$host → $r (разрешён в SSRF_ALLOWED_HOSTS)";; *) warn "$host → $r — ЗАБЛОКИРОВАН защитой SSRF. Добавьте в .env: SSRF_ALLOWED_HOSTS=$host и перезапустите (docker compose up -d).";; esac ;;
    *) ok "$host → ${r:-?}" ;;
  esac
done
echo
info "Если сообщения FAILED из-за SSRF: после правки .env нажмите «Повторить» у сообщения (или перепланируйте)."
