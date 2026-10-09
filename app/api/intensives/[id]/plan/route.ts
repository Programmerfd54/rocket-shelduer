import { NextResponse } from 'next/server';
import { withIntensives, type RouteParams } from '@/lib/intensives/route-context';
import { assertSafeId } from '@/lib/intensives/http';
import { loadIntensiveForViewer, resolveViewScope } from '@/lib/intensives/access';
import { buildPlanView, toIntensiveSummary } from '@/lib/intensives/progress';

/**
 * GET /api/intensives/[id]/plan — пункты плана с вычисленным состоянием, отправками (без чужого текста),
 * рекомендуемыми датой/временем в поясе интенсива, «требует настройки», прогрессом и флагом partial.
 * ?scope=SUP|ADM|ALL — только Lead_SUP: набор пунктов (область + общие) и прогресс ровно по нему;
 * остальным набор задаёт роль, параметр игнорируется.
 */
export async function GET(request: Request, { params }: RouteParams<{ id: string }>) {
  return withIntensives('get plan', async ({ viewer }) => {
    const id = assertSafeId((await params).id);
    const viewScope = resolveViewScope(viewer, new URL(request.url).searchParams.get('scope'));
    const intensive = await loadIntensiveForViewer(viewer, id);
    const plan = await buildPlanView(viewer, intensive, new Date(), viewScope);
    return NextResponse.json({
      intensive: toIntensiveSummary(intensive, { progress: plan.progress, partial: plan.partial, viewScope }),
      ...plan,
    });
  });
}
