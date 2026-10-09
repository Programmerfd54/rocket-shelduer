# API официальных шаблонов и словаря каналов

Контракт бэкенда для UI редактора официальных шаблонов (Lead_SUP), выбора шаблонов и селекторов каналов.
Типы для клиента — **`lib/templates/types.ts`** (без серверных импортов; там же `normalizeChannelName`,
`channelNameError`, `CHANNEL_NAME_RE`, `TEMPLATE_LIMITS`). Связанное: `docs/intensives-api.md` (план анонсов).

## 0. Модель

**Официальный шаблон** = один из двух источников, сведённых в единый список
(`lib/templates/official-templates.ts → getEffectiveOfficialTemplates`, единственная точка чтения):

| source | Где хранится | id | Что может Lead_SUP |
|---|---|---|---|
| `builtin` | статичный `lib/templates-data.ts` (ADM_TEMPLATES / SUP_TEMPLATES) + строка `OfficialTemplateOverride` (scope, templateId) | исходный (`d1-09`, `sup-intro-announcements`) | изменить любое поле (переопределение), сбросить к умолчанию, удалить (скрыть, обратимо), восстановить |
| `custom` | `CustomOfficialTemplate` | `c_<cuid>` | создать, изменить любое поле (в т.ч. перенести в другой набор), удалить (безвозвратно) |

Два **набора** (`scope`): `SUP` и `ADM`. Встроенный шаблон принадлежит своему набору; id встроенных в наборах не
пересекаются, но API принимает `scope` для однозначности (как раньше).

Эффективный шаблон (`EffectiveOfficialTemplate`):

```ts
{ id, scope: 'SUP'|'ADM', source: 'builtin'|'custom', isDeleted, isModified,
  title, body, channel, intensiveDay /*1..366*/, dayLabel, time /*'HH:mm'*/, audience: 'all'|'mk',
  timeNote: string|null, version /*хеш содержимого*/, position, updatedAt: string|null }
```

- `isModified` — у встроенного есть переопределение хотя бы одного поля (для custom всегда `false`).
- `dayLabel` — подпись дня; если день встроенного изменён без новой подписи, или у созданного подписи нет —
  `«День N»`.
- `version` — тот же хеш, что `sourceVersion` пунктов плана (title, body, channel, день, время, набор, mk).
  Изменение шаблона → у пунктов плана без отправок Lead_SUP видит «Доступна новая версия».
- Порядок списка: день → время → встроенные раньше созданных → `position` → дата создания (статичный порядок сохраняется).

**Удалённые** встроенные шаблоны (`isDeleted`) исчезают для всех ролей отовсюду: `GET /api/templates` (выбор шаблона
в диалоге сообщения, вкладка «Шаблоны»), `GET /api/templates/official`, генерация плана интенсива
(`UNKNOWN_TEMPLATE`), «Доступна новая версия», «следующий анонс» в `GET /api/workspace`. Видны только Lead_SUP в
`GET /api/templates/official?includeDeleted=1` (экран восстановления). **Снимки в планах интенсивов и тексты уже
созданных сообщений не меняются** ни при изменении, ни при удалении шаблона.

## 1. Права

| Действие | LEAD_SUP | SUP | ADM | MEMBER |
|---|---|---|---|---|
| Читать официальные шаблоны (`GET /api/templates`, `GET /api/templates/official…`) | оба набора | оба набора | только ADM | нет (403) |
| Видеть удалённые (`includeDeleted=1`), `defaults` встроенных | да | нет (параметр игнорируется) | нет | нет |
| Создать / изменить / удалить / восстановить / сбросить шаблон | да | нет | нет | нет |
| Читать словарь каналов `GET /api/template-channels` | да | да | да | да |
| Добавить / удалить канал словаря | да | нет | нет | нет |

Действия в `lib/permissions.ts`: `templates:official` (чтение, как раньше), **`templates:official:manage`**,
**`templates:channels:view`**, **`templates:channels:manage`** (Lead_SUP). Старое `admin:templates:edit` оставлено.
Заблокированный пользователь → 403 (`requireAuth`).

## 2. Ошибки

Новые роуты отвечают `{ error: string, code: TemplatesErrorCode, fieldErrors?: Record<string,string>, ...extra }`
(`error` — готовый текст для тоста, `fieldErrors` — под полями формы; ключи = имена полей тела).

