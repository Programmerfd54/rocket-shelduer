import { NextResponse } from 'next/server';
import { withIntensives, type RouteParams } from '@/lib/intensives/route-context';
import { assertSafeId, parseOrThrow, readJsonBody } from '@/lib/intensives/http';
import { loadIntensiveForViewer } from '@/lib/intensives/access';
import { linkMessagesSchema } from '@/lib/intensives/schemas';
import { linkMessages } from '@/lib/intensives/link';

/**
 * POST /api/intensives/[id]/link-messages — привязать подтверждённые сообщения к пунктам (Lead_SUP).
 * Body: { links: [{ messageId, planItemId }] }. Идемпотентно; меняет только intensiveId/planItemId.
 */
export async function POST(request: Request, { params }: RouteParams<{ id: string }>) {
  return withIntensives(
    'link messages',
    async ({ user, viewer }) => {
      const id = assertSafeId((await params).id);
      const { links } = parseOrThrow(linkMessagesSchema, await readJsonBody(request));
      const intensive = await loadIntensiveForViewer(viewer, id);
      const results = await linkMessages(user, intensive, links);
      const summary = results.reduce<Record<string, number>>((acc, r) => {
        acc[r.result] = (acc[r.result] ?? 0) + 1;
        return acc;
      }, {});
      return NextResponse.json({ results, summary, processed: results.length });
    },
    { action: 'intensives:link-messages' }
  );
}
