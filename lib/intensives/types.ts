/**
 * Общие типы API интенсивов (docs/intensives-api.md).
 * Файл используется и сервером, и клиентом: никаких импортов серверных модулей (prisma, next/server и т.д.).
 * Все даты-моменты — ISO-строки UTC; календарные даты — 'YYYY-MM-DD'; время — 'HH:mm' в поясе интенсива.
 */

/* ───────────── Перечисления ───────────── */

export const INTENSIVE_STATUSES = ['DRAFT', 'PUBLISHED', 'CANCELLED', 'ARCHIVED'] as const;
export type IntensiveStatus = (typeof INTENSIVE_STATUSES)[number];

/** Вычисляемая фаза опубликованного интенсива по датам в его часовом поясе. */
export const INTENSIVE_PHASES = ['UPCOMING', 'RUNNING', 'FINISHED'] as const;
export type IntensivePhase = (typeof INTENSIVE_PHASES)[number];

export const PLAN_ITEM_SOURCE_TYPES = ['OFFICIAL', 'USER_TEMPLATE', 'CUSTOM'] as const;
export type PlanItemSourceType = (typeof PLAN_ITEM_SOURCE_TYPES)[number];

/**
 * Для кого пункт плана: 'ADM' | 'SUP' | 'ALL'. Видимость определяет область пункта (planItemScope в access.ts):
 * sourceScope ('ADM'|'SUP'), а без него — audience ADM/SUP; null — общий пункт (audience ALL).
 */
export const PLAN_ITEM_AUDIENCES = ['ADM', 'SUP', 'ALL'] as const;
export type PlanItemAudience = (typeof PLAN_ITEM_AUDIENCES)[number];

/** Область пункта плана: шаблоны SUP, шаблоны ADM или null — общий пункт «для всех». */
export type PlanItemScope = 'SUP' | 'ADM';

/**
 * Какие пункты плана показывает ответ (query `scope` для Lead_SUP; остальным — по роли, параметр игнорируется):
 *  - ALL — все пункты (Lead_SUP по умолчанию);
 *  - SUP — пункты области SUP + общие (так видит план SUP);
 *  - ADM — пункты области ADM + общие (так видит план ADM);
 *  - COMMON — только общие пункты (так видит план MEMBER).
 */
export const PLAN_VIEW_SCOPES = ['ALL', 'SUP', 'ADM', 'COMMON'] as const;
export type PlanViewScope = (typeof PLAN_VIEW_SCOPES)[number];

/** Вычисляемое состояние пункта плана (по связанным сообщениям). */
export const PLAN_ITEM_STATES = [
  'NOT_SCHEDULED',
  'SCHEDULED',
  'AWAITING_OVERDUE',
  'SENT',
  'FAILED',
  'CANCELLED',
  'SKIPPED',
] as const;
export type PlanItemState = (typeof PLAN_ITEM_STATES)[number];

