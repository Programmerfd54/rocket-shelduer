/**
 * Обёртка роутов API интенсивов: авторизация (requireAuth отклоняет заблокированных), флаг функции (404),
 * контекст доступа, единый формат ошибок.
 */
import type { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import type { CurrentUser } from '@/lib/auth';
import { requireAction, type Action } from '@/lib/permissions';
import { getIntensiveViewer, type IntensiveViewer } from './access';
import { ensureIntensivesEnabled, handleRouteError } from './http';

export interface RouteCtx {
  user: CurrentUser;
  viewer: IntensiveViewer;
}

export async function withIntensives(
  context: string,
  fn: (ctx: RouteCtx) => Promise<NextResponse>,
  /** Дополнительное действие, которое должен иметь право выполнить вызывающий (например 'intensives:manage') */
  opts: { action?: Action } = {}
): Promise<NextResponse> {
  try {
    const user = await requireAuth();
    await ensureIntensivesEnabled();
    if (opts.action) requireAction(user, opts.action);
    const viewer = await getIntensiveViewer(user);
    return await fn({ user, viewer });
  } catch (e) {
    return handleRouteError(e, context);
  }
}

export type RouteParams<T extends Record<string, string>> = { params: Promise<T> };
