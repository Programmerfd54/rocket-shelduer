# API интенсивов, OrgSpace и плана анонсов

Контракт бэкенда для UI (ТЗ — `docs/intensives-spec.md`). Типы для клиента — **`lib/intensives/types.ts`**
(без серверных импортов, можно импортировать в компоненты). Календарные помощники для клиента —
`lib/intensives/dates.ts` (чистые функции: `dayDate`, `intensiveDayInfo`, `intensivePhase`, `zonedDateTimeToUtc`, …).

## 0. Общие правила

- Авторизация — cookie-сессия, как везде. Заблокированный пользователь → `403`.
- Флаг функции: `SystemSetting["feature:intensives"]` (по умолчанию включён). Если `"false"` — **все** роуты ниже,
  кроме `GET /api/intensives/feature`, отвечают `404 { code: "FEATURE_DISABLED" }`; поля интенсива в
  `POST /api/messages` тоже дают `404`. Данные не удаляются, запланированные сообщения продолжают отправляться.
  Переключает Lead_SUP через `PATCH /api/admin/settings { "feature:intensives": true|false }`.
- Ошибка всегда: `{ error: string, code: IntensivesErrorCode, fieldErrors?: Record<string,string>, ...extra }`.
  `error` — готовый текст для тоста (по-русски), `fieldErrors` — ошибки под полями формы.
- Даты интенсива — `'YYYY-MM-DD'` (окончание **включается**), время — `'HH:mm'` в поясе интенсива,
  моменты — ISO UTC. Пояс — IANA (`Europe/Moscow`).
- Оптимистическая блокировка: у интенсива есть `version`. `PATCH` требует `version`; publish/cancel/archive
  принимают необязательный `version`. Устаревшая версия → `409 VERSION_CONFLICT` (покажите «Обновите страницу»).
- Чужие/черновые объекты отдаются как `404` (не `403`), чтобы не раскрывать их существование.

### Общие коды ошибок

| HTTP | code | Когда |
|---|---|---|
| 400 | `BAD_REQUEST`, `VALIDATION_ERROR` | некорректный ввод (см. `fieldErrors`) |
| 401 | `UNAUTHORIZED` | нет сессии |
| 403 | `FORBIDDEN` | нет права (роль) |
| 404 | `NOT_FOUND`, `FEATURE_DISABLED` | нет объекта / нет доступа / флаг выключен |
| 409 | `VERSION_CONFLICT` | объект изменён другим пользователем |
| 500 | `INTERNAL_ERROR` | внутренняя ошибка (детали не раскрываются) |

## 1. Права

| Действие | LEAD_SUP | SUP | ADM | MEMBER |
|---|---|---|---|---|
| Видеть OrgSpace / опубликованные, отменённые, архивные интенсивы | все | только OrgSpace своих/назначенных подключений | так же | так же |
| Видеть черновики | да | нет | нет | нет |
| Создавать/менять/публиковать/отменять/архивировать интенсив, менять план, пропускать пункт | да | нет | нет | нет |
| OrgSpace: создать/изменить/удалить, привязать подключение, подсказки | да | нет | нет | нет |
| Инструмент привязки старых сообщений | да | нет | нет | нет |
| Планировать сообщение из пункта | да* | да* | да* | да* |

\* — при доступе к целевому пространству (владелец или назначенный) и по всем существующим правилам `POST /api/messages`
(«от имени», архив пространства, время в будущем). Выбор интенсива доступа к пространству не выдаёт.

Действия в `lib/permissions.ts`: `intensives:view` (все роли), `intensives:manage`, `intensives:link-messages`,
`org-spaces:manage` (Lead_SUP).

**Видимость пунктов плана по `audience`:** SUP и Lead_SUP — все; ADM — `ADM` и `ALL`; MEMBER — только `ALL`.
Если вызывающий видит не все пункты, в ответах `partial: true` → UI пишет **«Доступные вам анонсы»**, а прогресс
считается только по видимым пунктам.