| HTTP | code | Когда |
|---|---|---|
| 400 | `VALIDATION_ERROR` | поля (`fieldErrors`): title ≤ 200, body ≤ 20000 (не пустой), time `HH:mm`, intensiveDay 1..366, scope `SUP|ADM`, audience `all|mk`, dayLabel ≤ 60, timeNote ≤ 200, имя канала |
| 400 | `CHANNEL_NOT_IN_DICTIONARY { channel, fieldErrors.channel }` | канала нет в словаре и не передан `createChannelIfMissing: true` → UI предлагает «Добавить канал #…» и повторяет запрос с флагом (или сначала `POST /api/template-channels`) |
| 400 | `BAD_REQUEST` | некорректный id; сброс/восстановление созданного шаблона |
| 401 | `UNAUTHORIZED` | нет сессии |
| 403 | `FORBIDDEN` | нет права |
| 404 | `TEMPLATE_NOT_FOUND` | нет такого шаблона в этом наборе (или нет доступа к набору) |
| 404 | `CHANNEL_NOT_FOUND` | нет канала |
| 409 | `TEMPLATE_DELETED` | правка удалённого встроенного — сначала восстановить |
| 409 | `TEMPLATE_NOT_DELETED` | восстановление неудалённого |
| 409 | `CHANNEL_IN_USE { usage }` | удаление используемого канала |
| 500 | `INTERNAL_ERROR` | детали не раскрываются |

`GET /api/templates` сохраняет прежний формат ошибок `{ error }`.

## 3. Эндпоинты шаблонов

### `GET /api/templates` (ADM, SUP, Lead_SUP) — прежний формат, без удалённых
`{ templates, admTemplates, role }`: ADM — `templates = admTemplates =` набор ADM; SUP/Lead_SUP — `templates` = SUP,
`admTemplates` = ADM. Элемент — прежние поля `id, intensiveDay, dayLabel, time, channel, audience, title, body,
timeNote?` **плюс аддитивные** `scope, source, isModified, isDeleted (=false), version`. Включает созданные Lead_SUP
шаблоны (id `c_…`) — их можно передавать в `sourceOfficialTemplateId` при `POST /api/messages`, как встроенные.

### `GET /api/templates/official?scope=SUP|ADM&includeDeleted=1`
→ `{ templates: OfficialTemplateDto[], role, canManage }`. Наборы — по роли (§1). `includeDeleted=1` — только
Lead_SUP. У встроенных для Lead_SUP есть `defaults: { title, body, channel, intensiveDay, dayLabel, time, audience,
timeNote }` — значения по умолчанию (подсветка изменённых полей, «Сбросить»).

### `GET /api/templates/official/[templateId]?scope=`
→ `{ template }` (тот же DTO). Удалённый — только Lead_SUP, иначе 404. Для встроенного `scope` можно не передавать.

### `POST /api/templates/official` (Lead_SUP) — создать шаблон
```json
{ "scope": "SUP", "title": "…", "body": "…", "channel": "support", "intensiveDay": 3, "time": "10:00",
  "audience": "all", "dayLabel": null, "timeNote": null, "position": 0, "createChannelIfMissing": false }
```
Обязательны `scope, title, body, channel, intensiveDay, time`; `audience` по умолчанию `all`; `position` по
умолчанию — в конец дня. Канал нормализуется (`#Support` → `support`) и должен быть в словаре (или
`createChannelIfMissing: true`). → `201 { template, createdChannel: TemplateChannelDto | null }`.

### `PATCH /api/templates/official/[templateId]` (Lead_SUP) — изменить
Тело — любые поля из `UpdateOfficialTemplateInput`: `scope?, title?, body?, channel?, intensiveDay?, time?, audience?,
dayLabel?, timeNote?, position?, createChannelIfMissing?`. Поле **отсутствует** — не меняется.
- **Встроенный**: `scope` (в теле или `?scope=`) выбирает набор (можно опустить — определяется по id).
  `null` у поля = вернуть значение по умолчанию; значение, равное умолчанию, тоже хранится как «по умолчанию»
  (поэтому `isModified` точный; если все поля по умолчанию — переопределение удаляется). `dayLabel: ''` → «День N»,
  `timeNote: ''` → без подсказки. `position` — 400. Канал, совпадающий с текущим или исходным
  (даже вне словаря, например `support(Проверки на 5 этаже)`), не проверяется по словарю. Удалённый → `409 TEMPLATE_DELETED`.
  Прежнее тело старого UI `{ scope, body, title|null, channel|null, time|null }` работает как раньше.
- **Созданный** (`c_…`): `null` у обязательных полей (title, body, channel, intensiveDay, time) → 400;
  `audience: null` → `all`; `dayLabel/timeNote: null` → пусто; `scope` отличается → шаблон переносится в другой набор.

→ `{ ok: true, template, createdChannel }`.

### `DELETE /api/templates/official/[templateId]?scope=` (Lead_SUP) — удалить
- встроенный → скрыт для набора (`isDeleted`), изменения сохраняются для восстановления; повтор идемпотентен;
- созданный → строка удаляется безвозвратно.

→ `{ ok: true, id, scope, source, restorable }`.

> **Изменение поведения:** раньше `DELETE` сбрасывал переопределение. Сброс теперь — `POST …/reset`
> (кнопка «Сбросить к умолчанию» в `app/dashboard/admin/templates/page.tsx` уже переключена).

