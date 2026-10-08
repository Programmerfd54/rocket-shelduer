import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withIntensives, type RouteParams } from '@/lib/intensives/route-context';
import { assertSafeId, parseOrThrow, readJsonBody } from '@/lib/intensives/http';
import { loadIntensiveForViewer } from '@/lib/intensives/access';
import { generatePlanSchema } from '@/lib/intensives/schemas';
import { generatePlanFromOfficial } from '@/lib/intensives/plan';
import { assertPlanEditable } from '@/lib/intensives/plan-service';

/**
 * POST /api/intensives/[id]/plan/generate — добавить в план выбранные официальные шаблоны (Lead_SUP).
 * Body: { templateIds: string[] }. Идемпотентно: уже включённые шаблоны пропускаются.
 */
export async function POST(request: Request, { params }: RouteParams<{ id: string }>) {
  return withIntensives(
    'generate plan',
    async ({ user, viewer }) => {
      const id = assertSafeId((await params).id);
      const { templateIds } = parseOrThrow(generatePlanSchema, await readJsonBody(request));
      const intensive = await loadIntensiveForViewer(viewer, id);
      assertPlanEditable(intensive);
      const result = await prisma.$transaction((tx) =>
        generatePlanFromOfficial(tx, { intensiveId: id, templateIds, actorId: user.id })
      );
      return NextResponse.json(result, { status: result.created.length > 0 ? 201 : 200 });
    },
    { action: 'intensives:manage' }
  );
}
