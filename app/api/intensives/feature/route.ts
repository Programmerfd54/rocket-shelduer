import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { handleRouteError } from '@/lib/intensives/http';
import { isIntensivesEnabled } from '@/lib/intensives/feature';
import { canPerformAction } from '@/lib/permissions';

/**
 * GET /api/intensives/feature — включена ли функция «Интенсивы» (SystemSetting feature:intensives)
 * и может ли вызывающий управлять интенсивами. Единственный роут раздела, который не отвечает 404 при выключенном флаге.
 */
export async function GET() {
  try {
    const user = await requireAuth();
    const enabled = await isIntensivesEnabled();
    return NextResponse.json({
      enabled,
      canManage: enabled && canPerformAction(user, 'intensives:manage'),
      canManageOrgSpaces: enabled && canPerformAction(user, 'org-spaces:manage'),
    });
  } catch (e) {
    return handleRouteError(e, 'intensives feature flag');
  }
}
