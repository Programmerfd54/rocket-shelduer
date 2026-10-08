import { NextResponse } from 'next/server';
import { withIntensives, type RouteParams } from '@/lib/intensives/route-context';
import { assertSafeId, parseOrThrow, readJsonBody } from '@/lib/intensives/http';
import { linkWorkspaceSchema } from '@/lib/intensives/schemas';
import { linkWorkspace, unlinkWorkspace } from '@/lib/intensives/org-spaces';

type Params = RouteParams<{ id: string }>;

/**
 * POST /api/org-spaces/[id]/link — привязать подключение { workspaceId, move? } (Lead_SUP).
 * Привязано к другому OrgSpace → 409 WORKSPACE_LINKED_ELSEWHERE (перенос — move: true).
 */
export async function POST(request: Request, { params }: Params) {
  return withIntensives(
    'link workspace',
    async ({ user }) => {
      const id = assertSafeId((await params).id);
      const input = parseOrThrow(linkWorkspaceSchema, await readJsonBody(request));
      const result = await linkWorkspace(user, id, input);
      return NextResponse.json({ success: true, ...result });
    },
    { action: 'org-spaces:manage' }
  );
}

/** DELETE /api/org-spaces/[id]/link?workspaceId= (или body { workspaceId }) — отвязать подключение (Lead_SUP). */
export async function DELETE(request: Request, { params }: Params) {
  return withIntensives(
    'unlink workspace',
    async ({ user }) => {
      const id = assertSafeId((await params).id);
      const fromQuery = new URL(request.url).searchParams.get('workspaceId');
      const workspaceId = assertSafeId(fromQuery ?? (await readJsonBody(request)).workspaceId, 'workspaceId');
      await unlinkWorkspace(user, id, workspaceId);
      return NextResponse.json({ success: true });
    },
    { action: 'org-spaces:manage' }
  );
}
