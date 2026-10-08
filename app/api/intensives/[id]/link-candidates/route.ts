import { NextResponse } from 'next/server';
import { withIntensives, type RouteParams } from '@/lib/intensives/route-context';
import { assertSafeId } from '@/lib/intensives/http';
import { loadIntensiveForViewer } from '@/lib/intensives/access';
import { getLinkCandidates } from '@/lib/intensives/link';

/**
 * GET /api/intensives/[id]/link-candidates — старые сообщения подключений OrgSpace в периоде интенсива,
 * созданные из тех же шаблонов, что и пункты плана (только кандидаты, Lead_SUP).
 */
export async function GET(_request: Request, { params }: RouteParams<{ id: string }>) {
  return withIntensives(
    'link candidates',
    async ({ viewer }) => {
      const id = assertSafeId((await params).id);
      const intensive = await loadIntensiveForViewer(viewer, id);
      return NextResponse.json(await getLinkCandidates(intensive));
    },
    { action: 'intensives:link-messages' }
  );
}
