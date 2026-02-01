import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import type { ActivityType } from '@prisma/client';
import { requireAuth } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const scope = searchParams.get('scope'); // vol — только VOL (для SUP), all — все (для ADMIN)

    const where: any = { userId: user.id };
    if (user.role === 'ADMIN' && scope === 'all') {
      delete where.userId; // ADMIN видит всю активность
    } else if (user.role === 'SUPPORT' && scope === 'vol') {
      // SUP видит только активность VOL, никогда — ADM и других
      const restricted = (user.restrictedFeatures ?? []) as string[];
      const sys = await prisma.systemSetting.findUnique({ where: { key: 'activityViewVolSup' } });
      const sysEnabled = (sys?.value ?? 'true') === 'true';
      if (!restricted.includes('activityView') && sysEnabled) {
        const volUserIds = await prisma.user.findMany({
          where: { role: 'VOL' },
          select: { id: true },
        }).then((rows) => rows.map((r) => r.id));
        where.userId = { in: volUserIds };
      }
      // иначе остаётся where.userId = user.id (только своя активность)
    }
    if (action && action !== 'all') {
      where.action = action;
    }

    const logs = await prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: scope === 'all' || scope === 'vol' ? {
        user: {
          select: { id: true, name: true, email: true, role: true },
        },
      } : undefined,
    });

    return NextResponse.json({ logs });
  } catch (error) {
    console.error('Get activity logs error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch activity logs' },
      { status: 500 }
    );
  }
}

// Helper function для создания логов (используй в других API routes)
export async function createActivityLog(
  userId: string,
  action: ActivityType,
  details?: any,
  entityType?: string,
  entityId?: string,
  request?: Request
) {
  try {
    const ipAddress = request?.headers.get('x-forwarded-for') || 
                     request?.headers.get('x-real-ip') || 
                     'unknown';
    const userAgent = request?.headers.get('user-agent') || 'unknown';

    await prisma.activityLog.create({
      data: {
        userId,
        action,
        entityType,
        entityId,
        details: details ? JSON.stringify(details) : null,
        ipAddress,
        userAgent
      }
    });
  } catch (error) {
    console.error('Error creating activity log:', error);
  }
}