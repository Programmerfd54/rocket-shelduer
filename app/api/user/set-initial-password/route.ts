import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth, hashPassword } from '@/lib/auth';

/**
 * PATCH — установка нового пароля при первом входе (после сброса пароля на логин).
 * Доступно только если у пользователя requirePasswordChange === true.
 */
export async function PATCH(request: Request) {
  try {
    const user = await requireAuth();
    const body = await request.json();
    const { newPassword, confirmPassword } = body;

    if (!newPassword || !confirmPassword) {
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

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: 'Пароль должен содержать минимум 8 символов' },
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

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, requirePasswordChange: true },
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

    const hashedPassword = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, requirePasswordChange: false },
    });

    return NextResponse.json({
      success: true,
      message: 'Пароль успешно установлен. Теперь вы можете пользоваться аккаунтом.',
    });
  } catch {
    return NextResponse.json(
      { error: 'Не удалось установить пароль' },
      { status: 500 }
    );
  }
}
