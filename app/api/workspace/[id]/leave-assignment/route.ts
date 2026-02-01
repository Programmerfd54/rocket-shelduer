import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

/** POST — отказаться от назначенного пространства (убрать себя из назначенных) */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await requireAuth();
    const { id: workspaceId } = await params;

    const deleted = await prisma.workspaceAdminAssignment.deleteMany({
      where: { workspaceId, userId: currentUser.id },
    });

    return NextResponse.json({
      success: true,
      removed: deleted.count > 0,
    });
  } catch (error) {
    console.error('Leave workspace assignment error:', error);
    return NextResponse.json(
      { error: 'Failed to leave assignment' },
      { status: 500 }
    );
  }
}