**Приватность отправок:** состояние пункта видят все, кто видит пункт. Текст, автор («кто запланировал»),
канал и ошибка отправки — только если вызывающий видит само сообщение: SUP/Lead_SUP — все; остальные — свои и в
доступных им пространствах (`PlanItemSend.canView`). Текст сообщений в историю не копируется.

## 2. Данные (prisma/schema.prisma)

- `OrgSpace { id, name (уникально, без учёта регистра), description, createdById, createdAt, updatedAt }`.
- `WorkspaceConnection.orgSpaceId?` — привязка подключения (SetNull при удалении OrgSpace).
- `Intensive { id, orgSpaceId, name, description, startDate DATE, endDate DATE, timezone, status, publishedAt,
  cancelledAt, cancelReason, archivedAt, createdById?, updatedById?, version }`.
- `IntensivePlanItem { id, intensiveId, position, sourceType, sourceTemplateId?, sourceScope?, sourceVersion?,
  title, body, channel, dayNumber?, time?, audience, categories[], skipped, skipReason?, skippedById?, skippedAt? }` —
  **снимок** шаблона; изменение/удаление шаблона план не меняет.
- `IntensiveEvent { id, intensiveId, planItemId?, messageId?, actorId?, type, details, createdAt }` — неизменяемая история
  (`planItemId`/`messageId` — строки без FK, переживают удаление).
- `ScheduledMessage` + `intensiveId?`, `planItemId?`, `isPlanRepeat` (false), `clientRequestId?` (unique),
  `planEditedFromSnapshot` (false). Сообщения без этих полей работают как раньше.

Перечисления: `IntensiveStatus` = `DRAFT | PUBLISHED | CANCELLED | ARCHIVED`; `PlanItemSourceType` =
`OFFICIAL | USER_TEMPLATE | CUSTOM`; `IntensiveEventType` — см. `INTENSIVE_EVENT_TYPES` в `types.ts`.

Гарантии на уровне БД (миграция `20261008100000_intensives`):
- одна **активная** (PENDING/SENT) не-повторная отправка на пункт — частичный уникальный индекс;
- нет пересечений **опубликованных** интенсивов одного OrgSpace — advisory lock в API + EXCLUDE (btree_gist);
- `endDate >= startDate`, формат времени, день 1..366, причина пропуска обязательна, пункт ⇒ интенсив, пункт сообщения
  принадлежит интенсиву сообщения;
- смена статуса / удаление связанного сообщения автоматически пишет событие истории (`MESSAGE_SENT`,
  `MESSAGE_FAILED`, `MESSAGE_CANCELLED`, `MESSAGE_RETRIED`, `MESSAGE_DELETED`) — в т.ч. от отправщика-крона;
- удаление пользователей/подключений/шаблонов/сообщений историю не удаляет; OrgSpace с интенсивами не удаляется.

## 3. Вычисляемые значения

### Фаза интенсива (`phase`, только для PUBLISHED)
По «сегодня» в поясе интенсива: `UPCOMING` (до начала), `RUNNING` (в периоде), `FINISHED` (после окончания).
Завершение периода ничего не отменяет и не архивирует. `day: { today, dayNumber | null, totalDays }` — «День 3 из 14».

### День N
`дата = startDate + N − 1` календарных дней (без пропуска выходных). Пункт с днём вне периода, без дня или без
времени → `needsSetup: true`, `setupReasons: ('DAY_OUTSIDE_PERIOD' | 'NO_DAY' | 'NO_TIME')[]`.

`recommended: { date, time, utc, dstIssue, isPast }` — рекомендуемые дата/время в поясе интенсива; `utc` — момент для
`scheduledFor`. `dstIssue: 'NONEXISTENT' | 'AMBIGUOUS'` — локального времени нет / оно встречается дважды (переход
часов): UI должен попросить выбрать время явно (`zonedDateTimeToUtc(date, time, tz, 'earlier'|'later')`).
`isPast` — рекомендуемое время прошло (на сегодня автоматически не переносится).

### Состояние пункта (`PlanItemState`) и основное действие UI

