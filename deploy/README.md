# Деплой

## Обновление работающей установки одной командой

```bash
cd /путь/к/репозиторию      # там же, где лежат docker-compose.yml и .env
./deploy/update.sh           # git pull → проверка .env → бэкап БД → сборка → перезапуск → проверка здоровья
```

Что делает скрипт и почему это безопасно:

| Шаг | Действие |
|-----|----------|
| 1–2 | Проверяет Docker и `.env` (JWT_SECRET, ENCRYPTION_KEY, DATABASE_URL, отсутствие заглушек). **`.env` не меняется.** При проблеме останавливается, ничего не тронув. |
| 3 | Находит работающий контейнер и **запоминает его порт и профили compose** — прокси (nginx/Caddy) продолжает работать без правок. |
| 4 | `git pull --ff-only` (пропуск: `--no-pull`). Если pull невозможен — остановка без последствий. |
| 5 | **Дамп БД** в `backups/db-<дата>-before-<коммит>.sql.gz` (хранятся последние 10). Без бэкапа — только с подтверждением или `--skip-backup`. |
| 6 | **Собирает новый образ, пока старый контейнер ещё работает.** Если сборка упала — сервис не затронут. Предыдущий образ сохраняется для отката. Файлы загрузок из старого контейнера сохраняются. |
| 7 | Пересоздаёт контейнер. Миграции БД применяются автоматически при старте. Загрузки возвращаются в постоянные тома. |
| 8 | Ждёт статуса `healthy`; при неудаче показывает логи и подсказывает откат. |

Опции: `--no-pull`, `--skip-backup`, `--yes` (без вопросов), `-f deploy/docker-compose.yml` (полный стек).

**Откат:** `./deploy/rollback.sh` — вернёт предыдущий образ и восстановит БД из последнего бэкапа
(данные, появившиеся после обновления, будут потеряны; перед этим скрипт спросит подтверждение).
`--image-only` возвращает только образ — не подходит, если миграции уже применены.

**Что произойдёт у пользователей при первом обновлении с версии до интенсивов:**
- один раз все будут разлогинены (новый формат сессий), данные и подключения сохраняются;
- роли переименуются автоматически: `ADMIN→LEAD_SUP`, `SUPPORT→SUP`, `USER/VOL→MEMBER`, `ADM` остаётся;
  пользователь `admin` получает `LEAD_SUP`;
- роль HQ и «города» удалены (таблицы городов остаются в БД как архив).

**Новые переменные `.env` (все необязательны, существующий `.env` работает как есть):**
`APP_PORT` (по умолчанию 3000), `APP_BIND_ADDRESS`, `CRON_SECRET`, `HEALTH_CHECK_SECRET`, `TRUSTED_PROXY_HOPS`
(число прокси перед приложением, по умолчанию 1), `CORS_ALLOWED_ORIGINS`, `SSRF_ALLOWED_HOSTS` (внутренние хосты
Rocket.Chat/VPN, которые нужно разрешить), `APP_MEM_LIMIT`. Подробности — в `.env.example`.

---

## Первая установка (полный стек)

Развёртывание в контейнерах: **PostgreSQL** + **Node.js (Next.js)**. По умолчанию: `https://sheduler.yar.21-school.ru`, приложение слушает порт **4001** (nginx проксирует на него).

**На самой машине ничего не ставится:** Node.js, npm, PostgreSQL и все зависимости работают только внутри контейнеров. На хосте нужны только **Docker** и **Docker Compose** (и git, если клонируете репо с другой машины). Так машина не засоряется.

---

## Порядок запуска (кратко)

Выполнять **на машине, где будет работать приложение** (например 10.76.52.21), из **корня репозитория** (там, где лежат `package.json` и папка `deploy/`).

| Шаг | Команда | Что происходит |
|-----|--------|----------------|
| **1** | `./deploy/generate-env.sh > .env` | Создаётся файл `.env` с секретами и URL приложения. Делать один раз (или заново при смене хоста/порта). |
| **2** | `docker compose -f deploy/docker-compose.yml up -d --build` | Запускаются контейнеры: сначала Postgres (БД и пользователь создаются автоматически), затем приложение (миграции, суперпользователь, старт). |

**Один запуск вместо шагов 1 и 2:** если `.env` ещё нет, можно выполнить только:

```bash
./deploy/up.sh
```

(скрипт сам создаст `.env` и поднимет контейнеры).

**Важно:** на сервере без нормального интернета **не используйте** `build --no-cache`. Из-за этого Docker пересоберёт всё с нуля, `npm install` снова пойдет в сеть и упадёт по таймауту. Для обновления кода достаточно `up -d --build` — подхватятся изменения и пересоберутся только нужные слои (кэш `npm install` сохранится).

