import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

const MAX_NAME_LENGTH = 100;
/** Username используется для входа: без пробелов/«@»/кавычек, чтобы не пересекаться с логинами (email) других. */
const USERNAME_RE = /^[\p{L}\p{N}._-]{2,64}$/u;

export async function PATCH(request: Request) {
  try {
    const user = await requireAuth();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 });
    }
    const { name, username, sessionDurationMinutes } = body as Record<string, unknown>;

    // Логин (email в БД) не изменяется через профиль

    const data: { name?: string | null; username?: string | null; sessionDurationMinutes?: number | null } = {};
    if (name !== undefined) {
      const n = typeof name === 'string' ? name.trim() : '';
      if (n.length > MAX_NAME_LENGTH) {
        return NextResponse.json({ error: `Имя не длиннее ${MAX_NAME_LENGTH} символов` }, { status: 400 });
      }
      data.name = n || null;
    }

    if (username !== undefined) {
      const newUsername = typeof username === 'string' ? username.trim() || null : null;
      const current = await prisma.user.findUnique({ where: { id: user.id }, select: { username: true } });
      // Проверяем только реально изменённое значение (старые username могут не соответствовать новым правилам)
      if (newUsername && newUsername !== current?.username) {
        if (!USERNAME_RE.test(newUsername)) {
          return NextResponse.json(
            { error: 'Имя пользователя: 2–64 символа, буквы, цифры, точка, дефис, подчёркивание' },
            { status: 400 }
          );
        }
        // Уникальность без учёта регистра (вход по username регистронезависимый) и
        // запрет совпадения с чужим логином (email), чтобы не мешать входу другого пользователя
        const conflict = await prisma.user.findFirst({
          where: {
            NOT: { id: user.id },
            OR: [
              { username: { equals: newUsername, mode: 'insensitive' } },
              { email: { equals: newUsername, mode: 'insensitive' } },
            ],
          },
          select: { id: true },
        });
        if (conflict) {
          return NextResponse.json(
            { error: 'Имя пользователя уже занято' },
            { status: 409 }
          );
        }
      }
      data.username = newUsername;
    }

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
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Необходима авторизация' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
    }
    if (error && typeof error === 'object' && (error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Имя пользователя уже занято' }, { status: 409 });
    }
    console.error('Update profile error:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json(
      { error: 'Failed to update profile' },
      { status: 500 }
    );
  }
}
