# Полный отчёт аудита безопасности rocketchat-scheduler

**Дата:** 2026-03-14  
**Область:** lib/, app/api/, middleware.ts, components/, prisma/

---

## Executive Summary

Приложение rocketchat-scheduler — планировщик сообщений для Rocket.Chat на Next.js — имеет продуманную модель безопасности: JWT, bcrypt, шифрование паролей пространств, защита от SSRF, санитизация HTML, проверки прав. Реализованы rate limiting, логирование событий безопасности, защита от path traversal и проверка ID.

**Основные риски (частично устранены):**
1. ~~**Cron без CRON_SECRET**~~ — **ИСПРАВЛЕНО:** в production без `CRON_SECRET` возвращается 503.
2. **CSP с unsafe-inline** — снижает защиту от XSS.
3. **Health endpoint** — при отсутствии `HEALTH_CHECK_SECRET` доступен публично.
4. **Разные проверки прав** — вместо `requireAdmin()`/`requireAction()` используются inline-проверки `user.role !== 'ADMIN'`.
5. ~~**Нет валидации `workspaceId` в POST /api/messages**~~ — **ИСПРАВЛЕНО:** добавлена `isUnsafeId` для workspaceId, channelId, asUserId.

**Сильные стороны:**
- Шифрование RC auth tokens (`encryptAuthToken`/`decryptAuthToken`).
- SSRF-защита для `workspaceUrl` (`assertSafeWorkspaceUrl`).
- Санитизация HTML (DOMPurify) для Help и Message preview.
- Защита сессий (device ID, fingerprint, User-Agent).
- Path traversal защита в help/download.
- Prisma ORM — параметризованные запросы, нет raw SQL с пользовательским вводом.

---

## Детальные находки

### 1. Аутентификация и авторизация

| Компонент | Статус | Детали |
|-----------|--------|--------|
| JWT | ✅ | HS256, проверка в middleware и `getCurrentUser`, `jose.jwtVerify` в Edge |
| Пароли | ✅ | bcrypt 12 раундов, не возвращаются в ответах |
| Cookie | ✅ | httpOnly, secure (prod), sameSite: lax |
| Сессии | ✅ | device ID, fingerprint, User-Agent, опционально IP (`SESSION_BIND_IP`) |
| requireAuth | ✅ | Используется во всех защищённых API |
| requireAdmin | ⚠️ | В `lib/auth.ts` есть, но в API почти везде inline `user.role !== 'ADMIN'` |
| requireAction | ⚠️ | Используется только в `workspace/[id]/archive` |
| JWT_SECRET | ⚠️ | Дефолт `your-secret-key`; в production проверяется, но в dev возможен запуск с ним |

**Файлы:** `lib/auth.ts`, `lib/permissions.ts`, `middleware.ts`

---

### 2. Векторы атак

#### XSS
- **HelpHtmlContent** — `sanitizeHelpHtml` (DOMPurify) перед `dangerouslySetInnerHTML` ✅  
- **MessagePreview** — `sanitizeMessageHtml` после парсинга markdown ✅  
- **HelpRichEditor** — `sanitizeSvgIcon` для иконок ✅  
- **span.innerHTML** в HelpHtmlContent — используется `sanitizeSvgIcon` для доверенных иконок ✅  

#### CSRF
- SameSite: lax, проверка origin/referer для POST/PUT/PATCH/DELETE в middleware ✅  
- Явных CSRF-токенов нет — допустимо при SameSite и проверке origin.

#### SQL Injection
- Prisma ORM — параметризованные запросы ✅  
- Raw SQL только `prisma.$queryRaw\`SELECT 1\`` и `SELECT version()` — без пользовательского ввода ✅  

#### SSRF
- `assertSafeWorkspaceUrl` при добавлении/обновлении workspace ✅  
- Блокируются localhost, 127.x, 10.x, 172.16–31.x, 192.168.x, link-local, .localhost, .local ✅  
- `lib/ssrf.ts` покрыт тестами ✅  

#### Path Traversal
- **help/download** — проверка `/[\\/]/.test(file)`, `file.startsWith('..')`, `path.resolve` и проверка, что путь внутри `UPLOAD_DIR` ✅  
- **Path params** — `isUnsafeId` для workspaceId, messageId и т.п. в большинстве роутов ✅  

