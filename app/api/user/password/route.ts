import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth, hashPassword, verifyPassword } from '@/lib/auth';

export async function PATCH(request: Request) {
  try {
    const user = await requireAuth();
    const body = await request.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: 'Все поля обязательны' },
        { status: 400 }
      );
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: 'Новый пароль должен содержать минимум 8 символов' },
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
      select: { id: true, password: true },
    });

    if (!dbUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const isValidPassword = await verifyPassword(currentPassword, dbUser.password);

    if (!isValidPassword) {
      return NextResponse.json(
        { error: 'Неверный текущий пароль' },
        { status: 401 }
      );
    }

    const hashedPassword = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });
    await prisma.session.deleteMany({ where: { userId: user.id } });

    return NextResponse.json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to change password' },
      { status: 500 }
    );
  }
}
