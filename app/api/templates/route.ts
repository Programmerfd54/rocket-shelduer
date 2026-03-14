import { NextResponse } from 'next/server';
import { requireSupportAdmOrAdmin, isForbiddenError } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { ADM_TEMPLATES, SUP_TEMPLATES } from '@/lib/templates-data';

function mergeOverrides<T extends { id: string; body: string; title?: string; channel?: string; time?: string }>(
  list: T[],
  overrides: { templateId: string; scope: string; body: string; title: string | null; channel: string | null; time: string | null }[],
  scope: string
): T[] {
  const byId = Object.fromEntries(overrides.filter((o) => o.scope === scope).map((o) => [o.templateId, o]));
  return list.map((t) => {
    const ov = byId[t.id];
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
 * Шаблоны анонсов для двухнедельного интенсива. Доступно ADM, SUP, ADMIN.
 * ADMIN получает шаблоны с учётом переопределений (редактирование официальных).
 */
export async function GET() {
  try {
    const user = await requireSupportAdmOrAdmin();
    let supTemplates = SUP_TEMPLATES;
    let admTemplates = ADM_TEMPLATES;
    try {
      const overrides = await prisma.officialTemplateOverride.findMany({
        select: { templateId: true, scope: true, body: true, title: true, channel: true, time: true },
      });
      supTemplates = mergeOverrides(SUP_TEMPLATES, overrides, 'SUPPORT');
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
    if (isForbiddenError(e)) return NextResponse.json({ error: 'Templates are available only for ADM, SUPPORT and ADMIN' }, { status: 403 });
    console.error('Templates API error:', e);
    return NextResponse.json({ error: 'Failed to load templates' }, { status: 500 });
  }
}
