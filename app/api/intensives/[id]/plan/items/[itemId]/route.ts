import { NextResponse } from 'next/server';
import { withIntensives, type RouteParams } from '@/lib/intensives/route-context';
import { assertSafeId, parseOrThrow, readJsonBody } from '@/lib/intensives/http';
import { loadIntensiveForViewer } from '@/lib/intensives/access';
import { updatePlanItemSchema } from '@/lib/intensives/schemas';
import { deletePlanItem, updatePlanItem } from '@/lib/intensives/plan-service';

type Params = RouteParams<{ id: string; itemId: string }>;

/**
 * PATCH /api/intensives/[id]/plan/items/[itemId] (Lead_SUP)
 * Поля снимка — только если к пункту никогда не привязывались отправки (иначе 409 PLAN_ITEM_HAS_MESSAGES).
 * Пропуск: { skipped: true, skipReason }; вернуть: { skipped: false }. Порядок: { position }.
 */
export async function PATCH(request: Request, { params }: Params) {
  return withIntensives(
    'update plan item',
    async ({ user, viewer }) => {
      const p = await params;
      const id = assertSafeId(p.id);
      const itemId = assertSafeId(p.itemId, 'itemId');
      const input = parseOrThrow(updatePlanItemSchema, await readJsonBody(request));
      const intensive = await loadIntensiveForViewer(viewer, id);
      const item = await updatePlanItem(user, intensive, itemId, input);
      return NextResponse.json({ item });
    },
    { action: 'intensives:manage' }
  );
}

/** DELETE — только если к пункту никогда не привязывались отправки (иначе 409 — можно пропустить). */
export async function DELETE(_request: Request, { params }: Params) {
  return withIntensives(
    'delete plan item',
    async ({ user, viewer }) => {
      const p = await params;
      const id = assertSafeId(p.id);
      const itemId = assertSafeId(p.itemId, 'itemId');
      const intensive = await loadIntensiveForViewer(viewer, id);
      await deletePlanItem(user, intensive, itemId);
      return NextResponse.json({ success: true });
    },
    { action: 'intensives:manage' }
  );
}