export const MESSAGE_STATUSES = ['PENDING', 'SENT', 'FAILED', 'CANCELLED'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const INTENSIVE_EVENT_TYPES = [
  'INTENSIVE_CREATED',
  'INTENSIVE_UPDATED',
  'INTENSIVE_PUBLISHED',
  'INTENSIVE_CANCELLED',
  'INTENSIVE_ARCHIVED',
  'PLAN_GENERATED',
  'PLAN_ITEM_ADDED',
  'PLAN_ITEM_UPDATED',
  'PLAN_ITEM_SOURCE_UPDATED',
  'PLAN_ITEM_SKIPPED',
  'PLAN_ITEM_UNSKIPPED',
  'PLAN_ITEM_DELETED',
  'MESSAGE_SCHEDULED',
  'MESSAGE_REPEAT_SCHEDULED',
  'MESSAGE_SENT',
  'MESSAGE_FAILED',
  'MESSAGE_CANCELLED',
  'MESSAGE_RETRIED',
  'MESSAGE_DELETED',
  'MESSAGE_LINKED',
  'MESSAGE_DETACHED',
] as const;
export type IntensiveEventType = (typeof INTENSIVE_EVENT_TYPES)[number];

/** Почему пункт «требует настройки». */
export type PlanItemSetupReason = 'DAY_OUTSIDE_PERIOD' | 'NO_DAY' | 'NO_TIME';

/** Решение при отмене интенсива с ожидающими отправками. */
export type CancelResolution = 'cancel_messages' | 'detach_messages';

/** Решение для ожидающих сообщений, которые окажутся вне новых дат интенсива. */
export type OutOfRangeResolution = 'keep_linked' | 'detach' | 'cancel';

/** Коды ошибок API интенсивов (поле `code` ответа об ошибке). */
export type IntensivesErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'FEATURE_DISABLED'
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR'
  | 'VERSION_CONFLICT'
  | 'INVALID_STATUS_TRANSITION'
  | 'INTENSIVE_OVERLAP'
  | 'INTENSIVE_NOT_PUBLISHED'
  | 'INTENSIVE_NOT_FINISHED'
  | 'INTENSIVE_READ_ONLY'
  | 'IMPACT_CONFIRMATION_REQUIRED'
  | 'OUT_OF_RANGE_DECISION_REQUIRED'
  | 'PENDING_MESSAGES_EXIST'
  | 'ORG_SPACE_NAME_TAKEN'
  | 'ORG_SPACE_HAS_INTENSIVES'
  | 'WORKSPACE_LINKED_ELSEWHERE'
  | 'WORKSPACE_NOT_LINKED'
  | 'WORKSPACE_HAS_NO_DATES'
  | 'WORKSPACE_NOT_IN_INTENSIVE_SPACE'
  | 'PLAN_ITEM_NOT_FOUND'
  | 'PLAN_ITEM_HAS_MESSAGES'
  | 'PLAN_ITEM_SKIPPED'
  | 'PLAN_ITEM_ACTIVE_SEND'
  | 'PLAN_ITEM_ALREADY_SCHEDULED'
  | 'PLAN_ITEM_NOT_VISIBLE'
  | 'PLAN_ITEM_DUPLICATE_SOURCE'
  | 'REPEAT_REQUIRES_SENT'
  | 'OUT_OF_INTENSIVE_PERIOD'
  | 'IDEMPOTENCY_KEY_CONFLICT'
  | 'NO_UPDATE_AVAILABLE'
  | 'UNKNOWN_TEMPLATE';

export interface ApiErrorBody {
  error: string;
  code: IntensivesErrorCode | string;
  /** Ошибки полей формы: имя поля → сообщение */
  fieldErrors?: Record<string, string>;
  [extra: string]: unknown;
}

/* ───────────── Общие фрагменты ───────────── */

export interface UserRef {
  id: string;
  /** name ?? username; null — пользователь удалён или скрыт */
  name: string | null;
}

export interface OrgSpaceRef {
  id: string;
  name: string;
}

/** Подключение, привязанное к OrgSpace. Никаких токенов/паролей. */
export interface OrgSpaceConnection {
  id: string;
  workspaceName: string;
  workspaceUrl: string;
  /** Логин RC владельца подключения */
  username: string;
  owner: UserRef;
  isArchived: boolean;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
}

export interface OrgSpaceDto {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  /** Lead_SUP — все привязанные подключения; остальные — только доступные им */
  connections: OrgSpaceConnection[];
  intensiveCounts: Partial<Record<IntensiveStatus, number>>;
}

export interface OrgSpaceSuggestionGroup {
  /** Пример URL группы */
  sampleUrl: string;
  /** Предложенное название (имя первого подключения) */
  suggestedName: string;
  connections: (OrgSpaceConnection & { orgSpaceId: string | null })[];
  /** OrgSpace, к которым уже привязаны подключения группы */
  linkedOrgSpaceIds: string[];
}

/* ───────────── Прогресс и состояния ───────────── */

export interface PlanProgress {
  /** Видимых вызывающему пунктов */
  total: number;
  /** Выполнено (есть хотя бы одна успешная отправка; несколько успешных = один раз) */
  completed: number;
  /** Запланировано (SCHEDULED + AWAITING_OVERDUE) */
  scheduled: number;
  /** Из запланированных — время прошло, а отправки ещё нет */
  awaitingOverdue: number;
  /** Не запланировано (NOT_SCHEDULED + CANCELLED) */
  notScheduled: number;
  /** Из незапланированных — последняя отправка отменена */
  cancelled: number;
  /** Последняя отправка завершилась ошибкой */
  failed: number;
  /** Пропущено решением Lead_SUP (не считается отправленным) */
  skipped: number;
  /** Требуют внимания: failed + awaitingOverdue + отправленные с ошибкой повтора */
  needsAttention: number;
  /** Осталось: total − completed − skipped */
  remaining: number;
}

export interface PlanItemStateDetails {
  /** Число успешных отправок (основная + повторы) */
  sentCount: number;
  /** Последний повтор завершился ошибкой (успех основной отправки не скрывает её) */
  hasFailedRepeat: boolean;
  /** Ближайший запланированный повтор (ISO) или null */
  pendingRepeatAt: string | null;
  /** Были неудачные попытки (FAILED) в истории пункта */
  hasFailedAttempt: boolean;
  /** Время последней успешной отправки (ISO) */
  lastSentAt: string | null;
  /** Ближайшая ожидающая основная отправка (ISO) */
  scheduledFor: string | null;
}

export interface RecommendedSchedule {
  /** Дата дня N в поясе интенсива или null (день не задан / вне периода) */
  date: string | null;
  /** 'HH:mm' или null */
  time: string | null;
  /** Момент UTC (ISO), если дата и время заданы и однозначны */
  utc: string | null;
  /** Проблема перехода на летнее/зимнее время: требуется явное решение */
  dstIssue: 'NONEXISTENT' | 'AMBIGUOUS' | null;
  /** Рекомендованный момент уже прошёл (автоматически на сегодня не переносится) */
  isPast: boolean;
}

/** Отправка (сообщение), связанная с пунктом. Текст и имена — только если вызывающий видит сообщение. */
export interface PlanItemSend {
  messageId: string;
  status: MessageStatus;
  isPlanRepeat: boolean;
  scheduledFor: string;
  sentAt: string | null;
  createdAt: string;
  workspaceId: string;
  /** Вызывающий может открыть сообщение (GET /api/messages/[id]) */
  canView: boolean;
  /** Кто запланировал (scheduledBy ?? автор) — null, если скрыто */
  plannedBy: UserRef | null;
  /** Отправитель (автор) — null, если скрыто */
  author: UserRef | null;
  channelName: string | null;
  error: string | null;
  planEditedFromSnapshot: boolean;
}

/* ───────────── Интенсив ───────────── */

export interface IntensiveDayInfo {
  /** Сегодня в поясе интенсива */
  today: string;
  /** Номер текущего дня (1..totalDays) или null вне периода */
  dayNumber: number | null;
  totalDays: number;
}

export interface IntensiveOverlapRef {
  id: string;
  name: string;
  status: IntensiveStatus;
  startDate: string;
  endDate: string;
}

export interface IntensiveSummary {
  id: string;
  name: string;
  description: string | null;
  orgSpace: OrgSpaceRef;
  startDate: string;
  endDate: string;
  timezone: string;
  status: IntensiveStatus;
  /** Только для PUBLISHED; для остальных null */
  phase: IntensivePhase | null;
  day: IntensiveDayInfo;
  publishedAt: string | null;
  cancelledAt: string | null;
  archivedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Прогресс по видимым вызывающему пунктам (считает сервер по всем связанным сообщениям) */
  progress: PlanProgress | null;
  /** Вызывающий видит не все пункты → UI: «Доступные вам анонсы» */
  partial: boolean;
  /** Набор пунктов, по которому посчитан прогресс (см. PlanViewScope) */
  viewScope?: PlanViewScope;
  /** Lead_SUP: пересечения с другими интенсивами того же OrgSpace (черновики — предупреждение) */
  overlaps?: IntensiveOverlapRef[];
}

export interface IntensiveDetail extends IntensiveSummary {
  createdBy: UserRef | null;
  updatedBy: UserRef | null;
  cancelReason: string | null;
  /** Подключения OrgSpace, доступные вызывающему (Lead_SUP — все), без секретов */
  workspaces: { id: string; workspaceName: string; workspaceUrl: string; isArchived: boolean }[];
  planItemCount: number;
  linkedMessageCount: number;
}

/* ───────────── План ───────────── */

export interface PlanItemDto {
  id: string;
  intensiveId: string;
  position: number;
  sourceType: PlanItemSourceType;
  sourceTemplateId: string | null;
  sourceScope: 'ADM' | 'SUP' | null;
  /** Эффективная область пункта (видимость): sourceScope, иначе audience ADM/SUP; null — общий пункт */
  scope: PlanItemScope | null;
  sourceVersion: string | null;
  title: string;
  body: string;
  channel: string;
  dayNumber: number | null;
  time: string | null;
  audience: PlanItemAudience;
  categories: string[];
  skipped: boolean;
  skipReason: string | null;
  skippedBy: UserRef | null;
  skippedAt: string | null;
  state: PlanItemState;
  details: PlanItemStateDetails;
  sends: PlanItemSend[];
  recommended: RecommendedSchedule;
  needsSetup: boolean;
  setupReasons: PlanItemSetupReason[];
  /** Были ли когда-либо связанные отправки (тогда снимок не редактируется и пункт не удаляется) */
  hasEverLinkedMessages: boolean;
  /** Lead_SUP: доступна новая версия источника (применима только без отправок) */
  updateAvailable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlanDayGroup {
  dayNumber: number;
  date: string;
  /** ISO день недели: 1 = понедельник … 7 = воскресенье */
  isoWeekday: number;
  itemCount: number;
  completed: number;
}

export interface PlanResponse {
  intensive: IntensiveSummary;
  items: PlanItemDto[];
  days: PlanDayGroup[];
  /** Пункты без дня (или вне периода) — «требуют настройки» */
  unscheduledDayItemIds: string[];
  progress: PlanProgress;
  /** Вызывающий по своей роли видит не все пункты → «Доступные вам анонсы» (для Lead_SUP всегда false) */
  partial: boolean;
  /** Набор пунктов в ответе (Lead_SUP выбирает query `scope`, остальным — по роли) */
  viewScope: PlanViewScope;
  /** Lead_SUP выбрал не ALL — в ответе только пункты выбранной области (+ общие) */
  scopeFiltered: boolean;
}

export interface PlanUpdateDiffField {
  field: 'title' | 'body' | 'channel' | 'dayNumber' | 'time' | 'audience' | 'categories';
  from: unknown;
  to: unknown;
}

export interface PlanUpdateEntry {
  planItemId: string;
  sourceTemplateId: string;
  sourceScope: 'ADM' | 'SUP' | null;
  currentVersion: string;
  snapshotVersion: string | null;
  /** false — у пункта есть отправки, обновление применить нельзя */
  applicable: boolean;
  diff: PlanUpdateDiffField[];
}

/** Официальный шаблон, доступный для формирования плана (с учётом глобальных переопределений). */
export interface OfficialTemplateOption {
  id: string;
  scope: 'ADM' | 'SUP';
  title: string;
  channel: string;
  intensiveDay: number;
  time: string;
  audience: 'all' | 'mk';
  version: string;
  /** builtin — из lib/templates-data (возможно изменён), custom — создан Lead_SUP (id 'c_…') */
  source: 'builtin' | 'custom';
  /** Встроенный шаблон изменён Lead_SUP */
  isModified: boolean;
  dayLabel: string;
  timeNote: string | null;
  /** Уже есть в плане этого интенсива */
  inPlan?: boolean;
}

/* ───────────── Изменение дат ───────────── */

export interface DateChangeImpact {
  /** Пункты без отправок, у которых изменится рекомендуемая дата */
  affectedItems: { planItemId: string; title: string; dayNumber: number | null; fromDate: string | null; toDate: string | null }[];
  /** Пункты с отправками: их сообщения не меняются */
  itemsWithSends: { planItemId: string; title: string; sendCount: number }[];
  /** Связанные сообщения (не отменённые), чей момент окажется вне нового периода */
  messagesOutsideNewRange: { messageId: string; planItemId: string | null; status: MessageStatus; scheduledFor: string; localDate: string }[];
  linkedMessageCount: number;
}

/* ───────────── История ───────────── */

export interface IntensiveEventDto {
  id: string;
  type: IntensiveEventType;
  planItemId: string | null;
  messageId: string | null;
  actor: UserRef | null;
  /** Без текста сообщений; для недоступных вызывающему сообщений — только статус и время */
  details: Record<string, unknown> | null;
  /** Детали урезаны (сообщение недоступно вызывающему) */
  redacted: boolean;
  createdAt: string;
}

export interface HistoryResponse {
  events: IntensiveEventDto[];
  nextCursor: string | null;
}

/* ───────────── Перенос старых сообщений ───────────── */

export interface LinkCandidate {
  messageId: string;
  planItemId: string;
  planItemTitle: string;
  status: MessageStatus;
  scheduledFor: string;
  sentAt: string | null;
  localDate: string;
  workspaceId: string;
  workspaceName: string;
  channelName: string;
  author: UserRef | null;
  preview: string;
  /** У пункта уже есть активная отправка, а это сообщение тоже активно — привязка будет отклонена */
  wouldConflict: boolean;
}

export type LinkResultStatus =
  | 'linked'
  | 'already_linked'
  | 'linked_elsewhere'
  | 'conflict_active_send'
  | 'outside_period'
  | 'not_in_org_space'
  | 'item_not_found'
  | 'item_skipped'
  | 'message_not_found';

export interface LinkResult {
  messageId: string;
  planItemId: string;
  result: LinkResultStatus;
}

/* ───────────── Расширение POST /api/messages ───────────── */

/** Дополнительные (необязательные) поля тела POST /api/messages. */
export interface ScheduleFromPlanFields {
  intensiveId?: string;
  planItemId?: string;
  /** Ключ идемпотентности (UUID на одну попытку сохранения формы) */
  clientRequestId?: string;
  /** Явный повтор после успешной отправки */
  isPlanRepeat?: boolean;
}
