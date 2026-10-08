/**
 * Пересечения интенсивов одного OrgSpace.
 *  - Опубликованные пересекаться не могут: проверка в транзакции под pg_advisory_xact_lock(hashtext(orgSpaceId))
 *    + EXCLUDE-ограничение "Intensive_published_no_overlap" в БД (если доступен btree_gist).
 *  - Пересечение с черновиками — только предупреждение.
 * Одинаковые даты в разных OrgSpace допустимы.
 */
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { dbDateFromYmd, ymdFromDbDate } from './dates';
import type { IntensiveOverlapRef, IntensiveStatus } from './types';

type Db = Prisma.TransactionClient | typeof prisma;

/** Имя EXCLUDE-ограничения (для распознавания ошибки гонки). */
export const OVERLAP_CONSTRAINT = 'Intensive_published_no_overlap';

/** Транзакционная блокировка публикаций/изменения дат в OrgSpace (снимается в конце транзакции). */
export async function lockOrgSpaceSchedule(tx: Prisma.TransactionClient, orgSpaceId: string): Promise<void> {
  const key = `intensive-overlap:${orgSpaceId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

export async function findOverlaps(
  db: Db,
  params: {
    orgSpaceId: string;
    startYmd: string;
    endYmd: string;
    excludeId?: string;
    statuses?: IntensiveStatus[];
  }
): Promise<IntensiveOverlapRef[]> {
  const rows = await db.intensive.findMany({
    where: {
      orgSpaceId: params.orgSpaceId,
      status: { in: params.statuses ?? ['DRAFT', 'PUBLISHED'] },
      startDate: { lte: dbDateFromYmd(params.endYmd) },
      endDate: { gte: dbDateFromYmd(params.startYmd) },
      ...(params.excludeId ? { id: { not: params.excludeId } } : {}),
    },
    select: { id: true, name: true, status: true, startDate: true, endDate: true },
    orderBy: { startDate: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    startDate: ymdFromDbDate(r.startDate),
    endDate: ymdFromDbDate(r.endDate),
  }));
}
