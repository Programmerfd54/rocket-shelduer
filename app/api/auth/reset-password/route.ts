import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';
import { getClientIp, isAuthEndpointRateLimited, recordAuthEndpointHit, logSecurityEvent, SecurityEventType } from '@/lib/security';

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
  recordAuthEndpointHit(ip ?? null);

  try {
    const body = await request.json();
    const token = (body.token ?? '').toString().trim();
    const newPassword = (body.newPassword ?? body.password ?? '').toString();

    if (!token) {
      return NextResponse.json(
        { error: 'Не указан токен сброса' },
        { status: 400 }
      );
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: 'Пароль должен быть не менее 8 символов' },
        { status: 400 }
      );
    }
    const { checkPasswordStrength } = await import('@/lib/utils');
    const strength = checkPasswordStrength(newPassword);
    if (!strength.valid || strength.strength === 'weak') {
      return NextResponse.json(
        { error: strength.message || 'Пароль слишком простой: используйте буквы разного регистра, цифры и спецсимволы' },
        { status: 400 }
      );
    }

    const resetRecord = await prisma.passwordResetToken.findUnique({
      where: { token },
    });

    if (!resetRecord || new Date(resetRecord.expiresAt) <= new Date()) {
      return NextResponse.json(
        { error: 'Ссылка недействительна или истекла. Запросите сброс пароля снова.' },
        { status: 400 }
      );
    }

    const hashed = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: resetRecord.userId },
      data: { password: hashed },
    });
    await prisma.passwordResetToken.delete({ where: { id: resetRecord.id } });
    await prisma.session.deleteMany({ where: { userId: resetRecord.userId } });

    return NextResponse.json({
      success: true,
      message: 'Пароль успешно изменён. Войдите с новым паролем.',
    });
  } catch (e) {
    console.error('Reset password error:', e);
    return NextResponse.json(
      { error: 'Не удалось сменить пароль' },
      { status: 500 }
    );
  }
}
