import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

/** Сводка по пространствам для админки: активные, в архиве */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const role = user.role as string;
    if (role !== 'SUPPORT' && role !== 'ADM' && role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const [activeCount, archivedCount] = await Promise.all([
      prisma.workspaceConnection.count({ where: { isArchived: false } }),
      prisma.workspaceConnection.count({ where: { isArchived: true } }),
    ]);

    return NextResponse.json({
      active: activeCount,
      archived: archivedCount,
    });
  } catch (e) {
    console.error('workspace-stats error:', e);
    return NextResponse.json({ error: 'Failed to load workspace stats' }, { status: 500 });
  }
}
