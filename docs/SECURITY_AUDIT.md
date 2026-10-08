# Анализ безопасности rocketchat-scheduler

**Дата:** 2026-02-11  
**Тип:** Вертикальный и горизонтальный аудит  
**Обновлено:** 2026-02-11 — реализованы рекомендации

---

## 1. Аутентификация и авторизация

### Реализовано

| Компонент | Реализация |
|-----------|------------|
| Механизм | JWT (jsonwebtoken), cookie `auth-token` |
| Хеширование паролей | bcrypt, 12 раундов |
| Сессия | httpOnly, secure (prod), sameSite: lax |
| Защита от перехвата | device ID, fingerprint (UA + Accept-Language + sec-ch-ua), опционально IP |
| Rate limit входа | 10 неудачных попыток / 15 мин по IP |
| Блокировка пользователей | `isUserEffectivelyBlocked()` |

**Файлы:** `lib/auth.ts`, `middleware.ts`, `app/api/auth/*`

### Реализовано (2026-02-11)

- **JWT в middleware** — валидация токена через `jose.jwtVerify` для доступа к `/dashboard`.
- **requireAdmin(), requireSupportOrAdmin()** — централизованные проверки в `lib/auth.ts`.
- **Invite token rate limit** — 30 запросов/мин с одного IP (`isInviteTokenRateLimited`).

### Пробелы

1. **JWT secret по умолчанию** — `DEFAULT_JWT_SECRET = 'your-secret-key'`; в dev можно случайно запустить с ним.

---

## 2. API и валидация входных данных

### Реализовано

| Утилита | Назначение | Использование |
|---------|------------|---------------|
| `isUnsafeId()` | Path params (workspaceId, messageId и т.д.) | Многие роуты |
| `isSuspiciousInput()` | SQL/XSS-подобные паттерны | login, register, workspace credentials |
| `isPathTraversal()` | Path traversal | help/download |
| Prisma ORM | Параметризованные запросы | Нет raw SQL с пользовательским вводом |

**Файлы:** `lib/security.ts`, `app/api/**/route.ts`

### Пробелы

1. **Нет Zod** — Zod в зависимостях, но не используется для валидации тел запросов.
2. **Неполная валидация ID** — в `messages/route.ts` и др. `workspaceId`, `filterUserId`, `channelId` могут не проходить `isUnsafeId`.
3. **Cron без CRON_SECRET** — если `CRON_SECRET` не задан, `/api/cron/send-messages` и `/api/cron/cleanup-archives` доступны без авторизации.
4. **Health endpoint** — при отсутствии `HEALTH_CHECK_SECRET` health доступен публично (допустимо для мониторинга, но стоит учитывать).

---

## 3. Защита данных

### Реализовано

| Данные | Хранение | Защита |
|--------|----------|--------|
| Пароли пользователей | PostgreSQL | bcrypt (12 раундов) |
| Пароли пространств RC | `encryptedPassword` | AES-256-GCM (`lib/encryption.ts`) |
| JWT | Cookie | httpOnly, secure (prod), sameSite |
| `ENCRYPTION_KEY` | .env | Обязателен в production |

**Файлы:** `lib/auth.ts`, `lib/encryption.ts`, `prisma/schema.prisma`

### Пробелы

1. **RC auth tokens в открытом виде** — `authToken` в `WorkspaceConnection` хранится без шифрования; при компрометации БД доступны сессии RC.
2. **Fallback ключа шифрования** — при отсутствии `ENCRYPTION_KEY` используется `JWT_SECRET`; один ключ для разных целей.
3. **Шифрование БД** — зависит от настройки PostgreSQL/облака.

---

## 4. Web-безопасность

### Реализовано

| Заголовок | Значение |
|-----------|----------|
| X-Frame-Options | DENY |
| X-Content-Type-Options | nosniff |
| Referrer-Policy | strict-origin-when-cross-origin |
| Permissions-Policy | camera=(), microphone=(), geolocation=() |
| HSTS | max-age=31536000 (prod) |
| CORS | Проверка origin/referer для POST/PUT/PATCH/DELETE |
| Rate limit API | 300 req/min по IP |

**Файлы:** `middleware.ts`

### Пробелы

1. **CSP ослаблен** — `script-src` содержит `'unsafe-inline'` и `'unsafe-eval'`, снижает защиту от XSS.
2. **Help HTML** — `HelpHtmlContent.tsx` использует `dangerouslySetInnerHTML`; HTML от админов может содержать XSS при отсутствии санитизации.
3. **CSRF** — защита через SameSite и origin; явных CSRF-токенов нет.

---

## 5. Инфраструктура и конфигурация

### Реализовано

| Переменная | Обязательность | Назначение |
|------------|----------------|------------|
| DATABASE_URL | Да | Валидация в `lib/env.ts` |
| JWT_SECRET | Да | Должен отличаться от дефолта в prod |
| ENCRYPTION_KEY | Prod | Для паролей пространств |
| CRON_SECRET | Опционально | Cron endpoints |
| HEALTH_CHECK_SECRET | Опционально | Health endpoint |

**Файлы:** `lib/env.ts`, `.env.example`, `instrumentation.ts`

### Пробелы

1. **Docker от root** — нет отдельного непривилегированного пользователя.
2. **Нет HEALTHCHECK** — в Dockerfile нет инструкции `HEALTHCHECK`.
3. **`--unsafe-perm`** — используется в `npm install`, может быть нежелательно в некоторых окружениях.

---

