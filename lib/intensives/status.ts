/**
 * Вычисляемые состояния пунктов плана по связанным сообщениям (чистые функции).
 *
 * Ключ учёта — id пункта плана (не templateId). Состояние:
 *   SENT             — есть хотя бы одна успешная отправка (основная или повтор); несколько успешных = выполнен один раз
 *   SKIPPED          — пропущен решением Lead_SUP (и нет успешных отправок); не считается отправленным
 *   SCHEDULED        — есть ожидающая (PENDING) основная отправка, время ещё не наступило
 *   AWAITING_OVERDUE — PENDING, но назначенное время прошло (уточнение PENDING, статус в БД не меняется)
 *   FAILED           — последняя основная отправка завершилась ошибкой
 *   CANCELLED        — последняя основная отправка отменена
 *   NOT_SCHEDULED    — отправок не было
 * Детали: sentCount, hasFailedRepeat (успех не скрывает ошибку повтора), pendingRepeatAt, hasFailedAttempt.
 */
import type { MessageStatus, PlanItemState, PlanItemStateDetails, PlanProgress } from './types';

/** Агрегат отправок пункта по (status, isPlanRepeat) — результат groupBy или свёртки списка. */
export interface SendAggregateRow {
  status: MessageStatus;
  isPlanRepeat: boolean;
  count: number;
  maxCreatedAt: Date | null;
  minScheduledFor: Date | null;
  maxSentAt: Date | null;
}

export interface MessageLike {
  status: MessageStatus | string;
  isPlanRepeat: boolean;
  createdAt: Date;
  scheduledFor: Date;
  sentAt: Date | null;
}

const maxDate = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a > b ? a : b);
const minDate = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a < b ? a : b);

/** Свёртка списка сообщений одного пункта в агрегат (для детального плана). */
export function aggregateMessages(messages: MessageLike[]): SendAggregateRow[] {
  const map = new Map<string, SendAggregateRow>();
  for (const m of messages) {
    const status = m.status as MessageStatus;
    const key = `${status}:${m.isPlanRepeat}`;
    const row = map.get(key) ?? {
      status,
      isPlanRepeat: m.isPlanRepeat,
      count: 0,
      maxCreatedAt: null,
      minScheduledFor: null,
      maxSentAt: null,
    };
    row.count += 1;
    row.maxCreatedAt = maxDate(row.maxCreatedAt, m.createdAt);
    row.minScheduledFor = minDate(row.minScheduledFor, m.scheduledFor);
    if (status === 'SENT') row.maxSentAt = maxDate(row.maxSentAt, m.sentAt);
    map.set(key, row);
  }
  return Array.from(map.values());
}

export function deriveItemState(input: {
  skipped: boolean;
  rows: SendAggregateRow[];
  now?: Date;
}): { state: PlanItemState; details: PlanItemStateDetails } {
  const now = input.now ?? new Date();
  const find = (status: MessageStatus, repeat: boolean) =>
    input.rows.find((r) => r.status === status && r.isPlanRepeat === repeat && r.count > 0) ?? null;

  const sentRows = input.rows.filter((r) => r.status === 'SENT' && r.count > 0);
  const sentCount = sentRows.reduce((s, r) => s + r.count, 0);
  const lastSentAt = sentRows.reduce<Date | null>((acc, r) => maxDate(acc, r.maxSentAt), null);

  const primaryPending = find('PENDING', false);
  const repeatPending = find('PENDING', true);
  const repeatFailed = find('FAILED', true);
  const repeatSent = find('SENT', true);
  const primaryFailed = find('FAILED', false);
  const primaryCancelled = find('CANCELLED', false);

  const hasFailedRepeat =
    !!repeatFailed &&
    (!repeatSent ||
      (repeatFailed.maxCreatedAt != null &&
        repeatSent.maxCreatedAt != null &&
        repeatFailed.maxCreatedAt > repeatSent.maxCreatedAt));

  const details: PlanItemStateDetails = {
    sentCount,
    hasFailedRepeat,
    pendingRepeatAt: repeatPending?.minScheduledFor ? repeatPending.minScheduledFor.toISOString() : null,
    hasFailedAttempt: input.rows.some((r) => r.status === 'FAILED' && r.count > 0),
    lastSentAt: lastSentAt ? lastSentAt.toISOString() : null,
    scheduledFor: primaryPending?.minScheduledFor ? primaryPending.minScheduledFor.toISOString() : null,
  };

  let state: PlanItemState;
  if (sentCount > 0) state = 'SENT';
  else if (input.skipped) state = 'SKIPPED';
  else if (primaryPending) {
    state = primaryPending.minScheduledFor && primaryPending.minScheduledFor.getTime() <= now.getTime()
      ? 'AWAITING_OVERDUE'
      : 'SCHEDULED';
  } else if (primaryFailed || primaryCancelled) {
    const f = primaryFailed?.maxCreatedAt?.getTime() ?? -1;
    const c = primaryCancelled?.maxCreatedAt?.getTime() ?? -1;
    state = f >= c ? 'FAILED' : 'CANCELLED';
  } else state = 'NOT_SCHEDULED';

  return { state, details };
}

export function emptyProgress(): PlanProgress {
  return {
    total: 0,
    completed: 0,
    scheduled: 0,
    awaitingOverdue: 0,
    notScheduled: 0,
    cancelled: 0,
    failed: 0,
    skipped: 0,
    needsAttention: 0,
    remaining: 0,
  };
}

/** Учесть пункт в прогрессе (мутирует progress). */
export function addToProgress(progress: PlanProgress, state: PlanItemState, details: PlanItemStateDetails): void {
  progress.total += 1;
  switch (state) {
    case 'SENT':
      progress.completed += 1;
      if (details.hasFailedRepeat) progress.needsAttention += 1;
      break;
    case 'SKIPPED':
      progress.skipped += 1;
      break;
    case 'SCHEDULED':
      progress.scheduled += 1;
      break;
    case 'AWAITING_OVERDUE':
      progress.scheduled += 1;
      progress.awaitingOverdue += 1;
      progress.needsAttention += 1;
      break;
    case 'FAILED':
      progress.failed += 1;
      progress.needsAttention += 1;
      break;
    case 'CANCELLED':
      progress.notScheduled += 1;
      progress.cancelled += 1;
      break;
    default:
      progress.notScheduled += 1;
  }
  progress.remaining = progress.total - progress.completed - progress.skipped;
}

/** Активная (занимающая пункт) отправка: не-повтор в статусе PENDING/SENT. */
export function isActiveSend(m: { status: string; isPlanRepeat: boolean }): boolean {
  return !m.isPlanRepeat && (m.status === 'PENDING' || m.status === 'SENT');
}
