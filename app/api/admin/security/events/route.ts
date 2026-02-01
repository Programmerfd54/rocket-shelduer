import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import prisma from '@/lib/prisma';

/**
 * GET /api/admin/security/events
 * Получить журнал событий безопасности с фильтрацией и пагинацией
 * Только для ADMIN
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    
    // Пагинация
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50')));
    const skip = (page - 1) * limit;

    // Фильтры
    const typeFilter = searchParams.get('type') || undefined;
    const ipFilter = searchParams.get('ip') || undefined;
    const pathFilter = searchParams.get('path') || undefined;
    const detailsFilter = searchParams.get('details') || undefined;
    const blockedFilter = searchParams.get('blocked');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    // Построение where clause
    const where: any = {};

    if (typeFilter) {
      where.type = typeFilter;
    }

    if (ipFilter) {
      where.ipAddress = { contains: ipFilter, mode: 'insensitive' };
    }

    if (pathFilter) {
      where.path = { contains: pathFilter, mode: 'insensitive' };
    }

    if (detailsFilter) {
      where.details = { contains: detailsFilter, mode: 'insensitive' };
    }

    if (blockedFilter === 'true') {
      where.blocked = true;
    } else if (blockedFilter === 'false') {
      where.blocked = false;
    }

    // Фильтр по датам
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        where.createdAt.gte = new Date(dateFrom);
      }
      if (dateTo) {
        where.createdAt.lte = new Date(dateTo);
      }
    }

    // Получаем общее количество
    const total = await prisma.securityEvent.count({ where });
    const totalPages = Math.ceil(total / limit);

    // Получаем события
    const events = await prisma.securityEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        type: true,
        path: true,
        method: true,
        ipAddress: true,
        userAgent: true,
        details: true,
        blocked: true,
        userId: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      events,
      total,
      page,
      limit,
      totalPages,
    });
  } catch (error) {
    console.error('Error loading security events:', error);
    return NextResponse.json(
      { error: 'Failed to load security events' },
      { status: 500 }
    );
  }
}