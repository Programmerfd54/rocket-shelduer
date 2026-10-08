import { NextResponse } from 'next/server';
import { withIntensives } from '@/lib/intensives/route-context';
import { parseOrThrow, readJsonBody } from '@/lib/intensives/http';
import { createOrgSpaceSchema } from '@/lib/intensives/schemas';
import { createOrgSpace, listOrgSpaces } from '@/lib/intensives/org-spaces';

/**
 * GET /api/org-spaces — Lead_SUP: все OrgSpace с привязанными подключениями (без секретов);
 * остальные — только OrgSpace, к которым у них есть доступ через свои/назначенные подключения.
 */
export async function GET() {
  return withIntensives('list org spaces', async ({ viewer }) => {
    return NextResponse.json({ orgSpaces: await listOrgSpaces(viewer) });
  });
}

/** POST /api/org-spaces — создать OrgSpace (Lead_SUP). Body: { name, description? }. */
export async function POST(request: Request) {
  return withIntensives(
    'create org space',
    async ({ user }) => {
      const input = parseOrThrow(createOrgSpaceSchema, await readJsonBody(request));
      const orgSpace = await createOrgSpace(user, input);
      return NextResponse.json({ orgSpace }, { status: 201 });
    },
    { action: 'org-spaces:manage' }
  );
}
