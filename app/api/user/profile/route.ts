import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

export async function PATCH(request: Request) {
  try {
    const user = await requireAuth();
    const body = await request.json();
    const { name, username, sessionDurationMinutes } = body;

    // Логин (email в БД) не изменяется через профиль

    // Проверка уникальности username
    if (username) {
      const existingUsername = await prisma.user.findFirst({
        where: {
          username,
          NOT: { id: user.id },
        },
      });

      if (existingUsername) {
        return NextResponse.json(
          { error: 'Имя пользователя уже занято' },
          { status: 409 }
        );
      }
    }

    const data: { name?: string | null; username?: string | null; sessionDurationMinutes?: number | null } = {};
    if (name !== undefined) data.name = typeof name === 'string' ? name.trim() || null : null;
    if (username !== undefined) data.username = typeof username === 'string' ? username.trim() || null : null;
    if (sessionDurationMinutes !== undefined) {
      if (sessionDurationMinutes === null || sessionDurationMinutes === '') {
        data.sessionDurationMinutes = null;
      } else {
        const n = Number(sessionDurationMinutes);
        if (Number.isNaN(n) || n < 1 || n > 525600) { // max 1 year
          return NextResponse.json(
            { error: 'Длительность сессии должна быть от 1 минуты до 1 года' },
            { status: 400 }
          );
        }
        data.sessionDurationMinutes = Math.round(n);
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        username: true,
        role: true,
        sessionDurationMinutes: true,
      },
    });

    return NextResponse.json({
      success: true,
      user: updatedUser,
    });
  } catch (error) {
    console.error('Update profile error:', error);
    return NextResponse.json(
      { error: 'Failed to update profile' },
      { status: 500 }
    );
  }
}
