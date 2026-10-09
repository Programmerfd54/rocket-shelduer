import { NextResponse } from 'next/server';
import { isForbiddenError } from '@/lib/auth';
import { requireSupportAdmOrAdmin } from '@/lib/api-auth';
import { getEffectiveOfficialTemplates, toLegacyTemplate } from '@/lib/templates/official-templates';

/**
 * GET /api/templates
 * Официальные шаблоны анонсов (эффективные: встроенные + переопределения + созданные Lead_SUP, без удалённых).
 * Доступно ADM, SUP, Lead_SUP. Формат прежний: { templates, admTemplates, role }; у элементов — аддитивные поля
 * scope, source, isModified, isDeleted, version (docs/templates-api.md).
 */
export async function GET() {
  try {
    const user = await requireSupportAdmOrAdmin();
    const all = await getEffectiveOfficialTemplates();
    const admTemplates = all.filter((t) => t.scope === 'ADM').map(toLegacyTemplate);
    const supTemplates = all.filter((t) => t.scope === 'SUP').map(toLegacyTemplate);

    if (user.role === 'ADM') {
      return NextResponse.json({
        templates: admTemplates,
        admTemplates: admTemplates,
        role: 'ADM',
      });
    }
    // SUP видит только свой набор (шаблоны ADM — только Lead_SUP); формат ответа прежний
    return NextResponse.json({
      templates: supTemplates,
      admTemplates: user.role === 'LEAD_SUP' ? admTemplates : [],
      role: user.role,
    });
  } catch (e) {
    if (isForbiddenError(e))
      return NextResponse.json({ error: 'Шаблоны доступны только для ADM, SUP и Lead_SUP' }, { status: 403 });
    if (e instanceof Error && e.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('Templates API error:', e);
    return NextResponse.json({ error: 'Failed to load templates' }, { status: 500 });
  }
}