| state | Смысл | Основное действие |
|---|---|---|
| `NOT_SCHEDULED` | отправок не было | Запланировать |
| `SCHEDULED` | есть PENDING основная отправка, время не наступило | Открыть сообщение |
| `AWAITING_OVERDUE` | PENDING, но время прошло (ждёт отправщика) | Открыть сообщение (требует внимания) |
| `SENT` | ≥ 1 успешная отправка (основная или повтор) | Посмотреть отправку; «Запланировать повтор» отдельно |
| `FAILED` | последняя основная отправка — ошибка | Открыть ошибку (retry через существующий роут) |
| `CANCELLED` | последняя основная отправка отменена | Запланировать заново |
| `SKIPPED` | пропущен Lead_SUP (с причиной) | Посмотреть причину |

Приоритет: SENT > SKIPPED > (AWAITING_OVERDUE | SCHEDULED) > последняя из FAILED/CANCELLED > NOT_SCHEDULED.

`details: { sentCount, hasFailedRepeat, pendingRepeatAt, hasFailedAttempt, lastSentAt, scheduledFor }` — для текстов
«Отправлено · 1 отправка», «Повтор запланирован на …», «Отправлено · Повтор завершился ошибкой».

### Прогресс (`PlanProgress`)
Считает сервер по **всем** связанным сообщениям (агрегаты, не страница списка), только по видимым вызывающему пунктам:
`total, completed, scheduled (вкл. awaitingOverdue), awaitingOverdue, notScheduled (вкл. cancelled), cancelled, failed,
skipped, needsAttention (= failed + awaitingOverdue + отправленные с ошибкой повтора), remaining (= total − completed − skipped)`.
Пункт с несколькими успешными отправками — выполнен один раз; пропущенный не считается отправленным.
Пример: «Отправлено 18 из 24 · Пропущено 2 · Осталось 4».

## 4. Эндпоинты

### Флаг

`GET /api/intensives/feature` → `{ enabled: boolean, canManage: boolean, canManageOrgSpaces: boolean }` (любой
авторизованный; не отвечает 404 при выключенном флаге).

### OrgSpace

| Метод и путь | Кто | Тело | Ответ |
|---|---|---|---|
| `GET /api/org-spaces` | все | — | `{ orgSpaces: OrgSpaceDto[] }` (Lead_SUP — все с привязанными подключениями; остальные — доступные, подключения — только свои/назначенные; черновики в `intensiveCounts` только для Lead_SUP) |
| `GET /api/org-spaces/[id]` | все | — | `{ orgSpace: OrgSpaceDto }` / 404 |
| `POST /api/org-spaces` | Lead_SUP | `{ name, description? }` | `201 { orgSpace }`; `409 ORG_SPACE_NAME_TAKEN` |
| `PATCH /api/org-spaces/[id]` | Lead_SUP | `{ name?, description? }` | `{ orgSpace }`; `409 ORG_SPACE_NAME_TAKEN` |
| `DELETE /api/org-spaces/[id]` | Lead_SUP | — | `{ success }`; `409 ORG_SPACE_HAS_INTENSIVES { intensiveCount }`. Подключения отвязываются |
| `POST /api/org-spaces/[id]/link` | Lead_SUP | `{ workspaceId, move? }` | `{ success, alreadyLinked }`; `409 WORKSPACE_LINKED_ELSEWHERE { linkedOrgSpace }` (перенос — `move: true`) |
| `DELETE /api/org-spaces/[id]/link?workspaceId=` | Lead_SUP | (или `{ workspaceId }`) | `{ success }`; `409 WORKSPACE_NOT_LINKED`. Уже связанные сообщения остаются связанными |
| `GET /api/org-spaces/suggestions` | Lead_SUP | — | `{ groups: OrgSpaceSuggestionGroup[] }` — подключения, сгруппированные по одному RC (`sameRcInstanceUrl`); только подсказка |
| `POST /api/org-spaces/[id]/draft-from-workspace-dates` | Lead_SUP | `{ workspaceId, name?, timezone? }` | `201 { intensive: IntensiveSummary, existing: false, warnings: { overlaps } }` или `200 { …, existing: true }` для тех же дат. Только DRAFT; старые даты подключения не меняются. `409 WORKSPACE_NOT_LINKED`, `409 WORKSPACE_HAS_NO_DATES` |

