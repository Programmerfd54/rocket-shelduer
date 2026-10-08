import { NextResponse } from 'next/server';
import { withIntensives, type RouteParams } from '@/lib/intensives/route-context';
import { assertSafeId, parseOrThrow, readJsonBody } from '@/lib/intensives/http';
import { loadIntensiveForViewer } from '@/lib/intensives/access';
import { createPlanItemSchema } from '@/lib/intensives/schemas';
import { addPlanItem } from '@/lib/intensives/plan-service';

/**
 * POST /api/intensives/[id]/plan/items — добавить пункт вручную (Lead_SUP)
 * или снимок своего пользовательского шаблона (sourceUserTemplateId).
 */
export async function POST(request: Request, { params }: RouteParams<{ id: string }>) {
  return withIntensives(
    'add plan item',
    async ({ user, viewer }) => {
      const id = assertSafeId((await params).id);
      const input = parseOrThrow(createPlanItemSchema, await readJsonBody(request));
      const intensive = await loadIntensiveForViewer(viewer, id);
      const item = await addPlanItem(user, intensive, input);
      return NextResponse.json({ item }, { status: 201 });
    },
    { action: 'intensives:manage' }
  );
}
