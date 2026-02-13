# Rocket.Chat Scheduler

Веб-приложение для планирования отложенных сообщений в [Rocket.Chat](https://rocketchat.com). Позволяет подключать рабочие пространства (серверы Rocket.Chat), выбирать каналы и назначать время отправки сообщений.

## Стек

- **Next.js 16** (App Router), **React 19**, **TypeScript**
- **Prisma** + **PostgreSQL**
- **Tailwind CSS**, **Radix UI**, **TipTap** (редактор сообщений)

## Требования

- Node.js 20+
- PostgreSQL

## Быстрый старт

### 1. Клонирование и зависимости

```bash
git clone <repo-url>
cd rocketchat-scheduler
npm install
```

### 2. Переменные окружения

Скопируйте пример и заполните значения:

```bash
cp .env.example .env
```

**Обязательные переменные:**

| Переменная      | Описание |
|-----------------|----------|
| `DATABASE_URL`  | Строка подключения PostgreSQL, например `postgresql://user:password@localhost:5432/rocketchat_scheduler` |
| `JWT_SECRET`    | Секрет для подписи JWT (в проде — длинная случайная строка, не оставляйте значение из примера) |

**Опциональные:**

| Переменная            | Описание |
|-----------------------|----------|
| `ENCRYPTION_KEY`      | Ключ шифрования паролей пространств (минимум 32 символа). Если не задан, в dev может использоваться JWT_SECRET (в проде не рекомендуется). |
| `CRON_SECRET`         | Секрет для вызова cron-эндпоинтов (`/api/cron/send-messages`, `/api/cron/cleanup-archives`). Если задан, запросы должны содержать заголовок `Authorization: Bearer <CRON_SECRET>`. |
| `NEXT_PUBLIC_APP_URL` или `APP_URL` | Базовый URL приложения (для CORS и ссылок приглашений). |
| `NEXT_PUBLIC_SENTRY_DSN` или `SENTRY_DSN` | См. раздел «Опционально: Sentry» ниже. |

### 3. База данных

```bash
npx prisma generate
npx prisma migrate deploy
```

### 4. Запуск

**Разработка:**

```bash
npm run dev
```

Приложение: [http://localhost:3000](http://localhost:3000).

В режиме разработки cron для отправки сообщений запускается автоматически (каждую минуту вызывается `GET http://localhost:3000/api/cron/send-messages`). Для продакшена настройте внешний cron (Vercel Cron, GitHub Actions, системный cron) с вызовом этого URL и, при необходимости, `CRON_SECRET`.

**Сборка и продакшен:**

```bash
npm run build
npm start
```

## Docker

```bash
docker compose up --build
```

Сервис будет доступен на порту 3000. Убедитесь, что в `.env` указаны корректные `DATABASE_URL` и `JWT_SECRET` (файл `.env` подхватывается через `env_file` в `docker-compose.yml`).

## Полезные команды

| Команда | Описание |
|---------|----------|
| `npm run dev` | Запуск dev-сервера |
| `npm run build` | Сборка для продакшена |
| `npm start` | Запуск собранного приложения |
| `npm run lint` | Проверка кода (ESLint) |
| `npm run test` | Запуск тестов (Vitest) |
| `npm run create-superuser` | Создание суперпользователя (интерактивно) |
| `npx prisma migrate dev` | Создание и применение миграций в разработке |
| `npx prisma migrate deploy` | Применение миграций (продакшен) |

## Деплой в Docker

- Сборка и запуск: см. `Dockerfile`. При старте выполняются `prisma migrate deploy` и `npm start`.
- **Создание админа:** после первого запуска контейнера выполните скрипт **в той же среде, где работает приложение** (тот же `DATABASE_URL`). Из хоста: `docker exec -it <container> npx tsx scripts/create-superuser.ts` или добавьте одноразовый шаг в docker-compose/CI. Логин по умолчанию: `admin`, пароль: `admin` — смените после первого входа.
- **Вход не «держится» (после логина снова просит войти):** если приложение доступно по **HTTP** (без HTTPS), в production cookie с флагом `Secure` не отправляется браузером. Задайте в `.env`: **`COOKIE_SECURE=false`**. При работе через HTTPS (или за прокси с терминацией SSL) оставьте `COOKIE_SECURE` не заданным или `true`.

## Health-check

- **GET** `/api/health` — для мониторинга (Docker, K8s). Проверка приложения и БД: `200` и `{ status, db, latencyMs }` или `503`. Если в `.env` задан `HEALTH_CHECK_SECRET`, запрос должен содержать `?secret=HEALTH_CHECK_SECRET`, иначе вернётся `401`.
- **Для ADMIN:** вкладка **Health** в сайдбаре ведёт на `/dashboard/admin/health` — расширенная проверка (БД, задержка, наличие env-переменных без раскрытия значений, NODE_ENV). Данные берутся из **GET** `/api/admin/health` (только для роли ADMIN).

## Cron (продакшен)

- **Отправка сообщений:** вызывайте **GET** или **POST** `/api/cron/send-messages` каждую минуту (например, через Vercel Cron Jobs или системный cron). Если задан `CRON_SECRET`, передавайте заголовок `Authorization: Bearer <CRON_SECRET>`.
- **Очистка архивов:** вызывайте **GET** `/api/cron/cleanup-archives` раз в день (удаляются пространства, у которых истёк срок хранения после архивации). Аналогично при необходимости передавайте `CRON_SECRET`.

## Опционально: Sentry

По умолчанию Sentry не подключён (чтобы сборка проходила без дополнительных зависимостей). Чтобы отправлять ошибки в Sentry:

1. Установите пакет (для Next 16 может понадобиться флаг):
   ```bash
   npm install @sentry/nextjs --save-dev --legacy-peer-deps
   ```
2. Задайте в `.env`: `NEXT_PUBLIC_SENTRY_DSN` или `SENTRY_DSN` (DSN из проекта в sentry.io).
3. Добавьте инициализацию и отправку ошибок по [документации Sentry для Next.js](https://docs.sentry.io/platforms/javascript/guides/nextjs/) (файлы `instrumentation.ts`, `sentry.server.config.ts`, вызов `captureException` в `app/error.tsx` и `app/global-error.tsx`).

## Документация

Идеи и планы развития — в папке `docs/` (например, `IDEAS_EXTENDED.md`, `ADMIN_IDEAS.md`).

## Лицензия

Private.
