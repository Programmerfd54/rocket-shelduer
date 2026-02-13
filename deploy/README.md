# Деплой на 10.76.52.21

Развёртывание в контейнерах: **PostgreSQL** + **Node.js (Next.js)**. Ссылки приглашений и `PUBLIC_APP` указывают на `http://10.76.52.21` (порт 80, в адресе не отображается).

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

**После запуска:** открыть в браузере **http://10.76.52.21**, войти как **admin** / **admin** и сменить пароль в настройках.

**Остановка:** `docker compose -f deploy/docker-compose.yml down`

---

## 1. Генерация .env

Из **корня репозитория** выполнить:

```bash
./deploy/generate-env.sh > .env
```

Скрипт создаёт:
- `JWT_SECRET`, `ENCRYPTION_KEY` — случайные строки
- `CRON_SECRET=""`, `HEALTH_CHECK_SECRET=""`
- `DATABASE_URL=postgresql://postgres:password@postgres:5432/rocketchat_scheduler` (хост `postgres` — имя сервиса в docker-compose)
- `NEXT_PUBLIC_APP_URL` и `APP_URL` = `http://10.76.52.21`
- `COOKIE_SECURE=false` (для входа по HTTP)

При необходимости поменять хост приложения:

```bash
APP_HOST=10.76.52.21 ./deploy/generate-env.sh > .env
```

## 2. Запуск контейнеров

Из **корня репозитория** (быстрый вариант — создаёт .env при отсутствии и поднимает всё):

```bash
./deploy/up.sh
```

Или вручную:

```bash
./deploy/generate-env.sh > .env
docker compose -f deploy/docker-compose.yml up -d --build
```

Что происходит:
- **postgres**: создаётся БД `rocketchat_scheduler`, пользователь `postgres`, пароль `password`.
- **app**: `npm install` уже выполнен в образе, при старте контейнера:
  - `npx prisma migrate deploy`
  - `npm run create-superuser` (логин `admin`, пароль `admin` — сменить после входа)
  - `npm start`

Приложение доступно по адресу: **http://10.76.52.21** (без порта в адресе).

## 3. Проверка

- Список контейнеров: `docker compose -f deploy/docker-compose.yml ps`
- Логи приложения: `docker compose -f deploy/docker-compose.yml logs -f app`
- Первый вход: логин `admin`, пароль `admin`; затем сменить в настройках.

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
docker tag deploy-app:latest rocketchat-scheduler-app:latest
docker save -o app-image.tar rocketchat-scheduler-app:latest
```

Перенесите `app-image.tar` на сервер (scp, флешка и т.п.).

**На сервере** (в каталоге репо, уже есть `.env`):

```bash
docker load -i app-image.tar
docker tag rocketchat-scheduler-app:latest deploy-app:latest
COMPOSE_PROJECT_NAME=deploy docker compose -f deploy/docker-compose.yml up -d
```

Compose подхватит уже загруженный образ и не будет запускать сборку.

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
