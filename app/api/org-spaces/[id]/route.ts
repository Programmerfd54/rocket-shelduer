import { NextResponse } from 'next/server';
import { withIntensives, type RouteParams } from '@/lib/intensives/route-context';
import { ApiError, assertSafeId, parseOrThrow, readJsonBody } from '@/lib/intensives/http';
import { updateOrgSpaceSchema } from '@/lib/intensives/schemas';
import { deleteOrgSpace, listOrgSpaces, updateOrgSpace } from '@/lib/intensives/org-spaces';
import { canViewOrgSpace } from '@/lib/intensives/access';

type Params = RouteParams<{ id: string }>;

/** GET /api/org-spaces/[id] — один OrgSpace (те же правила видимости, что у списка). */
export async function GET(_request: Request, { params }: Params) {
  return withIntensives('get org space', async ({ viewer }) => {
    const id = assertSafeId((await params).id);
    if (!canViewOrgSpace(viewer, id)) throw new ApiError(404, 'NOT_FOUND', 'Пространство не найдено');
    const orgSpace = (await listOrgSpaces(viewer)).find((s) => s.id === id);
    if (!orgSpace) throw new ApiError(404, 'NOT_FOUND', 'Пространство не найдено');
    return NextResponse.json({ orgSpace });
  });
}

/** PATCH /api/org-spaces/[id] — { name?, description? } (Lead_SUP). */
export async function PATCH(request: Request, { params }: Params) {
  return withIntensives(
    'update org space',
    async ({ user }) => {
      const id = assertSafeId((await params).id);
      const input = parseOrThrow(updateOrgSpaceSchema, await readJsonBody(request));
      const orgSpace = await updateOrgSpace(user, id, input);
      return NextResponse.json({ orgSpace });
    },
    { action: 'org-spaces:manage' }
  );
}

/** DELETE /api/org-spaces/[id] — только если интенсивов нет (иначе 409 ORG_SPACE_HAS_INTENSIVES). Подключения отвязываются. */
export async function DELETE(_request: Request, { params }: Params) {
  return withIntensives(
    'delete org space',
    async ({ user }) => {
      const id = assertSafeId((await params).id);
      await deleteOrgSpace(user, id);
      return NextResponse.json({ success: true });
    },
    { action: 'org-spaces:manage' }
  );
}
