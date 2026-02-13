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
