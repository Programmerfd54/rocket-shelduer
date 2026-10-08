import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  requireAuth,
  hashPassword,
  verifyPassword,
  validateNewPassword,
  deleteAllSessionsExcept,
} from '@/lib/auth';
import {
  isCurrentPasswordCheckLocked,
  recordCurrentPasswordFailure,
  logSecurityEvent,
  getClientIp,
  SecurityEventType,
} from '@/lib/security';

/**
 * PATCH — смена пароля. Требует текущий пароль; после смены завершает все ДРУГИЕ сессии
 * (текущая остаётся). Неверный текущий пароль → 401 (клиент показывает ошибку у поля;
 * GlobalFetchHandler не делает редирект на /login для этого эндпоинта).
 */
export async function PATCH(request: Request) {
  try {
    const user = await requireAuth();
    const body = await request.json().catch(() => null);
    const currentPassword = body?.currentPassword;
    const newPassword = body?.newPassword;

    if (typeof currentPassword !== 'string' || !currentPassword || typeof newPassword !== 'string' || !newPassword) {
      return NextResponse.json(
        { error: 'Все поля обязательны' },
        { status: 400 }
      );
    }

    if (await isCurrentPasswordCheckLocked(user.id)) {
      return NextResponse.json(
        { error: 'Слишком много неудачных попыток. Попробуйте через 15 минут.' },
        { status: 429 }
      );
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, password: true, email: true, username: true },
    });

    if (!dbUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const passwordError = await validateNewPassword(newPassword, [dbUser.email, dbUser.username]);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    const isValidPassword = await verifyPassword(currentPassword, dbUser.password);

    if (!isValidPassword) {
      recordCurrentPasswordFailure(user.id);
      await logSecurityEvent({
        type: SecurityEventType.LOGIN_FAILED,
        path: '/api/user/password',
        method: 'PATCH',
        ipAddress: getClientIp(request),
        userAgent: request.headers.get('user-agent') ?? undefined,
        details: 'Неверный текущий пароль при смене пароля',
        blocked: true,
        userId: user.id,
      });
      return NextResponse.json(
        { error: 'Неверный текущий пароль' },
        { status: 401 }
      );
    }

    if (currentPassword === newPassword) {
      return NextResponse.json(
        { error: 'Новый пароль должен отличаться от текущего' },
        { status: 400 }
      );
    }

    const hashedPassword = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });
    // Все остальные сессии (возможно, украденные) завершаются; текущая остаётся активной
    await deleteAllSessionsExcept(user.id, user.sessionId);

    return NextResponse.json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Необходима авторизация' }, { status: 401 });
    }
    if (e instanceof Error && e.message === 'Forbidden') {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
    }
    return NextResponse.json(
      { error: 'Failed to change password' },
      { status: 500 }
    );
  }
}