## 6. Интеграции (Rocket.Chat)

### Реализовано

- Учётные данные передаются только на сервере.
- `encodeURIComponent` для параметров URL.
- Таймауты для edit/emoji (30s, 10s).
- Проверка доступа к пространству перед использованием учётных данных.

**Файлы:** `lib/rocketchat.ts`, `lib/workspace-rc.ts`

### Пробелы

1. **SSRF** — `workspaceUrl` не проверяется на localhost, 127.0.0.1, внутренние IP; возможна атака на внутренние сервисы.
2. **Логирование** — при ошибках в тело запроса могут попадать admin credentials.
3. **TLS** — используется поведение Node.js по умолчанию, явной настройки верификации нет.

---

## 7. Аудит и логирование

### Реализовано

| Тип события | Описание |
|-------------|----------|
| LOGIN_FAILED | Неудачный вход |
| LOGIN_RATE_LIMIT | Превышен лимит входа |
| AUTH_RATE_LIMIT | Превышен лимит auth |
| INVALID_TOKEN | Невалидный токен |
| UNAUTHORIZED_ACCESS | Неавторизованный доступ |
| SUSPICIOUS_INPUT | Подозрительный ввод |
| PATH_TRAVERSAL_ATTEMPT | Path traversal |
| SESSION_HIJACK_ATTEMPT | Подозрение на перехват сессии |
| BLOCKED_USER_LOGIN | Вход заблокированного пользователя |

**Файлы:** `lib/security.ts`, модель `SecurityEvent`

### Пробелы

1. **Ошибки** — `app/error.tsx` и `app/global-error.tsx` используют `console.error(error)`; в dev возможна утечка stack trace.
2. **Cron 500** — в ответе возвращается `details: error.message`, возможна утечка внутренней информации.
3. **Help download** — в `details` логируется `file?.slice(0, 200)`; может содержать пользовательский ввод.

---

## 8. Рекомендации по приоритетам

### Высокий приоритет

| # | Рекомендация | Файлы |
|---|--------------|-------|
| 1 | **Обязательный CRON_SECRET в production** — отклонять запросы к cron, если `CRON_SECRET` не задан. | `app/api/cron/*/route.ts` |
| 2 | **Валидация JWT в middleware** — проверять не только наличие, но и валидность токена для `/dashboard`. | `middleware.ts` |
| 3 | **Санитизация Help HTML** — использовать DOMPurify или аналог перед `dangerouslySetInnerHTML`. | `components/_components/HelpHtmlContent.tsx` |
| 4 | **Шифрование RC auth tokens** — хранить `authToken` зашифрованным, как `encryptedPassword`. | `lib/workspace-rc.ts`, `prisma/schema.prisma` |
| 5 | **Валидация workspaceUrl на SSRF** — блокировать localhost, 127.0.0.1, 10.x, 172.16.x, 192.168.x. | `app/api/workspace/route.ts`, `lib/workspace-rc.ts` |

### Средний приоритет

| # | Рекомендация | Файлы |
|---|--------------|-------|
| 6 | **Ужесточить CSP** — убрать `unsafe-eval`, по возможности сократить `unsafe-inline`. | `middleware.ts` |
| 7 | **Zod-схемы** — валидировать тела запросов во всех API. | Все `app/api/**/route.ts` |
| 8 | **`requireAdmin()`** — централизовать проверку роли админа. | `lib/auth.ts`, admin routes |
| 9 | **Docker non-root** — добавить пользователя и запускать от него. | `Dockerfile` |
| 10 | **Валидация ID** — применять `isUnsafeId` ко всем динамическим ID. | `app/api/messages/route.ts` и др. |

### Низкий приоритет

| # | Рекомендация | Файлы |
|---|--------------|-------|
| 11 | **Rate limit для invite token** — ограничить перебор токенов. | `app/api/auth/invite/[token]/route.ts` |
| 12 | **Отдельный ENCRYPTION_KEY** — не использовать JWT_SECRET как fallback. | `lib/encryption.ts` |
| 13 | **HEALTHCHECK в Dockerfile** — добавить проверку здоровья контейнера. | `Dockerfile` |
| 14 | **Скрытие деталей ошибок в prod** — не возвращать `error.message` в 500 для cron. | `app/api/cron/send-messages/route.ts` |

---

## 9. Матрица покрытия

| Область | Вертикаль (глубина) | Горизонталь (охват) |
|---------|---------------------|---------------------|
| Auth | JWT + bcrypt + fingerprint | Dashboard, API, cron — частично |
| Валидация | isUnsafeId, isSuspiciousInput | Не все роуты |
| Шифрование | AES-256-GCM для паролей | authToken не шифруется |
| Headers | XSS, clickjacking, HSTS | CSP ослаблен |
| Rate limit | Login, API | Cron, invite — нет |
| Логирование | SecurityEvent | Ошибки могут раскрывать детали |
| Интеграции | Credentials server-side | SSRF не проверяется |

---

## 10. Чек-лист для production

- [ ] `JWT_SECRET` задан и отличается от дефолта
- [ ] `ENCRYPTION_KEY` задан отдельно от JWT_SECRET
- [ ] `CRON_SECRET` задан и используется для cron
- [ ] `HEALTH_CHECK_SECRET` задан (если health доступен извне)
- [ ] `COOKIE_SECURE=true` (или false только за доверенным прокси)
- [ ] База данных доступна только из внутренней сети
- [ ] Логи не содержат паролей и токенов
- [ ] Резервные копии БД шифруются