#### IDOR
- **workspace/[id]** — проверка владельца или назначения ✅  
- **messages/[id]** — проверка владельца или роли (SUPPORT/ADMIN) или назначения ✅  
- **messages GET** — проверка доступа к workspace при фильтре по workspaceId ✅  
- **emoji-image** — workspace ищется по `userId: user.id` ✅  

#### Mass Assignment
- **admin/users/[id] PATCH** — только `name`, `email`, `username`, `newPassword` ✅  
- **admin/users POST** — явный whitelist полей ✅  
- **user/profile** — только `name`, `username`, `sessionDurationMinutes` ✅  
- **admin/help/*** — whitelist полей (title, content, order, roles и т.д.) ✅  
- **admin/users/route.ts** — `data as any` при create, но `data` собирается из whitelist ⚠️  

#### Rate Limiting
- Login: 10 неудачных попыток / 15 мин по IP ✅  
- Auth endpoints: 60 req/min по IP ✅  
- Invite token: 30 req/min по IP ✅  
- API: 300 req/min по IP в middleware ✅  

---

### 3. Frontend

| Место | Санитизация | Риск |
|-------|-------------|------|
| HelpHtmlContent | sanitizeHelpHtml | Низкий |
| MessagePreview | sanitizeMessageHtml | Низкий |
| HelpRichEditor (иконки) | sanitizeSvgIcon | Низкий |
| span.innerHTML (иконки) | sanitizeSvgIcon | Низкий |
| catalogs/[id] preview | sanitizeHelpHtml | Низкий |

**CSP (middleware):** `script-src 'self' 'unsafe-inline'` — `unsafe-inline` ослабляет защиту от XSS.

---

### 4. Backend

#### Валидация входных данных
- `isUnsafeId` — для path params в workspace, messages, admin routes ✅  
- `isSuspiciousInput` — login, register, workspace credentials ✅  
- **Пробел:** `workspaceId` в POST /api/messages не проверяется через `isUnsafeId` (Prisma защищает от SQL injection, но валидация формата ID желательна).

#### Prisma / БД
- Параметризованные запросы ✅  
- Нет raw SQL с пользовательским вводом ✅  

#### Секреты и env
- `JWT_SECRET` — обязателен в production, проверка дефолта ✅  
- `ENCRYPTION_KEY` — обязателен в production ✅  
- `CRON_SECRET` — опционален; при отсутствии cron доступен без авторизации ⚠️  
- `HEALTH_CHECK_SECRET` — опционален; при отсутствии health публичен ⚠️  

---

### 5. Архитектура и взаимосвязи

#### Защита узлов
| Эндпоинт | Защита |
|----------|--------|
| /api/cron/send-messages | Bearer CRON_SECRET (если задан) |
| /api/cron/cleanup-archives | Bearer CRON_SECRET (если задан) |
| /api/cron/health | Bearer CRON_SECRET (если задан) |
| /api/health | Опционально ?secret=HEALTH_CHECK_SECRET |
| /api/auth/invite/[token] | Публичный, rate limit 30/мин |
| /api/help/download | requireAuth (getCurrentUser) |

**Проблема:** без `CRON_SECRET` в production cron доступен всем.

#### Rocket.Chat API
- `workspaceUrl` проверяется на SSRF при добавлении/обновлении ✅  
- Credentials только на сервере ✅  
- `getEffectiveConnectionForRc` проверяет владение/назначение workspace ✅  

#### Шифрование токенов
- `encryptAuthToken` / `decryptAuthToken` для RC auth tokens ✅  
- AES-256-GCM, отдельный `ENCRYPTION_KEY` в production ✅  

---

### 6. Инфраструктура

#### Docker
- Непривилегированный пользователь `nextjs` (uid 1001) ✅  
- HEALTHCHECK: `curl -sf http://localhost:3000/api/health` ✅  
- `--unsafe-perm` в npm install — может быть нежелательно в строгих окружениях ⚠️  

#### Заголовки безопасности (middleware)
- X-Frame-Options: DENY ✅  
- X-Content-Type-Options: nosniff ✅  
- Referrer-Policy: strict-origin-when-cross-origin ✅  
- Permissions-Policy ✅  
- HSTS в production ✅  
- CSP с `unsafe-inline` ⚠️  

#### CORS
- Проверка origin/referer для POST/PUT/PATCH/DELETE ✅  
- Access-Control-Allow-Credentials: true ✅  

---

## Рекомендации

### Высокий приоритет

| # | Рекомендация | Статус |
|---|--------------|--------|
| 1 | **Обязательный CRON_SECRET в production** — отклонять запросы к cron, если `CRON_SECRET` не задан. | ✅ Реализовано |
| 2 | **Валидация workspaceId в POST /api/messages** — применять `isUnsafeId` к workspaceId, channelId, asUserId. | ✅ Реализовано |
| 3 | **Усиление CSP** — убрать `unsafe-eval` (если не нужен), рассмотреть nonce/hash вместо `unsafe-inline`. | ⏳ Ожидает |
| 4 | **Content-Disposition в help/download** — экранировать `filename` (удалить `\r`, `\n`, кавычки) для защиты от header injection. | ✅ Реализовано |

### Средний приоритет

| # | Рекомендация | Файлы |
|---|--------------|-------|
| 5 | **Централизация проверок прав** — использовать `requireAdmin()`, `requireAction()` вместо inline-проверок. | `app/api/admin/**`, `lib/auth.ts`, `lib/permissions.ts` |
| 6 | **Схемы валидации (Zod)** — валидировать тела запросов во всех API. | `app/api/**/route.ts` |
| 7 | **HEALTH_CHECK_SECRET по умолчанию в production** — требовать секрет для /api/health в production. | `app/api/health/route.ts` |
| 8 | **Скрытие деталей ошибок в production** — не возвращать `error.message` в 500 для cron. | `app/api/cron/send-messages/route.ts` |
| 9 | **Валидация catalogId в FAQ PATCH** — проверять существование и допустимость catalogId. | `app/api/admin/help/faq/[id]/route.ts` |

### Низкий приоритет

| # | Рекомендация | Файлы |
|---|--------------|-------|
| 10 | **Отдельный ENCRYPTION_KEY** — не использовать JWT_SECRET как fallback. | `lib/encryption.ts` |
| 11 | **Убрать --unsafe-perm** — если возможно, перейти на установку без него. | `Dockerfile` |
| 12 | **Логирование в help/download** — не включать пользовательский ввод в `details` (или ограничить длину). | `app/api/help/download/route.ts` |

---

## Приоритеты

```
Критический:  CRON без секрета в production
Высокий:      CSP unsafe-inline, валидация workspaceId, Content-Disposition
Средний:      Централизация requireAdmin/requireAction, Zod, HEALTH_CHECK_SECRET
Низкий:       ENCRYPTION_KEY fallback, --unsafe-perm, логирование
```

---

## Матрица покрытия

| Область | Реализовано | Пробелы |
|---------|-------------|---------|
| Auth | JWT, bcrypt, сессии, fingerprint | Inline-проверки вместо requireAdmin |
| Валидация | isUnsafeId, isSuspiciousInput, path traversal | workspaceId в POST messages |
| Шифрование | AES-256-GCM, RC tokens | Fallback на JWT_SECRET |
| XSS | DOMPurify для Help и Message | CSP unsafe-inline |
| SSRF | assertSafeWorkspaceUrl | — |
| IDOR | Проверки владельца/назначения | — |
| Rate limit | Login, Auth, Invite, API | — |
| Cron | Bearer CRON_SECRET | ~~Обязательность в production~~ ✅ |
| Инфраструктура | Non-root в Docker, HEALTHCHECK | — |

---

## Changelog (2026-03-14)

**Реализовано по результатам аудита:**
- CRON: в production без `CRON_SECRET` возвращается 503; с секретом — обязательная Bearer-авторизация
- POST /api/messages: валидация `isUnsafeId` для workspaceId, channelId, asUserId
- help/download: экранирование filename (`\r`, `\n`, `"`, `\`) в Content-Disposition для защиты от header injection
- HEALTH_CHECK_SECRET: в production обязателен; без него /api/health возвращает 503
- ENCRYPTION_KEY: убран fallback на JWT_SECRET (только ENCRYPTION_KEY или DEFAULT)
- Централизация requireAdmin: admin help routes, admin/health, admin/settings, admin/security/events используют `requireAdmin()` вместо inline-проверок
