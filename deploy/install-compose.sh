#!/usr/bin/env bash
# Установка плагина Docker Compose v2 (команда `docker compose`). Работающие контейнеры не затрагивает.
#
#   ./deploy/install-compose.sh                 # для текущего пользователя (~/.docker/cli-plugins), без root
#   sudo ./deploy/install-compose.sh            # для всей системы (/usr/local/lib/docker/cli-plugins) — нужно, если docker запускается через sudo
#   ./deploy/install-compose.sh /путь/к/docker-compose-linux-x86_64   # из заранее скачанного файла (сервер без интернета)
#   COMPOSE_VERSION=v2.29.7 ./deploy/install-compose.sh                # другая версия (по умолчанию v2.29.7)
#
# Скачивание: https://github.com/docker/compose/releases (файл docker-compose-linux-<arch>), контрольная сумма проверяется.

set -euo pipefail
VERSION="${COMPOSE_VERSION:-v2.29.7}"
LOCAL_FILE="${1:-}"

[ "$(uname -s)" = "Linux" ] || { echo "✗ Скрипт ставит Linux-бинарник и предназначен для Linux-серверов (у вас: $(uname -s)). На Mac/Windows compose входит в Docker Desktop." >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "✗ Docker не установлен." >&2; exit 1; }
if docker compose version >/dev/null 2>&1 && [ "${FORCE:-0}" != "1" ]; then
  echo "✓ Docker Compose v2 уже установлен: $(docker compose version --short 2>/dev/null || docker compose version)"; echo "  (переустановить принудительно: FORCE=1 $0)"; exit 0
fi

if [ "$(id -u)" -eq 0 ]; then DEST_DIR="/usr/local/lib/docker/cli-plugins"; else DEST_DIR="${DOCKER_CONFIG:-$HOME/.docker}/cli-plugins"; fi
DEST="$DEST_DIR/docker-compose"
mkdir -p "$DEST_DIR"

case "$(uname -m)" in
  x86_64|amd64) ARCH=x86_64 ;;
  aarch64|arm64) ARCH=aarch64 ;;
  armv7l) ARCH=armv7 ;;
  *) echo "✗ Неизвестная архитектура: $(uname -m)" >&2; exit 1 ;;
esac

TMP="$(mktemp)"; trap 'rm -f "$TMP" "$TMP.sha256"' EXIT
if [ -n "$LOCAL_FILE" ]; then
  [ -f "$LOCAL_FILE" ] || { echo "✗ Файл не найден: $LOCAL_FILE" >&2; exit 1; }
  cp "$LOCAL_FILE" "$TMP"
else
  URL="https://github.com/docker/compose/releases/download/${VERSION}/docker-compose-linux-${ARCH}"
  echo "Скачиваю $URL"
  if command -v curl >/dev/null 2>&1; then curl -fSL "$URL" -o "$TMP"; curl -fsSL "$URL.sha256" -o "$TMP.sha256" 2>/dev/null || true
  elif command -v wget >/dev/null 2>&1; then wget -q "$URL" -O "$TMP"; wget -q "$URL.sha256" -O "$TMP.sha256" 2>/dev/null || true
  else echo "✗ Нужен curl или wget." >&2; exit 1; fi
  if [ -s "$TMP.sha256" ]; then
    EXPECTED="$(awk '{print $1}' "$TMP.sha256")"
    if command -v sha256sum >/dev/null 2>&1; then ACTUAL="$(sha256sum "$TMP" | awk '{print $1}')"; else ACTUAL="$(shasum -a 256 "$TMP" | awk '{print $1}')"; fi
    [ "$EXPECTED" = "$ACTUAL" ] || { echo "✗ Контрольная сумма не совпала — файл не установлен." >&2; exit 1; }
    echo "✓ Контрольная сумма совпала"
  else
    echo "⚠ Контрольная сумма недоступна — проверьте файл вручную при необходимости." >&2
  fi
fi

install -m 0755 "$TMP" "$DEST"
echo "✓ Установлено: $DEST"
docker compose version || { echo "✗ Плагин установлен, но docker его не видит. Если docker запускается через sudo — выполните: sudo $0" >&2; exit 1; }