Подключение в ответах (`OrgSpaceConnection`) — без токенов и паролей: `id, workspaceName, workspaceUrl, username,
owner {id,name}, isArchived, isActive, startDate, endDate`.

### Интенсивы

**`GET /api/intensives`** — query (все необязательны):
`year` (интенсивы, **пересекающие** год), `orgSpaceId`, `workspaceId` (сервер находит OrgSpace подключения; нужен доступ
к подключению; не привязано → пустой список), `phase` (`upcoming|running|finished` — только PUBLISHED),
`status` (через запятую: `DRAFT,PUBLISHED,CANCELLED,ARCHIVED`; по умолчанию Lead_SUP — `DRAFT,PUBLISHED`, остальные —
`PUBLISHED`; DRAFT для не-Lead_SUP игнорируется), `progress=false` (не считать прогресс).
→ `{ intensives: IntensiveSummary[], orgSpaceId: string | null }` (сортировка по дате начала; до 500 шт.).
Для Lead_SUP у DRAFT/PUBLISHED есть `overlaps` (пересечения в том же OrgSpace — предупреждение).
Тексты сообщений не загружаются.

**`POST /api/intensives`** (Lead_SUP) — `{ orgSpaceId, name, startDate, endDate, timezone='Europe/Moscow', description?,
templateIds?: string[] }` → `201 { intensive: IntensiveSummary, warnings: { overlaps }, plan: { created, alreadyInPlan } | null }`.
Создаёт **черновик**; `templateIds` (официальные) сразу формируют план. Отправки не запускаются.
Ошибки: `VALIDATION_ERROR` (окончание раньше начала, > 366 дней, неизвестный пояс), `404` OrgSpace, `400 UNKNOWN_TEMPLATE { unknownTemplateIds }`.
Вместо `orgSpaceId` можно передать **`workspaceId`** (пространство-подключение, своё или назначенное): если у него ещё нет
OrgSpace, сервер создаёт его (название = название пространства, при совпадении — с коротким суффиксом) и привязывает —
идемпотентно, под `pg_advisory_xact_lock` (`lib/intensives/workspace-schedule.ts`). Передавать оба поля нельзя (`VALIDATION_ERROR`);
недоступное пространство — `404 { fieldErrors.workspaceId }`. UI: вкладка «Интенсивы» на странице пространства, админка «Интенсивы».

**Подсказка «архивировать пространство»** — `GET /api/workspace` и `GET /api/workspace/[id]` отдают для каждого пространства
`archiveSuggested`, `suppressArchivePrompt`, `nextIntensive: { id, name, startDate, endDate, timezone, status } | null`,
`upcomingIntensiveCount`, `canEditArchivePrompt` (один пакетный запрос к Intensive). `archiveSuggested = false`, если пространство
в архиве, Lead_SUP включил «Не предлагать архивировать» (`PATCH /api/workspace/[id] { suppressArchivePrompt }`, только Lead_SUP)
или в графике есть DRAFT/PUBLISHED интенсив с окончанием ≥ «сегодня» в его поясе; иначе — прошёл последний день старого периода
`WorkspaceConnection.endDate`. Черновики защищают от подсказки всегда, но в `nextIntensive`/счётчике видны только Lead_SUP.
Автоочистка архива (`/api/cron/cleanup-archives`) не удаляет подключения, чей OrgSpace содержит интенсивы (любой статус).

**`GET /api/intensives/[id]`** → `{ intensive: IntensiveDetail }` (карточка + прогресс + `workspaces` — подключения OrgSpace,
доступные вызывающему (Lead_SUP — все) + `planItemCount`, `linkedMessageCount`, `createdBy`, `updatedBy`, `cancelReason`).

**`PATCH /api/intensives/[id]`** (Lead_SUP) — `{ version, name?, description?, startDate?, endDate?, timezone?,
confirmImpact?, outOfRangeResolution? }` → `{ intensive: IntensiveDetail, impact: DateChangeImpact | null }`.
Смена дат/пояса:
1. Если есть связанные сообщения — `409 IMPACT_CONFIRMATION_REQUIRED { impact }`. Показать `impact.affectedItems`
   (пункты без отправок, у которых сдвинется рекомендуемая дата), `itemsWithSends` (их сообщения **не меняются**),
   `messagesOutsideNewRange`. Повторить с `confirmImpact: true`.