**После запуска:** открыть в браузере **https://sheduler.yar.21-school.ru** (через nginx) или **http://IP:4001**, войти как **admin** с временным паролем из лога (`docker compose --env-file .env -f deploy/docker-compose.yml logs app | grep -A1 'Временный пароль'`) и задать новый пароль (система потребует это при первом входе).

**Остановка:** `docker compose -f deploy/docker-compose.yml down`

**Автозапуск после перезагрузки:** контейнеры уже настроены с `restart: unless-stopped` — после перезагрузки машины Docker сам поднимет их. Данные БД хранятся в volume `pgdata` и сохраняются. Убедитесь, что Docker запускается при загрузке: `sudo systemctl enable docker` (обычно уже включено).

---

## 1. Генерация .env

Из **корня репозитория** выполнить:

```bash
./deploy/generate-env.sh > .env
```

Скрипт создаёт:
- `JWT_SECRET`, `ENCRYPTION_KEY` — случайные строки
- `CRON_SECRET`, `HEALTH_CHECK_SECRET` (случайные строки)
- `POSTGRES_PASSWORD` (случайный) и `DATABASE_URL=postgresql://postgres:<POSTGRES_PASSWORD>@postgres:5432/rocketchat_scheduler` (хост `postgres` — имя сервиса в docker-compose)
- `TRUSTED_PROXY_HOPS=1`, `APP_BIND_ADDRESS=127.0.0.1` (порт 4001 доступен только nginx на этом хосте)

Файл `.env` содержит секреты: создавайте его с правами 600 (`(umask 077; ./deploy/generate-env.sh > .env)`) и не перегенерируйте на работающей инсталляции (смена `ENCRYPTION_KEY` сделает сохранённые пароли Rocket.Chat нерасшифровываемыми).
- `NEXT_PUBLIC_APP_URL` и `APP_URL` = `https://sheduler.yar.21-school.ru`
- `COOKIE_SECURE=true` (для HTTPS)

При необходимости поменять хост:

```bash
APP_HOST=другой-хост.ru ./deploy/generate-env.sh > .env
```

## 2. Запуск контейнеров

Из **корня репозитория** (быстрый вариант — создаёт .env при отсутствии и поднимает всё):

```bash
./deploy/up.sh
```

Или вручную:

```bash
(umask 077; bash ./deploy/generate-env.sh > .env)
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
```

Что происходит:
- **postgres**: создаётся БД `rocketchat_scheduler`, пользователь `postgres`, пароль из `POSTGRES_PASSWORD` (если переменной нет — устаревший `password`; см. «Смена пароля БД» ниже).
- **app**: `npm install` уже выполнен в образе, при старте контейнера:
  - `npx prisma migrate deploy`
  - `create-superuser` (только если Lead_SUP ещё нет: логин `admin`, случайный временный пароль в логе или `SUPERUSER_PASSWORD`; смена при первом входе обязательна)
  - `npm start`

Приложение слушает порт **4001**. Nginx должен проксировать на `http://127.0.0.1:4001` (или `http://IP:4001`).

## 3. Проверка

- Список контейнеров: `docker compose -f deploy/docker-compose.yml ps`
- Логи приложения: `docker compose -f deploy/docker-compose.yml logs -f app`
- Первый вход: логин `admin`, временный пароль из лога контейнера `app`; система сразу попросит задать новый.

### Смена пароля БД (для инсталляций, созданных со старым `password`)

```bash
NEW=$(openssl rand -hex 24)
docker compose --env-file .env -f deploy/docker-compose.yml exec postgres psql -U postgres -c "ALTER USER postgres PASSWORD '$NEW';"
echo "POSTGRES_PASSWORD=\"$NEW\"" >> .env   # и обновите DATABASE_URL, если он задан в .env
docker compose --env-file .env -f deploy/docker-compose.yml up -d
```

## 4. Остановка

```bash
docker compose -f deploy/docker-compose.yml down
```

Данные Postgres сохраняются в volume `pgdata`.

---

## 5. Сборка при отсутствии интернета на сервере

Если на сервере нет доступа в интернет или `npm install` падает по таймауту, соберите образ **на машине с интернетом** и перенесите его.

**На машине с интернетом** (из корня репо):

```bash
COMPOSE_PROJECT_NAME=deploy docker compose -f deploy/docker-compose.yml build app
docker save -o app-image.tar deploy-app:latest
```

Перенесите `app-image.tar` на сервер (scp, флешка и т.п.).

**На сервере** (в каталоге репо, уже есть `.env`):

