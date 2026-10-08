import { NextResponse } from 'next/server';
import { isForbiddenError } from '@/lib/auth';
import { requireSupportAdmOrAdmin } from '@/lib/api-auth';
import prisma from '@/lib/prisma';
import { ADM_TEMPLATES, SUP_TEMPLATES } from '@/lib/templates-data';
import { GLOBAL_SCOPE } from '@/lib/legacy-scope';

type OvRow = {
  templateId: string;
  scope: string;
  body: string;
  title: string | null;
  channel: string | null;
  time: string | null;
};

/** overrides отсортированы по updatedAt desc — для каждого шаблона берётся самое свежее переопределение. */
function mergeOverrides<T extends { id: string; body: string; title?: string; channel?: string; time?: string }>(
  list: T[],
  overrides: OvRow[],
  scope: string,
): T[] {
  const byId = new Map<string, OvRow>();
  for (const o of overrides) {
    if (o.scope !== scope) continue;
    if (!byId.has(o.templateId)) byId.set(o.templateId, o);
  }
  return list.map((t) => {
    const ov = byId.get(t.id);
    if (!ov) return t;
    return {
      ...t,
      body: ov.body,
      title: ov.title ?? t.title,
      ...(ov.channel != null && { channel: ov.channel }),
      ...(ov.time != null && { time: ov.time }),
    } as T;
  });
}

/**
 * GET /api/templates
 * Шаблоны анонсов для двухнедельного интенсива. Доступно ADM, SUP, Lead_SUP.
 * Применяются глобальные переопределения официальных шаблонов (редактирует Lead_SUP).
 */
export async function GET() {
  try {
    const user = await requireSupportAdmOrAdmin();
    let supTemplates = SUP_TEMPLATES;
    let admTemplates = ADM_TEMPLATES;
    try {
      const overrides = await prisma.officialTemplateOverride.findMany({
        where: { ...GLOBAL_SCOPE },
        orderBy: { updatedAt: 'desc' },
        select: { templateId: true, scope: true, body: true, title: true, channel: true, time: true },
      });
      supTemplates = mergeOverrides(SUP_TEMPLATES, overrides, 'SUP');
      admTemplates = mergeOverrides(ADM_TEMPLATES, overrides, 'ADM');
    } catch (_) {}

    if (user.role === 'ADM') {
      return NextResponse.json({
        templates: admTemplates,
        admTemplates: admTemplates,
        role: 'ADM',
      });
    }
    return NextResponse.json({
      templates: supTemplates,
      admTemplates: admTemplates,
      role: user.role,
    });
  } catch (e) {
    if (isForbiddenError(e))
      return NextResponse.json({ error: 'Шаблоны доступны только для ADM, SUP и Lead_SUP' }, { status: 403 });
    console.error('Templates API error:', e);
    return NextResponse.json({ error: 'Failed to load templates' }, { status: 500 });
  }
}