2. Если ожидающие (PENDING) сообщения окажутся вне нового периода — `409 OUT_OF_RANGE_DECISION_REQUIRED { impact }`;
   повторить с `outOfRangeResolution`: `keep_linked` (оставить как есть), `detach` (снять привязку), `cancel` (отменить).
Время существующих сообщений сервер не меняет никогда. Для PUBLISHED новые даты проверяются на пересечение
(`409 INTENSIVE_OVERLAP`). Даты CANCELLED/ARCHIVED не меняются (`409 INTENSIVE_READ_ONLY`).

**`POST /api/intensives/[id]/publish`** (Lead_SUP) — `{ version? }` → `{ intensive }`. Только из DRAFT
(`409 INVALID_STATUS_TRANSITION`). Пересечение с опубликованным интенсивом того же OrgSpace →
`409 INTENSIVE_OVERLAP { conflicts: IntensiveOverlapRef[] }` (при гонке на уровне БД `conflicts` может быть пустым).

**`POST /api/intensives/[id]/cancel`** (Lead_SUP) — `{ version?, reason?, resolution? }` → `{ intensive, affectedMessages, resolution }`.
Из DRAFT/PUBLISHED. Есть ожидающие отправки и нет `resolution` → `409 PENDING_MESSAGES_EXIST { pendingMessages:
[{ messageId, planItemId, scheduledFor, workspaceId, isPlanRepeat }] }`. `resolution`:
`cancel_messages` — PENDING → CANCELLED (как при архивировании пространства; сообщение, уже взятое отправщиком, может уйти),
`detach_messages` — снять привязку к интенсиву/пункту, сообщения остаются запланированными.

**`POST /api/intensives/[id]/archive`** (Lead_SUP) — `{ version? }` → `{ intensive, pendingMessages }`. Из DRAFT, CANCELLED
или завершившегося PUBLISHED (`409 INTENSIVE_NOT_FINISHED`). Сообщения и пространство не затрагиваются.

### План

**`GET /api/intensives/templates?intensiveId=`** (Lead_SUP) → `{ templates: OfficialTemplateOption[] }` — официальные
шаблоны с глобальными переопределениями (`inPlan` при `intensiveId`). Для диалога выбора состава плана.

**`GET /api/intensives/[id]/plan`** → `PlanResponse`:
`{ intensive: IntensiveSummary, items: PlanItemDto[], days: PlanDayGroup[], unscheduledDayItemIds, progress, partial }`.
`items` отсортированы по дню, времени, позиции; `days` — группы «День 1 · Понедельник, 12 октября / 4 анонса · Выполнено 2 из 4»
(`isoWeekday` 1 = пн). У Lead_SUP `updateAvailable` у пунктов с новой версией источника.
`hasEverLinkedMessages: true` → снимок не редактируется и пункт не удаляется (только пропуск).

**`POST /api/intensives/[id]/plan/generate`** (Lead_SUP) — `{ templateIds: string[] }` → `201|200 { created: string[], alreadyInPlan: string[] }`.
Идемпотентно по источнику. `400 UNKNOWN_TEMPLATE`. `409 INTENSIVE_READ_ONLY` для CANCELLED/ARCHIVED.

**`POST /api/intensives/[id]/plan/items`** (Lead_SUP) — свой пункт `{ title?, body, channel, dayNumber?, time?, audience='ALL', categories? }`
или снимок своего пользовательского шаблона `{ sourceUserTemplateId, audience, …переопределения }` → `201 { item }`.
`409 PLAN_ITEM_DUPLICATE_SOURCE` — шаблон уже в плане.

