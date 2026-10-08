import { NextResponse } from 'next/server';
import { withIntensives } from '@/lib/intensives/route-context';
import { parseOrThrow, readJsonBody } from '@/lib/intensives/http';
import { createIntensiveSchema } from '@/lib/intensives/schemas';
import { createIntensive, listIntensives, parseListFilters } from '@/lib/intensives/service';
import { computeProgressForIntensives, toIntensiveSummary } from '@/lib/intensives/progress';

/**
 * GET /api/intensives?year=&orgSpaceId=&workspaceId=&phase=&status=&progress=
 * Список интенсивов, доступных вызывающему (черновики — только Lead_SUP), с прогрессом (считает сервер).
 */
export async function GET(request: Request) {
  return withIntensives('list intensives', async ({ viewer }) => {
    const filters = parseListFilters(new URL(request.url).searchParams);
    const { intensives, resolvedOrgSpaceId } = await listIntensives(viewer, filters);
    return NextResponse.json({ intensives, orgSpaceId: resolvedOrgSpaceId });
  });
}

/** POST /api/intensives — создать черновик (Lead_SUP). Отправки не запускаются. */
export async function POST(request: Request) {
  return withIntensives(
    'create intensive',
    async ({ user, viewer }) => {
      const input = parseOrThrow(createIntensiveSchema, await readJsonBody(request));
      const { intensive, overlaps, plan } = await createIntensive(user, input);
      const progress = await computeProgressForIntensives(viewer, [intensive.id]);
      const p = progress.get(intensive.id);
      return NextResponse.json(
        {
          intensive: toIntensiveSummary(intensive, { progress: p?.progress ?? null, partial: p?.partial ?? false, overlaps }),
          warnings: { overlaps },
          plan,
        },
        { status: 201 }
      );
    },
    { action: 'intensives:manage' }
  );
}
