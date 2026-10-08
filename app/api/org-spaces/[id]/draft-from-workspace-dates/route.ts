import { NextResponse } from 'next/server';
import { withIntensives, type RouteParams } from '@/lib/intensives/route-context';
import { assertSafeId, parseOrThrow, readJsonBody } from '@/lib/intensives/http';
import { draftFromWorkspaceSchema } from '@/lib/intensives/schemas';
import { draftFromWorkspaceDates } from '@/lib/intensives/org-spaces';
import { toIntensiveSummary } from '@/lib/intensives/progress';

/**
 * POST /api/org-spaces/[id]/draft-from-workspace-dates — черновик интенсива по старым датам подключения
 * { workspaceId, name?, timezone? } (Lead_SUP). Только DRAFT; старые поля подключения не меняются.
 * Повтор для тех же дат возвращает существующий интенсив (existing: true, 200).
 */
export async function POST(request: Request, { params }: RouteParams<{ id: string }>) {
  return withIntensives(
    'draft from workspace dates',
    async ({ user }) => {
      const id = assertSafeId((await params).id);
      const input = parseOrThrow(draftFromWorkspaceSchema, await readJsonBody(request));
      const { intensive, existing, overlaps } = await draftFromWorkspaceDates(user, id, input);
      return NextResponse.json(
        {
          intensive: toIntensiveSummary(intensive, { progress: null, partial: false, overlaps }),
          existing,
          warnings: { overlaps },
        },
        { status: existing ? 200 : 201 }
      );
    },
    { action: 'intensives:manage' }
  );
}
