import { NextResponse } from 'next/server';
import { withIntensives } from '@/lib/intensives/route-context';
import { ApiError, parseOrThrow, readJsonBody } from '@/lib/intensives/http';
import { createIntensiveSchema } from '@/lib/intensives/schemas';
import { createIntensive, listIntensives, parseListFilters } from '@/lib/intensives/service';
import { computeProgressForIntensives, toIntensiveSummary } from '@/lib/intensives/progress';
import { ensureOrgSpaceForWorkspace } from '@/lib/intensives/workspace-schedule';
import { resolveViewScope } from '@/lib/intensives/access';

/**
 * GET /api/intensives?year=&orgSpaceId=&workspaceId=&phase=&status=&progress=&scope=
 * Список интенсивов, доступных вызывающему (черновики — только Lead_SUP), с прогрессом (считает сервер).
 * scope=SUP|ADM|ALL — только Lead_SUP (прогресс по набору пунктов); остальным — по роли.
 */
export async function GET(request: Request) {
  return withIntensives('list intensives', async ({ viewer }) => {
    const sp = new URL(request.url).searchParams;
    const filters = { ...parseListFilters(sp), viewScope: resolveViewScope(viewer, sp.get('scope')) };
    const { intensives, resolvedOrgSpaceId } = await listIntensives(viewer, filters);
    return NextResponse.json({ intensives, orgSpaceId: resolvedOrgSpaceId });
  });
}

/**
 * POST /api/intensives — создать черновик (Lead_SUP). Отправки не запускаются.
 * Тело: { workspaceId | orgSpaceId, name, startDate, endDate, timezone, description?, templateIds? }.
 * С workspaceId организационное пространство подбирается (или создаётся) автоматически; пространство
 * должно быть доступно вызывающему (своё или назначенное).
 */
export async function POST(request: Request) {
  return withIntensives(
    'create intensive',
    async ({ user, viewer }) => {
      const { workspaceId, orgSpaceId: rawOrgSpaceId, ...rest } = parseOrThrow(createIntensiveSchema, await readJsonBody(request));
      let orgSpaceId = rawOrgSpaceId;
      if (workspaceId) {
        if (!viewer.accessibleWorkspaceIds.has(workspaceId)) {
          throw new ApiError(404, 'NOT_FOUND', 'Пространство не найдено', { fieldErrors: { workspaceId: 'Не найдено или нет доступа' } });
        }
        orgSpaceId = (await ensureOrgSpaceForWorkspace(workspaceId, user.id)).orgSpaceId;
      }
      if (!orgSpaceId) throw new ApiError(400, 'VALIDATION_ERROR', 'Выберите пространство', { fieldErrors: { workspaceId: 'Выберите пространство' } });
      const { intensive, overlaps, plan } = await createIntensive(user, { ...rest, orgSpaceId });
      const progress = await computeProgressForIntensives(viewer, [intensive.id]);
      const p = progress.get(intensive.id);
      return NextResponse.json(
        {
          intensive: toIntensiveSummary(intensive, { progress: p?.progress ?? null, partial: p?.partial ?? false, overlaps }),
          warnings: { overlaps },
          plan,
        },
        { status: 201 }
      );
    },
    { action: 'intensives:manage' }
  );
}
