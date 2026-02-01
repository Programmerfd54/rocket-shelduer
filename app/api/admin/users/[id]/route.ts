import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth, hashPassword } from '@/lib/auth';
import { createActivityLog } from '@/app/api/activity/route';

/** Редактирование профиля пользователя администратором: имя, логин (email), username, пароль */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await requireAuth();
    const { id } = await params;

    if (currentUser.role !== 'SUPPORT' && currentUser.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

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

    if (targetUser.role === 'ADMIN' && currentUser.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only ADMIN can edit ADMIN user profile' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { name, email, username, newPassword } = body;

    const data: { name?: string | null; email?: string; username?: string | null; password?: string } = {};

    if (name !== undefined) {
      data.name = typeof name === 'string' ? name.trim() || null : null;
    }
    if (email !== undefined && typeof email === 'string') {
      const trimmed = email.trim().toLowerCase();
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
      if (newPassword.length < 8) {
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
  } catch (error) {
    console.error('Admin update profile error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update profile' },
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
    const currentUser = await requireAuth();
    const { id } = await params;

    if (currentUser.role !== 'SUPPORT' && currentUser.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

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
    if (targetUser?.role === 'ADMIN' && currentUser.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only superuser can delete ADMIN users' },
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
  } catch (error) {
    console.error('Delete user error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete user' },
      { status: 500 }
    );
  }
}
