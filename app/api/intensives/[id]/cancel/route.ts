import { NextResponse } from 'next/server';
import { withIntensives, type RouteParams } from '@/lib/intensives/route-context';
import { assertSafeId, parseOrThrow, readJsonBody } from '@/lib/intensives/http';
import { cancelIntensiveSchema } from '@/lib/intensives/schemas';
import { cancelIntensive, getIntensiveDetail } from '@/lib/intensives/service';

/**
 * POST /api/intensives/[id]/cancel — отменить интенсив (Lead_SUP). Body: { version?, reason?, resolution? }.
 * Есть ожидающие отправки и нет resolution → 409 PENDING_MESSAGES_EXIST { pendingMessages }.
 * resolution: 'cancel_messages' (PENDING → CANCELLED) | 'detach_messages' (снять привязку, сообщения остаются).
 */
export async function POST(request: Request, { params }: RouteParams<{ id: string }>) {
  return withIntensives(
    'cancel intensive',
    async ({ user, viewer }) => {
      const id = assertSafeId((await params).id);
      const input = parseOrThrow(cancelIntensiveSchema, await readJsonBody(request));
      const { affectedMessages, resolution } = await cancelIntensive(user, viewer, id, input);
      return NextResponse.json({ intensive: await getIntensiveDetail(viewer, id), affectedMessages, resolution });
    },
    { action: 'intensives:manage' }
  );
}
