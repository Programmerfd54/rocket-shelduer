import { NextResponse } from 'next/server';
import { withIntensives } from '@/lib/intensives/route-context';
import { ApiError, assertSafeId } from '@/lib/intensives/http';
import { loadIntensiveForViewer } from '@/lib/intensives/access';
import { loadOfficialTemplates, officialTemplatesForRole, toTemplateOption } from '@/lib/intensives/plan';
import prisma from '@/lib/prisma';

/**
 * GET /api/intensives/templates?intensiveId=
 * Официальные шаблоны (с глобальными переопределениями) для выбора состава плана (Lead_SUP).
 * С intensiveId — флаг inPlan для шаблонов, уже включённых в план.
 */
export async function GET(request: Request) {
  return withIntensives(
    'list plan templates',
    async ({ user, viewer }) => {
      const intensiveIdRaw = new URL(request.url).searchParams.get('intensiveId');
      let inPlan: Set<string> | null = null;
      if (intensiveIdRaw != null) {
        const intensiveId = assertSafeId(intensiveIdRaw, 'intensiveId');
        await loadIntensiveForViewer(viewer, intensiveId);
        const rows = await prisma.intensivePlanItem.findMany({
          where: { intensiveId, sourceType: 'OFFICIAL' },
          select: { sourceTemplateId: true },
        });
        inPlan = new Set(rows.map((r) => r.sourceTemplateId).filter((v): v is string => !!v));
      }
      const list = officialTemplatesForRole(await loadOfficialTemplates(), user.role);
      if (list.length === 0) throw new ApiError(403, 'FORBIDDEN', 'Недостаточно прав');
      return NextResponse.json({
        templates: list.map((t) => toTemplateOption(t, inPlan ? inPlan.has(t.id) : undefined)),
      });
    },
    { action: 'intensives:manage' }
  );
}
