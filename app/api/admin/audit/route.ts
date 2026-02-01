import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import type { Role, ActivityType } from '@prisma/client';
import { requireAuth } from '@/lib/auth';

const ADMIN_ACTIONS: ActivityType[] = [
  'USER_BLOCKED',
  'USER_UNBLOCKED',
  'USER_ROLE_CHANGED',
  'USER_CREATED_BY_ADMIN',
  'WORKSPACE_ARCHIVED',
  'ADMIN_ACTION',
];

export async function GET(request: Request) {
  try {
    const currentUser = await requireAuth();

    // Журнал действий доступен только SUP и ADMIN; у ADM кнопка заблокирована
    if (currentUser.role !== 'SUPPORT' && currentUser.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Insufficient permissions. Audit log is for SUP/ADMIN only.' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(10, parseInt(searchParams.get('limit') || '30', 10)));
    const offset = (page - 1) * limit;

    // ADMIN видит действия SUP и ADMIN; SUP видит только действия SUP
    const roleFilter: Role[] = currentUser.role === 'ADMIN' ? ['SUPPORT', 'ADMIN'] : ['SUPPORT'];
    const adminUserIds = await prisma.user.findMany({
      where: { role: { in: roleFilter } },
      select: { id: true },
    }).then((rows) => rows.map((r) => r.id));

    if (adminUserIds.length === 0) {
      return NextResponse.json({
        logs: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
      });
    }

    const [logs, total] = await Promise.all([
      prisma.activityLog.findMany({
        where: {
          userId: { in: adminUserIds },
          action: { in: ADMIN_ACTIONS },
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.activityLog.count({
        where: {
          userId: { in: adminUserIds },
          action: { in: ADMIN_ACTIONS },
        },
      }),
    ]);

    return NextResponse.json({
      logs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Get admin audit error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch audit log' },
      { status: 500 }
    );
  }
}
