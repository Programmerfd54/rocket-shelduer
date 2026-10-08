/**
 * Общие ответы API интенсивов: единый формат ошибок { error, code, fieldErrors? }, безопасные сообщения,
 * проверка флага функции и разбор тела запроса.
 */
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { isUnsafeId } from '@/lib/security';
import type { IntensivesErrorCode } from './types';
import { isIntensivesEnabled } from './feature';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: IntensivesErrorCode,
    message: string,
    public extra?: Record<string, unknown>
  ) {
    super(message);
  }
}

export function apiError(
  status: number,
  code: IntensivesErrorCode,
  error: string,
  extra?: Record<string, unknown>
): NextResponse {
  return NextResponse.json({ error, code, ...(extra ?? {}) }, { status });
}

export const badRequest = (error = 'Некорректный запрос', extra?: Record<string, unknown>) =>
  apiError(400, 'BAD_REQUEST', error, extra);
export const forbidden = (error = 'Недостаточно прав') => apiError(403, 'FORBIDDEN', error);
export const notFound = (error = 'Не найдено') => apiError(404, 'NOT_FOUND', error);

/** Ошибка роута → ответ. Детали внутренних ошибок клиенту не отдаются. */
export function handleRouteError(e: unknown, context: string): NextResponse {
  if (e instanceof ApiError) return apiError(e.status, e.code, e.message, e.extra);
  if (e instanceof Error && e.message === 'Unauthorized') {
    return apiError(401, 'UNAUTHORIZED', 'Требуется вход');
  }
  if (e instanceof Error && (e.message === 'Forbidden' || e.message === 'BLOCKED')) {
    return apiError(403, 'FORBIDDEN', 'Недостаточно прав');
  }
  console.error(`[intensives] ${context}:`, e);
  return apiError(500, 'INTERNAL_ERROR', 'Не удалось выполнить операцию. Попробуйте ещё раз.');
}

/** 404, если функция «Интенсивы» выключена (SystemSetting feature:intensives = false). */
export async function ensureIntensivesEnabled(): Promise<void> {
  if (!(await isIntensivesEnabled())) {
    throw new ApiError(404, 'FEATURE_DISABLED', 'Не найдено');
  }
}

/** Безопасный разбор JSON-тела (пустое/битое тело → {}). */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Валидация zod → данные или ApiError 400 с fieldErrors. */
export function parseOrThrow<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const res = schema.safeParse(data);
  if (res.success) return res.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of res.error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join('.') : '_';
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  const first = Object.values(fieldErrors)[0] ?? 'Проверьте поля формы';
  throw new ApiError(400, 'VALIDATION_ERROR', first, { fieldErrors });
}

/** Проверка id из пути / тела. */
export function assertSafeId(value: unknown, field = 'id'): string {
  if (typeof value !== 'string' || isUnsafeId(value)) {
    throw new ApiError(400, 'BAD_REQUEST', 'Некорректный идентификатор', { fieldErrors: { [field]: 'Некорректный идентификатор' } });
  }
  return value.trim();
}

/** Ошибка Prisma с кодом (P2002 и т.п.). */
export function prismaErrorCode(e: unknown): string | null {
  if (e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string') {
    return (e as { code: string }).code;
  }
  return null;
}

/** Нарушение ограничения БД по имени (для ограничений, которых нет в схеме Prisma). */
export function isDbConstraintError(e: unknown, constraintName: string): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  const meta = e && typeof e === 'object' && 'meta' in e ? JSON.stringify((e as { meta: unknown }).meta) : '';
  return msg.includes(constraintName) || meta.includes(constraintName);
}
