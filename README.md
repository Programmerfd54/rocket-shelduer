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
| `JWT_SECRET`    | Секрет для подписи JWT (`openssl rand -base64 32`). В production значение из примера (`your-secret-key`) и другие заглушки не принимаются — приложение не стартует. |

**Опциональные:**

| Переменная            | Описание |
|-----------------------|----------|
| `ENCRYPTION_KEY`      | Ключ шифрования паролей/токенов Rocket.Chat (AES-256-GCM, `openssl rand -base64 32`). **В production обязателен**, отдельный от `JWT_SECRET`. Не меняйте на работающей БД: для ротации старый ключ перенесите в `ENCRYPTION_KEY_PREVIOUS`. |
| `CRON_SECRET`         | Секрет для вызова cron-эндпоинтов (`/api/cron/send-messages`, `/api/cron/cleanup-archives`): заголовок `Authorization: Bearer <CRON_SECRET>`. В production без него эндпоинты отвечают 503 (работает встроенный cron). |
| `TRUSTED_PROXY_HOPS`  | Число обратных прокси перед приложением (по умолчанию `1`). IP клиента для rate limit берётся из записи `X-Forwarded-For`, добавленной доверенным прокси. Cloudflare → nginx: `2`. |
| `CORS_ALLOWED_ORIGINS` | Доп. разрешённые Origin через запятую (CSRF/CORS allow-list, точное совпадение). |
| `SUPERUSER_LOGIN` / `SUPERUSER_PASSWORD` | Первый Lead_SUP для `create-superuser` (см. «Деплой в Docker»). |
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
- **Создание админа:** `scripts/create-superuser.ts` выполняется при старте контейнера (или вручную: `docker exec -it <container> npx tsx scripts/create-superuser.ts`). Пользователь с ролью **Lead_SUP** создаётся, **только если в БД ещё нет ни одного Lead_SUP**. Логин — `SUPERUSER_LOGIN` (по умолчанию `admin`), пароль — `SUPERUSER_PASSWORD` (≥ 12 символов) или случайный, который **печатается один раз в лог** (`docker compose logs app`). При первом входе сервер требует задать новый пароль (до этого доступны только эндпоинты смены пароля).
- **Роли:** Lead_SUP (пользователи, настройки, шаблоны), SUP, ADM, MEMBER (волонтёр — MEMBER со сроком доступа). Пользователей добавляют в «Админ панель → Пользователи → Добавить пользователя» (по ссылке-приглашению или сразу). Подробности и матрица прав — `docs/roles-migration-notes.md`.
- **Вход не «держится» (после логина снова просит войти):** если приложение доступно по **HTTP** (без HTTPS), в production cookie с флагом `Secure` не отправляется браузером. Задайте в `.env`: **`COOKIE_SECURE=false`**. При работе через HTTPS (или за прокси с терминацией SSL) оставьте `COOKIE_SECURE` не заданным или `true`.

## Health-check

- **GET** `/api/health` — для мониторинга (Docker, K8s). Проверка приложения и БД: `200` и `{ status, db, latencyMs }` или `503`. В production обязателен `HEALTH_CHECK_SECRET`: передавайте заголовок `X-Health-Secret: <секрет>` (устаревший вариант `?secret=` поддерживается, но попадает в access-логи), иначе `401`.
- **Для ADMIN:** вкладка **Health** в сайдбаре ведёт на `/dashboard/admin/health` — расширенная проверка (БД, задержка, наличие env-переменных без раскрытия значений, NODE_ENV). Данные берутся из **GET** `/api/admin/health` (только для роли ADMIN).

## Безопасность (кратко)

