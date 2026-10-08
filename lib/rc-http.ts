import { NextResponse } from 'next/server';

/**
 * Нет сессии Rocket.Chat при живой сессии приложения.
 * Не использовать HTTP 401 — глобальный fetch перехватывает 401 и отправляет на /login.
 */
export function rcNotConnectedResponse(extra?: Record<string, unknown>) {
  return NextResponse.json(
    { code: 'RC_NOT_CONNECTED' as const, error: 'Workspace not authenticated', ...extra },
    { status: 403 }
  );
}

/** Токен RC отклонён или истёк (ответ RC Unauthorized). */
export function rcUnauthorizedResponse(message: string, details?: string) {
  return NextResponse.json(
    { error: message, code: 'RC_UNAUTHORIZED', ...(details ? { details } : {}) },
    { status: 403 }
  );
}
