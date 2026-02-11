import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getClientIp, isAuthEndpointRateLimited, recordAuthEndpointHit, logSecurityEvent, SecurityEventType } from '@/lib/security';
import crypto from 'crypto';

const RESET_EXPIRY_HOURS = 1;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const userAgent = request.headers.get('user-agent') ?? undefined;

  if (isAuthEndpointRateLimited(ip ?? null)) {
    await logSecurityEvent({
      type: SecurityEventType.AUTH_RATE_LIMIT,
      path: '/api/auth/forgot-password',
      method: 'POST',
      ipAddress: ip,
      userAgent,
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
    const email = (body.email ?? '').toString().trim().toLowerCase();

    if (!email) {
      return NextResponse.json(
        { error: 'Укажите email' },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_URL ||
      (request.headers.get('origin') ?? request.url).replace(/\/[^/]*$/, '');

    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + RESET_EXPIRY_HOURS * 60 * 60 * 1000);

      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await prisma.passwordResetToken.create({
        data: { token, userId: user.id, expiresAt },
      });

      // TODO: отправить письмо с ссылкой на сброс (nodemailer, Resend и т.д.)
      // Пока в dev возвращаем ссылку в ответе для удобства
      const resetLink = `${baseUrl.replace(/\/$/, '')}/reset-password/${token}`;
      const response: { success: true; message: string; resetLink?: string } = {
        success: true,
        message: 'Если аккаунт с таким email существует, на него отправлена ссылка для сброса пароля.',
      };
      if (process.env.NODE_ENV === 'development') {
        response.resetLink = resetLink;
      }

      return NextResponse.json(response);
    }

    return NextResponse.json({
      success: true,
      message: 'Если аккаунт с таким email существует, на него отправлена ссылка для сброса пароля.',
    });
  } catch (e) {
    console.error('Forgot password error:', e);
    return NextResponse.json(
      { error: 'Не удалось обработать запрос' },
      { status: 500 }
    );
  }
}