**`PATCH /api/intensives/[id]/plan/items/[itemId]`** (Lead_SUP) — `{ title?, body?, channel?, dayNumber?, time?, audience?,
categories?, position?, skipped?, skipReason? }` → `{ item }`.
Поля снимка — только без отправок (`409 PLAN_ITEM_HAS_MESSAGES`). Пропуск — `{ skipped: true, skipReason }`
(нельзя при активной отправке: `409 PLAN_ITEM_ACTIVE_SEND { existingMessageId }`), вернуть — `{ skipped: false }`.

**`DELETE /api/intensives/[id]/plan/items/[itemId]`** (Lead_SUP) → `{ success }`; `409 PLAN_ITEM_HAS_MESSAGES`, если
отправки когда-либо привязывались.

**`GET /api/intensives/[id]/plan/updates`** (Lead_SUP) → `{ updates: PlanUpdateEntry[] }` — «Доступна новая версия
шаблона → отличия» (`diff: [{ field, from, to }]`, `applicable: false` — у пункта есть отправки).

**`POST /api/intensives/[id]/plan/items/[itemId]/apply-update`** (Lead_SUP) → `{ item }`; `409 NO_UPDATE_AVAILABLE`,
`409 PLAN_ITEM_HAS_MESSAGES`.

### Планирование сообщения из пункта — расширение `POST /api/messages`

Тело — как раньше (`workspaceId, channelId, channelName, message, scheduledFor, asUserId?, sourceUserTemplateId?,
sourceOfficialTemplateId?`) **плюс необязательные**:

| Поле | Тип | Смысл |
|---|---|---|
| `intensiveId` | string | интенсив (обязателен, если указан `planItemId`) |
| `planItemId` | string | пункт плана этого интенсива |
| `clientRequestId` | string 8–100 `[A-Za-z0-9_.:-]` | ключ идемпотентности: новый UUID на каждое открытие формы; при повторе после сбоя сети — тот же |
| `isPlanRepeat` | boolean | явный повтор после успешной отправки |

Сервер проверяет все прежние правила + интенсив `PUBLISHED`, подключение привязано к OrgSpace интенсива, пункт
принадлежит интенсиву, виден роли и не пропущен, дата отправки **в периоде интенсива по его поясу**; создаёт сообщение,
связь и событие истории в одной транзакции. Ответ — как раньше: `200 { success: true, message }`
(+ `idempotent: true` при повторе с тем же `clientRequestId`). Ручная правка текста сохраняет связь
(`message.planEditedFromSnapshot = true`). Отправитель автоматически не меняется. `sourceOfficialTemplateId` сервер
не подставляет (передавайте, если нужно, как раньше).

Ошибки (новые):

| HTTP | code | Когда / что делать |
|---|---|---|
| 409 | `PLAN_ITEM_ALREADY_SCHEDULED { existingMessageId }` | у пункта уже есть активная отправка → «Это сообщение уже запланировано», предложить открыть существующее; **форму не очищать** |
| 409 | `REPEAT_REQUIRES_SENT` | повтор без успешной отправки |
| 409 | `PLAN_ITEM_SKIPPED` | пункт пропущен |
| 409 | `INTENSIVE_NOT_PUBLISHED` | интенсив не опубликован |
| 409 | `IDEMPOTENCY_KEY_CONFLICT` | ключ принадлежит чужому запросу → сгенерировать новый |
| 400 | `OUT_OF_INTENSIVE_PERIOD { startDate, endDate, timezone, localDate, fieldErrors.scheduledFor }` | дата вне периода (для подготовительных — режим «без привязки») |
| 400 | `WORKSPACE_NOT_IN_INTENSIVE_SPACE` | подключение не относится к OrgSpace интенсива |
| 403 | `PLAN_ITEM_NOT_VISIBLE` | пункт не для этой роли |
| 404 | `PLAN_ITEM_NOT_FOUND`, `NOT_FOUND`, `FEATURE_DISABLED` | |

Остальные ошибки `POST /api/messages` — прежнего формата `{ error }`.

**`GET /api/messages`**: у сообщений есть `intensiveId`, `planItemId`, `isPlanRepeat`, `planEditedFromSnapshot`,
`clientRequestId`. Новые необязательные фильтры: `intensiveId=<id>` или `intensiveId=none` (режим «Без привязки к
интенсиву» / «История использования вне интенсивов»), `planItemId=<id>`. `GET /api/messages/[id]` тоже отдаёт эти поля.