- **Сессии:** JWT (HS256, срок = срок сессии) в httpOnly-cookie + запись `Session` в БД; токены без сессии не принимаются. Выход, «выйти на всех устройствах», смена/сброс пароля отзывают сессии. Деактивированные (`isActive=false`) пользователи теряют доступ сразу.
- **Вход:** лимиты по IP (60 запросов/мин, 10 неудач/15 мин) и по логину (10 неудач/15 мин), одинаковое время ответа для существующих и несуществующих логинов.
- **CSRF/CORS:** изменяющие запросы к `/api/*` принимаются только с Origin из allow-list (origin запроса, `APP_URL`, `CORS_ALLOWED_ORIGINS`) — точное совпадение; `Origin: null` отклоняется.
- **Временный пароль** (`requirePasswordChange`): сервер (middleware + `requireAuth`) пропускает только `/api/auth/*` и `/api/user/set-initial-password`.
- **Cron:** `CRON_SECRET` сравнивается за постоянное время; отправка защищена от двойной (захват сообщения в БД + запрет перекрытия тиков).
- **За прокси:** задайте `TRUSTED_PROXY_HOPS`, в nginx перезаписывайте `X-Forwarded-For $remote_addr`, публикуйте порт приложения только на `127.0.0.1` (`APP_BIND_ADDRESS`).
- **Зависимости:** `npm audit --omit=dev`; обновляйте `next` в пределах 16.x (исправления безопасности middleware/Image Optimization).
- **CSP:** для страниц — nonce на каждый запрос (`script-src 'self' 'nonce-…' 'strict-dynamic'`, без `'unsafe-inline'` для скриптов; `'unsafe-eval'` только в dev). Страницы из-за этого рендерятся динамически. `style-src 'unsafe-inline'` оставлен (инлайновые стили Radix/Tailwind). API отдаёт `Content-Security-Policy: default-src 'none'` и `Cache-Control: no-store`.
- **Cookie:** в production с HTTPS (`COOKIE_SECURE` не `false`) — `__Host-auth-token` и `__Host-device-id` (Secure, Path=/, без Domain: поддомен не может их подбросить). Старые `auth-token`/`device-id` читаются как запасной вариант и удаляются при следующем входе/выходе. По HTTP (`COOKIE_SECURE=false`) и в dev — прежние имена.
- **Загрузки** (`/help-uploads/*`, `/uploads/avatars/*`): только для авторизованных (иначе `401`); URL не изменились, файлы отдаёт `/api/uploads/[bucket]/[name]` с `nosniff`, CSP `sandbox`, `Cache-Control: private`; не-картинки/не-медиа — только скачиванием (`Content-Disposition: attachment`). Суточная квота загрузок справки (`HELP_UPLOAD_DAILY_MAX_FILES`, `HELP_UPLOAD_DAILY_MAX_MB`), лимит загрузок аватара (10 за 10 мин). В Docker загрузки хранятся в volume `help_uploads`/`avatar_uploads`.
- **SSRF:** исходящие запросы к Rocket.Chat и импорт эмодзи идут через undici-диспетчер, который проверяет IP в момент подключения (защита от DNS rebinding); 6to4/Teredo/NAT64 классифицируются по встроенному IPv4.
- **Rate limit между репликами:** неудачные входы (по IP и по учётной записи) и перебор текущего пароля считаются по событиям в БД — общие для всех реплик. Лимиты 300 запросов/мин на IP для `/api`, 60/мин для `/api/auth/*`, загрузки аватара — в памяти процесса; общий лимит задавайте в nginx (`limit_req`, см. `deploy/nginx-example.conf`).

## Cron (продакшен)

- **Отправка сообщений:** вызывайте **GET** или **POST** `/api/cron/send-messages` каждую минуту (например, через Vercel Cron Jobs или системный cron). Если задан `CRON_SECRET`, передавайте заголовок `Authorization: Bearer <CRON_SECRET>`.
- **Очистка архивов:** вызывайте **GET** `/api/cron/cleanup-archives` раз в день (удаляются пространства, у которых истёк срок хранения после архивации). Аналогично при необходимости передавайте `CRON_SECRET`.

## Рейтинг реакций (rocketchat-student.21-school.ru)

Вкладка **«Рейтинг реакций»** в пространстве (роли SUP, Lead_SUP, ADM) появляется только для `rocketchat-student.21-school.ru` — хост проверяется строго, API для других пространств возвращает 403.

- **Правило:** 1 сообщение, на котором у пира есть хотя бы одна реакция, = 1 балл (уникальная пара логин + сообщение). Период — по дате сообщения (у реакций в Rocket.Chat нет времени постановки).
- **Данные:** каждые 15 минут перечитываются сообщения выбранных каналов за текущий месяц (и прошлый, пока его итоги не зафиксированы), записи `ReactionRecord` приводятся к фактическим реакциям. Работает из того же cron, что и отправка сообщений (`/api/cron/send-messages`), отдельный cron не нужен.
- **Публикации:** недельный рейтинг и итоги месяца (1-го числа) ставятся в очередь отложенных сообщений от имени владельца пространства. Итоги месяца фиксируются в `ReactionMonthlyResult`.
- **Пересчёт:** «Публикации → Пересчитать период» заново собирает статистику месяца.

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
