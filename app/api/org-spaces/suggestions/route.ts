import { NextResponse } from 'next/server';
import { withIntensives } from '@/lib/intensives/route-context';
import { getOrgSpaceSuggestions } from '@/lib/intensives/org-spaces';

/**
 * GET /api/org-spaces/suggestions — подключения, сгруппированные по одному инстансу RC (sameRcInstanceUrl).
 * Только подсказка для Lead_SUP: ничего не объединяет автоматически.
 */
export async function GET() {
  return withIntensives(
    'org space suggestions',
    async () => NextResponse.json({ groups: await getOrgSpaceSuggestions() }),
    { action: 'org-spaces:manage' }
  );
}
