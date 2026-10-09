/**
 * Ответы API шаблонов: { error, code, fieldErrors?, ...extra } — как в API интенсивов.
 * Детали внутренних ошибок клиенту не отдаются.
 */
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { isForbiddenError } from '@/lib/auth';
import type { TemplatesErrorCode } from './types';

export class TemplatesApiError extends Error {
  constructor(
    public status: number,
    public code: TemplatesErrorCode,
    message: string,
    public extra?: Record<string, unknown>
  ) {
    super(message);
  }
}

export function templatesError(status: number, code: TemplatesErrorCode, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, code, ...(extra ?? {}) }, { status });
}

export function handleTemplatesRouteError(e: unknown, context: string): NextResponse {
  if (e instanceof TemplatesApiError) return templatesError(e.status, e.code, e.message, e.extra);
  if (e instanceof Error && e.message === 'Unauthorized') return templatesError(401, 'UNAUTHORIZED', 'Требуется вход');
  if (isForbiddenError(e) || (e instanceof Error && e.message === 'BLOCKED')) {
    return templatesError(403, 'FORBIDDEN', 'Недостаточно прав');
  }
  console.error(`[templates] ${context}:`, e);
  return templatesError(500, 'INTERNAL_ERROR', 'Не удалось выполнить операцию. Попробуйте ещё раз.');
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function parseOrThrow<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const res = schema.safeParse(data);
  if (res.success) return res.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of res.error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join('.') : '_';
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  const first = Object.values(fieldErrors)[0] ?? 'Проверьте поля формы';
  throw new TemplatesApiError(400, 'VALIDATION_ERROR', first, { fieldErrors });
}

export function prismaCode(e: unknown): string | null {
  if (e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string') {
    return (e as { code: string }).code;
  }
  return null;
}
