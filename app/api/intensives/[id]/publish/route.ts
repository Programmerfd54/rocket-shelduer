import { NextResponse } from 'next/server';
import { withIntensives, type RouteParams } from '@/lib/intensives/route-context';
import { assertSafeId, parseOrThrow, readJsonBody } from '@/lib/intensives/http';
import { statusChangeSchema } from '@/lib/intensives/schemas';
import { getIntensiveDetail, publishIntensive } from '@/lib/intensives/service';

/**
 * POST /api/intensives/[id]/publish — черновик → опубликован (Lead_SUP).
 * Под advisory lock OrgSpace; пересечение с опубликованным интенсивом → 409 INTENSIVE_OVERLAP { conflicts }.
 */
export async function POST(request: Request, { params }: RouteParams<{ id: string }>) {
  return withIntensives(
    'publish intensive',
    async ({ user, viewer }) => {
      const id = assertSafeId((await params).id);
      const { version } = parseOrThrow(statusChangeSchema, await readJsonBody(request));
      await publishIntensive(user, viewer, id, version);
      return NextResponse.json({ intensive: await getIntensiveDetail(viewer, id) });
    },
    { action: 'intensives:manage' }
  );
}
