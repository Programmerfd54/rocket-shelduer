import { NextResponse } from 'next/server';
import { withIntensives, type RouteParams } from '@/lib/intensives/route-context';
import { assertSafeId } from '@/lib/intensives/http';
import { loadIntensiveForViewer } from '@/lib/intensives/access';
import { getIntensiveHistory } from '@/lib/intensives/history';

/**
 * GET /api/intensives/[id]/history?cursor=&limit=&planItemId=
 * События истории (новые сверху), постранично. Без текста сообщений; недоступные вызывающему — урезаны.
 */
export async function GET(request: Request, { params }: RouteParams<{ id: string }>) {
  return withIntensives('get intensive history', async ({ viewer }) => {
    const id = assertSafeId((await params).id);
    await loadIntensiveForViewer(viewer, id);
    const sp = new URL(request.url).searchParams;
    const cursor = sp.get('cursor');
    const planItemId = sp.get('planItemId');
    const limitRaw = Number(sp.get('limit') ?? 50);
    const history = await getIntensiveHistory(viewer, id, {
      cursor: cursor ? assertSafeId(cursor, 'cursor') : null,
      planItemId: planItemId ? assertSafeId(planItemId, 'planItemId') : null,
      limit: Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 50,
    });
    return NextResponse.json(history);
  });
}
