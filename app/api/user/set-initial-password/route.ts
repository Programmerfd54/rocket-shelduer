import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  requireAuthAllowPasswordChange,
  hashPassword,
  verifyPassword,
  validateNewPassword,
  deleteAllSessionsExcept,
  reissueSessionToken,
} from '@/lib/auth';

/**
 * PATCH — установка нового пароля при первом входе (после сброса пароля на логин).
 * Доступно только если у пользователя requirePasswordChange === true.
 * Новый пароль не может совпадать с временным/логином. После установки другие сессии
 * завершаются, а текущий токен перевыпускается без флага «нужна смена пароля».
 */
export async function PATCH(request: Request) {
  try {
    const user = await requireAuthAllowPasswordChange();
    const body = await request.json().catch(() => null);
    const newPassword = body?.newPassword;
    const confirmPassword = body?.confirmPassword;

    if (typeof newPassword !== 'string' || !newPassword || typeof confirmPassword !== 'string' || !confirmPassword) {
      return NextResponse.json(
        { error: 'Заполните оба поля: новый пароль и подтверждение' },
        { status: 400 }
      );
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json(
        { error: 'Пароли не совпадают' },
        { status: 400 }
      );
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, username: true, role: true, password: true, requirePasswordChange: true },
    });

    if (!dbUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (!dbUser.requirePasswordChange) {
      return NextResponse.json(
        { error: 'Смена пароля при первом входе уже выполнена. Используйте «Настройки» для смены пароля.' },
        { status: 400 }
      );
    }

    const passwordError = await validateNewPassword(newPassword, [dbUser.email, dbUser.username]);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    if (await verifyPassword(newPassword, dbUser.password)) {
      return NextResponse.json(
        { error: 'Новый пароль должен отличаться от временного' },
        { status: 400 }
      );
    }

    const hashedPassword = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, requirePasswordChange: false },
    });
    // Временный пароль мог быть известен другим (пароль = логин) — завершаем остальные сессии
    await deleteAllSessionsExcept(user.id, user.sessionId);
    if (user.sessionId && user.sessionExpiresAt) {
      await reissueSessionToken({
        user: { id: dbUser.id, email: dbUser.email, role: dbUser.role },
        sessionId: user.sessionId,
        expiresAt: user.sessionExpiresAt,
        requirePasswordChange: false,
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Пароль успешно установлен. Теперь вы можете пользоваться аккаунтом.',
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Необходима авторизация' }, { status: 401 });
    }
    return NextResponse.json(
      { error: 'Не удалось установить пароль' },
      { status: 500 }
    );
  }
}