```bash
docker load -i app-image.tar
COMPOSE_PROJECT_NAME=deploy docker compose -f deploy/docker-compose.yml up -d
```

Compose подхватит загруженный образ `deploy-app:latest` и не будет запускать сборку.

---

## 5. Сборка при отсутствии интернета на сервере

Если на сервере (10.76.52.21) нет доступа в интернет или npm постоянно падает по таймауту, образ можно собрать **на другой машине с интернетом** и перенести.

**На машине с интернетом** (ноутбук, CI, другой сервер):

```bash
cd /path/to/rocketchat-scheduler
docker compose -f deploy/docker-compose.yml build app
docker tag deploy-app:latest rocketchat-scheduler-app:latest
docker save -o app-image.tar rocketchat-scheduler-app:latest
```

Перенесите файл на сервер (scp, флешка и т.д.):

```bash
scp app-image.tar user@10.76.52.21:/path/to/rocketchat-scheduler/
```

**На сервере** (в каталоге репозитория, уже с `.env` и `deploy/`):

```bash
docker load -i app-image.tar
# Запуск без --build: используем загруженный образ
docker compose -f deploy/docker-compose.yml up -d
```

Имя образа после `load` будет `rocketchat-scheduler-app:latest`. Чтобы compose подхватил его, в `deploy/docker-compose.yml` у сервиса `app` должен быть `image: rocketchat-scheduler-app:latest` при отсутствии сборки — но сейчас там только `build:`, поэтому compose по умолчанию будет искать образ с именем проекта. После `docker load` образ будет под своим именем. Нужно либо задать в compose `image: rocketchat-scheduler-app:latest` и убрать/оставить build, либо после load переименовать: `docker tag rocketchat-scheduler-app:latest deploy-app:latest` (имя проекта из имени каталога — часто "deploy" если папка deploy). Actually when you run `docker compose -f deploy/docker-compose.yml build app` the image gets tagged as something like `deploy-app` because the project name is taken from the parent directory of the compose file. So the directory is "deploy", parent of that is repo root - project name might be the repo directory name, e.g. rocketchat-scheduler. So image could be rocketchat-scheduler-app. I'll suggest they run `docker compose -f deploy/docker-compose.yml build app` locally, then `docker images` to see the exact name (e.g. deploy-app or rocketchat-scheduler-app), then save that. On the server after load they run `docker compose -f deploy/docker-compose.yml up -d` - but compose will try to build because we have build: in the file. So we need to either use a separate compose override that only has image: and no build, or tell them to run with the same project name. Actually the simplest is: on the machine with internet, build and save with a fixed tag like rocketchat-scheduler-app:latest. On the server, we need the compose to use that image. So we add an optional way to use a pre-built image: e.g. if we have deploy/docker-compose.override.yml with just app image: rocketchat-scheduler-app:latest, then when they copy that file to server and run, it would use the image. But that might override build on dev too. Simpler: document that after load they should run `docker tag rocketchat-scheduler-app:latest deploy-app:latest` (or whatever name compose expects - the project name is the directory name by default, so if the repo is in /home/user/rocketchat-scheduler, project is rocketchat-scheduler and image would be rocketchat-scheduler-app). So we need to tell them to check the image name after build with docker images, save it, on server load and tag to match. So: "После сборки выполните docker images и найдите образ app (например deploy-app или rocketchat-scheduler-app). Сохраните его: docker save -o app-image.tar <имя>:latest. На сервере: docker load -i app-image.tar; docker tag <имя>:latest <то же имя>:latest (если нужно). Запуск: в каталоге с репо на сервере docker compose -f deploy/docker-compose.yml up -d. Если compose пытается пересобрать app, задайте переменную COMPOSE_PROJECT_NAME так же, как на машине где собирали, или скопируйте имя образа с машины сборки и сделайте docker tag загруженного образа в это имя." This is getting complex. Simpler approach: create a small script or document that on build machine you do: docker compose -f deploy/docker-compose.yml build app && docker compose -f deploy/docker-compose.yml images app to get the name. Then docker save. On server: docker load, then docker tag <loaded_image_id> deploy-app:latest (assuming project name is deploy when run from repo root with -f deploy/docker-compose.yml - actually the project name is the directory containing the compose file's parent... no, it's the current directory name when you run docker compose. So from repo root, current dir is e.g. rocketchat-scheduler, so project name is rocketchat-scheduler, and the app image is rocketchat-scheduler-app. So after load on server they need to tag as rocketchat-scheduler-app:latest. I'll write the readme with "Имя образа смотрите в docker images после сборки (например rocketchat-scheduler-app)."
</think>
Уточняю имена образов docker-compose:
<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>
Shell
