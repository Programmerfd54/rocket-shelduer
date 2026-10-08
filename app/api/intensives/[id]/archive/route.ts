import { NextResponse } from 'next/server';
import { withIntensives, type RouteParams } from '@/lib/intensives/route-context';
import { assertSafeId, parseOrThrow, readJsonBody } from '@/lib/intensives/http';
import { statusChangeSchema } from '@/lib/intensives/schemas';
import { archiveIntensive, getIntensiveDetail } from '@/lib/intensives/service';

/**
 * POST /api/intensives/[id]/archive — в архив (Lead_SUP): черновик, отменённый или завершившийся опубликованный.
 * Сообщения и пространство не затрагиваются.
 */
export async function POST(request: Request, { params }: RouteParams<{ id: string }>) {
  return withIntensives(
    'archive intensive',
    async ({ user, viewer }) => {
      const id = assertSafeId((await params).id);
      const { version } = parseOrThrow(statusChangeSchema, await readJsonBody(request));
      const { pendingMessages } = await archiveIntensive(user, viewer, id, version);
      return NextResponse.json({ intensive: await getIntensiveDetail(viewer, id), pendingMessages });
    },
    { action: 'intensives:manage' }
  );
}
