import crypto from 'crypto';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { hashPassword, validateNewPassword } from '@/lib/auth';
import { getClientIp, isAuthEndpointRateLimited, logSecurityEvent, SecurityEventType } from '@/lib/security';

const MAX_TOKEN_LENGTH = 256;
const INVALID_LINK_ERROR = 'Ссылка недействительна или истекла. Запросите сброс пароля снова.';

/**
 * POST — установка нового пароля по токену сброса. Body: { token, newPassword }.
 * Токен одноразовый: запись удаляется атомарно ДО смены пароля (повторное/параллельное использование
 * не проходит). В БД токен рекомендуется хранить как sha256(token) — поддерживаются оба варианта.
 * После сброса все сессии пользователя завершаются.
 */
export async function POST(request: Request) {
  const ip = getClientIp(request);

  if (isAuthEndpointRateLimited(ip ?? null)) {
    await logSecurityEvent({
      type: SecurityEventType.AUTH_RATE_LIMIT,
      path: '/api/auth/reset-password',
      method: 'POST',
      ipAddress: ip,
      details: 'Превышен лимит запросов',
      blocked: true,
    });
    return NextResponse.json(
      { error: 'Слишком много запросов. Попробуйте позже.' },
      { status: 429 }
    );
  }

  try {
    const body = await request.json().catch(() => null);
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    const newPassword = body?.newPassword ?? body?.password;

    if (!token || token.length > MAX_TOKEN_LENGTH) {
      return NextResponse.json(
        { error: 'Не указан токен сброса' },
        { status: 400 }
      );
    }

    const passwordError = await validateNewPassword(newPassword);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const resetRecord =
      (await prisma.passwordResetToken.findUnique({ where: { token: tokenHash } })) ??
      (await prisma.passwordResetToken.findUnique({ where: { token } }));

    if (!resetRecord || new Date(resetRecord.expiresAt) <= new Date()) {
      return NextResponse.json({ error: INVALID_LINK_ERROR }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: resetRecord.userId },
      select: { id: true, email: true, username: true },
    });
    if (!user) {
      return NextResponse.json({ error: INVALID_LINK_ERROR }, { status: 400 });
    }
    const identityError = await validateNewPassword(newPassword, [user.email, user.username]);
    if (identityError) {
      return NextResponse.json({ error: identityError }, { status: 400 });
    }

    const hashed = await hashPassword(newPassword as string);
    const consumed = await prisma.$transaction(async (tx) => {
      // Атомарное «погашение» токена: только один запрос получит count = 1
      const del = await tx.passwordResetToken.deleteMany({
        where: { id: resetRecord.id, expiresAt: { gt: new Date() } },
      });
      if (del.count !== 1) return false;
      await tx.user.update({
        where: { id: resetRecord.userId },
        data: { password: hashed, requirePasswordChange: false },
      });
      await tx.session.deleteMany({ where: { userId: resetRecord.userId } });
      return true;
    });

    if (!consumed) {
      return NextResponse.json({ error: INVALID_LINK_ERROR }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: 'Пароль успешно изменён. Войдите с новым паролем.',
    });
  } catch (e) {
    console.error('Reset password error:', e instanceof Error ? e.message : 'unknown');
    return NextResponse.json(
      { error: 'Не удалось сменить пароль' },
      { status: 500 }
    );
  }
}
