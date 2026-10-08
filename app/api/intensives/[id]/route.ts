import { NextResponse } from 'next/server';
import { withIntensives, type RouteParams } from '@/lib/intensives/route-context';
import { assertSafeId, parseOrThrow, readJsonBody } from '@/lib/intensives/http';
import { updateIntensiveSchema } from '@/lib/intensives/schemas';
import { getIntensiveDetail, updateIntensive } from '@/lib/intensives/service';

/** GET /api/intensives/[id] — карточка интенсива + сводка плана (прогресс). */
export async function GET(_request: Request, { params }: RouteParams<{ id: string }>) {
  return withIntensives('get intensive', async ({ viewer }) => {
    const id = assertSafeId((await params).id);
    const intensive = await getIntensiveDetail(viewer, id);
    return NextResponse.json({ intensive });
  });
}

/**
 * PATCH /api/intensives/[id] — название/описание/даты/пояс (Lead_SUP), body.version обязателен.
 * Если есть связанные сообщения и меняются даты/пояс — 409 IMPACT_CONFIRMATION_REQUIRED с impact,
 * затем повтор с confirmImpact: true (+ outOfRangeResolution, если ожидающие сообщения выйдут за период).
 * Время существующих сообщений не меняется никогда.
 */
export async function PATCH(request: Request, { params }: RouteParams<{ id: string }>) {
  return withIntensives(
    'update intensive',
    async ({ user, viewer }) => {
      const id = assertSafeId((await params).id);
      const input = parseOrThrow(updateIntensiveSchema, await readJsonBody(request));
      const { impact } = await updateIntensive(user, viewer, id, input);
      const intensive = await getIntensiveDetail(viewer, id);
      return NextResponse.json({ intensive, impact });
    },
    { action: 'intensives:manage' }
  );
}
