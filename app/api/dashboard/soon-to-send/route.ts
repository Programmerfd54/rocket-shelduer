import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

/** Сообщения, запланированные к отправке в ближайшие 30 минут (для напоминания на дашборде). */
export async function GET() {
  try {
    const user = await requireAuth();
    const now = new Date();
    const in30min = new Date(now.getTime() + 30 * 60 * 1000);

    const messages = await prisma.scheduledMessage.findMany({
      where: {
        userId: user.id,
        status: 'PENDING',
        scheduledFor: { gte: now, lte: in30min },
      },
      include: {
        workspace: {
          select: { id: true, workspaceName: true },
        },
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { scheduledFor: 'asc' },
    });

    return NextResponse.json({ messages });
  } catch (error) {
    console.error('Soon-to-send error:', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
