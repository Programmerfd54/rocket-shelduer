import { NextResponse } from 'next/server';
import { withIntensives, type RouteParams } from '@/lib/intensives/route-context';
import { assertSafeId } from '@/lib/intensives/http';
import { loadIntensiveForViewer } from '@/lib/intensives/access';
import { applyPlanUpdate } from '@/lib/intensives/plan-service';

/**
 * POST /api/intensives/[id]/plan/items/[itemId]/apply-update — применить новую версию шаблона к пункту
 * (Lead_SUP; только если у пункта никогда не было отправок).
 */
export async function POST(_request: Request, { params }: RouteParams<{ id: string; itemId: string }>) {
  return withIntensives(
    'apply plan item update',
    async ({ user, viewer }) => {
      const p = await params;
      const id = assertSafeId(p.id);
      const itemId = assertSafeId(p.itemId, 'itemId');
      const intensive = await loadIntensiveForViewer(viewer, id);
      const item = await applyPlanUpdate(user, intensive, itemId);
      return NextResponse.json({ item });
    },
    { action: 'intensives:manage' }
  );
}