**Существующие роуты для связанных сообщений** работают как раньше: изменить (`PATCH /api/messages/[id]` — новое время
должно остаться в периоде интенсива, иначе `400 OUT_OF_INTENSIVE_PERIOD`), удалить, повторить
(`POST /api/messages/[id]/retry` — `409 PLAN_ITEM_ALREADY_SCHEDULED`, если пункт уже занят другой активной отправкой).
События истории для смены статуса и удаления пишет БД.

### История

**`GET /api/intensives/[id]/history?cursor=&limit=50&planItemId=`** → `{ events: IntensiveEventDto[], nextCursor }`
(новые сверху, `limit` ≤ 200; следующая страница — `cursor=nextCursor`). Для недоступных вызывающему сообщений
`redacted: true`, `actor: null`, в `details` только статусы и время. События пунктов, скрытых по аудитории, не отдаются.
Детали по типам: `MESSAGE_SCHEDULED/REPEAT_SCHEDULED { scheduledFor, workspaceId, channelName, authorId, scheduledById,
planEditedFromSnapshot }`, `MESSAGE_SENT|FAILED|CANCELLED|RETRIED { fromStatus, toStatus, scheduledFor, sentAt, error,
channelName, rcMessageId, … source: 'db_trigger' }`, `MESSAGE_DELETED { status, scheduledFor, sentAt, … }`,
`INTENSIVE_UPDATED { changes: { field: { from, to } } }`, `PLAN_ITEM_SKIPPED { reason }` и т.д.
Детальный список отправок по пункту — в `GET …/plan` (`items[].sends`), ссылка на RC — `GET /api/messages/[id]` (`rcPermalink`).
История попыток отправки появляется только с момента внедрения (старые данные не выдумываются).

### Привязка старых сообщений (Lead_SUP)

**`GET /api/intensives/[id]/link-candidates`** → `{ candidates: LinkCandidate[], truncated }` — сообщения без интенсива
в подключениях OrgSpace, в периоде (по поясу интенсива; для SENT — по факту отправки), созданные из тех же шаблонов,
что и пункты (`sourceOfficialTemplateId` / `sourceUserTemplateId`). `wouldConflict: true` — у пункта уже есть активная
отправка, привязка будет отклонена. По дате диапазона автоматически ничего не привязывается.

**`POST /api/intensives/[id]/link-messages`** — `{ links: [{ messageId, planItemId }] }` (≤ 500) →
`{ results: LinkResult[], summary: Record<result, number>, processed }`. Идемпотентно; меняет только
`intensiveId/planItemId` (текст, время, автор, отправитель, статус — нет). `result`: `linked | already_linked |
linked_elsewhere | conflict_active_send | outside_period | not_in_org_space | item_not_found | item_skipped | message_not_found`.
Для CANCELLED-интенсива — `409 INTENSIVE_READ_ONLY`.

## 5. Подсказки для UI

- Первоначальный выбор интенсива в пространстве: `?intensive=` → `GET /api/intensives?workspaceId=…` →
  текущий (`phase: RUNNING`) → ближайший `UPCOMING` → «Без привязки». Принадлежность проверять при смене пространства
  (интенсив должен быть в ответе для этого `workspaceId`).
- Годовой календарь: `GET /api/intensives?year=2026&status=PUBLISHED[,DRAFT,CANCELLED,ARCHIVED]&progress=true` — строки по
  `orgSpace`, полоса `startDate..endDate`, даты — в поясе интенсива; текущий день — `day`.
- Планирование из пункта: предзаполнить форму `body`, `channel`, `recommended.date/time` (если `dstIssue` — попросить
  выбрать время), `scheduledFor = recommended.utc`; отправить `intensiveId`, `planItemId`, `clientRequestId`
  (UUID на открытие формы). После ответа перезагрузить `GET …/plan`.
- Повтор после успеха — отдельное действие («Запланировать повтор»): `isPlanRepeat: true`.
- Ошибка загрузки ≠ «План пуст»: пустой план — `items: []` при `200`.
