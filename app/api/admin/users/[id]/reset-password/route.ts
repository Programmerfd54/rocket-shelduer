import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth, hashPassword } from '@/lib/auth';

function generateRandomPassword(length: number = 12): string {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;

    if (user.role !== 'SUPPORT' && user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    });

    if (!targetUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Только ADMIN может сбросить пароль SUP или ADMIN
    if ((targetUser.role === 'SUPPORT' || targetUser.role === 'ADMIN') && user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Cannot reset admin password' },
        { status: 403 }
      );
    }

    const newPassword = generateRandomPassword();
    const hashedPassword = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id },
      data: { password: hashedPassword },
    });
    await prisma.session.deleteMany({ where: { userId: id } });

    return NextResponse.json({
      success: true,
      newPassword,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to reset password' },
      { status: 500 }
    );
  }
}
