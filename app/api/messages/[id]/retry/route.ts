import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { isUnsafeId } from '@/lib/security';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/messages/[id]/retry — повторить отправку сообщения со статусом FAILED.
 * Устанавливает status = PENDING, scheduledFor = через 1 минуту, очищает error.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    if (isUnsafeId(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

    const message = await prisma.scheduledMessage.findUnique({
      where: { id },
    });

    if (!message) {
      return NextResponse.json(
        { error: 'Message not found' },
        { status: 404 }
      );
    }

    if (message.userId !== user.id && user.role !== 'SUPPORT') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      );
    }

    if (message.status !== 'FAILED') {
      return NextResponse.json(
        { error: 'Can only retry messages with status FAILED' },
        { status: 400 }
      );
    }

    const scheduledFor = new Date(Date.now() + 60 * 1000); // через 1 минуту

    const updated = await prisma.scheduledMessage.update({
      where: { id },
      data: {
        status: 'PENDING',
        scheduledFor,
        error: null,
        updatedAt: new Date(),
      },
      include: {
        workspace: {
          select: {
            workspaceName: true,
            workspaceUrl: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      message: updated,
      scheduledFor: updated.scheduledFor.toISOString(),
    });
  } catch (error) {
    console.error('Message retry error:', error);
    return NextResponse.json(
      { error: 'Failed to retry message' },
      { status: 500 }
    );
  }
}
