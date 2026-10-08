import { NextResponse } from 'next/server';
import { getSafeErrorMessage } from '@/lib/security';
import prisma from '@/lib/prisma';
import { hashPassword, isForbiddenError } from '@/lib/auth';
import { requireSupportOrAdmin } from '@/lib/api-auth';
import { canManageUserWithRole } from '@/lib/roles';
import { canPerformAction } from '@/lib/permissions';
import { createActivityLog } from '@/app/api/activity/route';
import { isUnsafeId } from '@/lib/security';

/** Редактирование профиля пользователя администратором: имя, логин (email), username, пароль */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await requireSupportOrAdmin();
    if (!canPerformAction(currentUser, 'admin:users:edit')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }
    const { id } = await params;
    if (isUnsafeId(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, name: true, username: true, role: true },
    });

    if (!targetUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    if (!canManageUserWithRole(currentUser.role, targetUser.role)) {
      return NextResponse.json(
        { error: 'Недостаточно прав для изменения этого пользователя' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { name, email, username, newPassword } = body;

    const data: { name?: string | null; email?: string; username?: string | null; password?: string } = {};

    if (name !== undefined) {
      data.name = typeof name === 'string' ? name.trim().slice(0, 200) || null : null;
    }
    if (email !== undefined && typeof email === 'string') {
      const trimmed = email.trim().toLowerCase();
      if (trimmed.length > 200 || /\s/.test(trimmed)) {
        return NextResponse.json({ error: 'Некорректный логин' }, { status: 400 });
      }
      if (!trimmed) {
        return NextResponse.json(
          { error: 'Логин (email) не может быть пустым' },
          { status: 400 }
        );
      }
      const existing = await prisma.user.findFirst({
        where: { email: trimmed, NOT: { id } },
      });
      if (existing) {
        return NextResponse.json(
          { error: 'Пользователь с таким логином уже существует' },
          { status: 409 }
        );
      }
      data.email = trimmed;
    }
    if (username !== undefined) {
      const val = typeof username === 'string' ? username.trim() || null : null;
      if (val !== null && (val.length > 100 || /[\s<>"']/.test(val))) {
        return NextResponse.json(
          { error: 'Некорректный username (до 100 символов, без пробелов и кавычек)' },
          { status: 400 }
        );
      }
      if (val !== null) {
        const existing = await prisma.user.findFirst({
          where: { username: val, NOT: { id } },
        });
        if (existing) {
          return NextResponse.json(
            { error: 'Имя пользователя (username) уже занято' },
            { status: 409 }
          );
        }
      }
      data.username = val;
    }
    if (newPassword !== undefined && typeof newPassword === 'string') {
      if (newPassword.length < 8 || newPassword.length > 200) {
        return NextResponse.json(
          { error: 'Пароль должен быть не менее 8 символов' },
          { status: 400 }
        );
      }
      data.password = await hashPassword(newPassword);
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: 'Нет данных для обновления' },
        { status: 400 }
      );
    }

    await prisma.user.update({
      where: { id },
      data,
    });
    // Смена пароля/логина администратором завершает сессии пользователя (кроме собственной текущей)
    if (data.password || data.email) {
      await prisma.session.deleteMany({
        where: { userId: id, ...(id === currentUser.id && currentUser.sessionId ? { id: { not: currentUser.sessionId } } : {}) },
      });
    }

    await createActivityLog(
      currentUser.id,
      'ADMIN_ACTION',
      { action: 'user_profile_updated', targetUserId: id, fields: Object.keys(data) },
      'User',
      id,
      request
    );

    const updated = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, name: true, username: true, role: true },
    });

    return NextResponse.json({ success: true, user: updated });
  } catch (e) {
    if (isForbiddenError(e)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    console.error('Admin update profile error:', e);
    return NextResponse.json(
      { error: getSafeErrorMessage(e, 'Failed to update profile') },
      { status: 500 }
    );
  }
}

/** Удаление пользователя (только SUP). Каскадно удаляются workspace, сообщения, заметки и т.д. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await requireSupportOrAdmin();
    if (!canPerformAction(currentUser, 'admin:users:edit')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }
    const { id } = await params;
    if (isUnsafeId(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

    if (currentUser.id === id) {
      return NextResponse.json(
        { error: 'Cannot delete yourself' },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: { role: true },
    });
    if (targetUser && !canManageUserWithRole(currentUser.role, targetUser.role)) {
      return NextResponse.json(
        { error: 'Недостаточно прав для удаления этого пользователя' },
        { status: 403 }
      );
    }

    await prisma.user.delete({
      where: { id },
    });

    await createActivityLog(
      currentUser.id,
      'ADMIN_ACTION',
      { action: 'user_deleted', targetUserId: id, email: user.email },
      'User',
      id,
      request
    );

    return NextResponse.json({ success: true });
  } catch (e) {
    if (isForbiddenError(e)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    console.error('Delete user error:', e);
    return NextResponse.json(
      { error: getSafeErrorMessage(e, 'Failed to delete user') },
      { status: 500 }
    );
  }
}
