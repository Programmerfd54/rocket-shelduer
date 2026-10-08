import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { hashPassword, isForbiddenError } from '@/lib/auth';
import { requireSupportOrAdmin } from '@/lib/api-auth';
import { canManageUserWithRole } from '@/lib/roles';
import { canPerformAction } from '@/lib/permissions';
import { isUnsafeId } from '@/lib/security';
import { generateTemporaryPassword } from '@/lib/admin-user-schemas';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireSupportOrAdmin();
    if (!canPerformAction(user, 'admin:users:reset-password')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }
    const { id } = await params;
    if (isUnsafeId(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

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

    if (!canManageUserWithRole(user.role, targetUser.role)) {
      return NextResponse.json(
        { error: 'Cannot reset password for this role' },
        { status: 403 }
      );
    }

    const newPassword = generateTemporaryPassword();
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
  } catch (e) {
    if (isForbiddenError(e)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 });
  }
}
