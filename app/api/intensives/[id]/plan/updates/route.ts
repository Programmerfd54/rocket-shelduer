import { NextResponse } from 'next/server';
import { withIntensives, type RouteParams } from '@/lib/intensives/route-context';
import { assertSafeId } from '@/lib/intensives/http';
import { loadIntensiveForViewer } from '@/lib/intensives/access';
import { listPlanUpdates } from '@/lib/intensives/plan-service';

/** GET /api/intensives/[id]/plan/updates — пункты, у источника которых есть новая версия, с отличиями (Lead_SUP). */
export async function GET(_request: Request, { params }: RouteParams<{ id: string }>) {
  return withIntensives(
    'list plan updates',
    async ({ viewer }) => {
      const id = assertSafeId((await params).id);
      await loadIntensiveForViewer(viewer, id);
      return NextResponse.json({ updates: await listPlanUpdates(id) });
    },
    { action: 'intensives:manage' }
  );
}