### `POST /api/templates/official/[templateId]/restore?scope=` (Lead_SUP)
Восстановить удалённый встроенный (с прежними изменениями). `scope` — в query или теле.
→ `{ ok: true, template }`; `409 TEMPLATE_NOT_DELETED`; для `c_…` — `400`.

### `POST /api/templates/official/[templateId]/reset?scope=` (Lead_SUP)
Сбросить все изменения встроенного к `lib/templates-data`. Удалённый остаётся удалённым (но без изменений).
→ `{ ok: true, template }`; для `c_…` — `400`.

## 4. Словарь каналов

Таблица `TemplateChannel { id, name, label?, createdById?, createdAt }`. **Все селекторы каналов** (редактор
официальных шаблонов, свои шаблоны, пункты плана) берут список отсюда; новый канал сразу появляется везде.

Имя: `normalizeChannelName` — убрать ведущие `#`, пробелы → `_`, нижний регистр; допустимы буквы (в т.ч.
кириллица), цифры, `.`, `_`, `-`, длина 1..80 (то же правило, что `GET /api/workspace/[id]/channels/check`).
Уникальность — без учёта регистра (имя хранится в нижнем регистре, CHECK в БД).

Начальное наполнение (миграция): `adm, announcements, general, support, services, random` + все корректные имена,
уже использованные в `UserTemplate` и `OfficialTemplateOverride`. Некорректные «имена» вроде
`support(Проверки на 5 этаже)` в словарь не попадают (такие каналы встроенных шаблонов продолжают работать как есть).

| Метод и путь | Кто | Тело | Ответ |
|---|---|---|---|
| `GET /api/template-channels` | все роли | — | `{ channels: TemplateChannelDto[] /*по имени*/, canManage }` |
| `POST /api/template-channels` | Lead_SUP | `{ name, label? }` | `201 { channel, created: true }`; уже есть → `200 { channel, created: false }` (идемпотентно); `400 VALIDATION_ERROR { fieldErrors.name }` |
| `DELETE /api/template-channels/[id]` | Lead_SUP | — | `{ ok: true }`; `409 CHANNEL_IN_USE { usage }`; `404 CHANNEL_NOT_FOUND` |

`TemplateChannelDto = { id, name, label: string | null, createdAt }` — UI показывает `label ?? '#' + name`.
`usage = { officialTemplates, overrides, customTemplates, userTemplates, planItems }` — канал можно удалить, только
если все нули (официальные — эффективные неудалённые шаблоны; overrides — строки переопределений, в т.ч. удалённых).

**«Добавить канал на месте»:** в форме шаблона/пункта плана, если введённого канала нет в списке, —
либо `POST /api/template-channels { name }` и выбрать вернувшийся `channel.name`, либо отправить форму с
`createChannelIfMissing: true` (шаблоны: `POST/PATCH /api/templates/official…`; пункты плана:
`POST/PATCH /api/intensives/[id]/plan/items…` — для пунктов канал по-прежнему может быть любым, флаг лишь
добавляет его в словарь). В ответе шаблона `createdChannel` ≠ null → обновить локальный список каналов.

## 5. Видимость в интенсивах

Пункты плана получают область `sourceScope` из шаблона (встроенного или созданного); свои пункты (CUSTOM /
USER_TEMPLATE) — из выбранной Lead_SUP области (`scope: 'SUP'|'ADM'|null`, null — для всех). Правила видимости
(SUP — своя область + общие, ADM — своя + общие, MEMBER — только общие, Lead_SUP — всё + фильтр `?scope=`) — в
`docs/intensives-api.md` §1.

## 6. Аудит

Каждое изменение пишет `ActivityLog` (`action: ADMIN_ACTION`, `entityType: 'official_template' | 'template_channel'`,
`details` — JSON без текстов шаблонов: `action` = `official_template_created|updated|deleted|restored|reset`,
`template_channel_created|deleted`, `templateId`, `scope`, `fields`, `createdChannel`). Видно в «Аудите» админки.

## 7. Данные (миграция `20261009120000_templates_custom`, аддитивная)

- `CustomOfficialTemplate { id, scope, title, body, channel, intensiveDay, dayLabel?, time, audience='all', timeNote?,
  position=0, createdById?, updatedById? (SetNull), createdAt, updatedAt }` + CHECK (scope, день 1..366, `HH:mm`,
  audience, длины).
- `OfficialTemplateOverride` + `isDeleted` (false), `intensiveDay?`, `dayLabel?`, `audience?`, `timeNote?`;
  `body` стал nullable (null = текст по умолчанию; старые строки не меняются). Уникальность прежняя
  (findFirst + update/create по глобальной строке).
- `TemplateChannel` (UNIQUE name + CHECK `name = lower(name)`), начальное наполнение — идемпотентно.
