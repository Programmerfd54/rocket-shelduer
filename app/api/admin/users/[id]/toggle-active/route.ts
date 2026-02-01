import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const body = await request.json();
    const { isActive } = body;

    if (user.role !== 'SUPPORT' && user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    if (user.id === id) {
      return NextResponse.json(
        { error: 'Cannot change your own status' },
        { status: 400 }
      );
    }

    const targetUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!targetUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Только ADMIN может менять статус SUP или ADMIN
    if ((targetUser.role === 'SUPPORT' || targetUser.role === 'ADMIN') && user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Cannot modify admin user' },
        { status: 403 }
      );
    }

    await prisma.user.update({
      where: { id },
      data: { isActive },
    });

    return NextResponse.json({
      success: true,
      message: 'User status updated',
    });
  } catch (error) {
    console.error('Toggle user active error:', error);
    return NextResponse.json(
      { error: 'Failed to update user status' },
      { status: 500 }
    );
  }
}
