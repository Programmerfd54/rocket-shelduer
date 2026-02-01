import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { ADM_TEMPLATES, SUP_TEMPLATES } from '@/lib/templates-data';

function mergeOverrides<T extends { id: string; body: string; title?: string }>(
  list: T[],
  overrides: { templateId: string; scope: string; body: string; title: string | null }[],
  scope: string
): T[] {
  const byId = Object.fromEntries(overrides.filter((o) => o.scope === scope).map((o) => [o.templateId, o]));
  return list.map((t) => {
    const ov = byId[t.id];
    if (!ov) return t;
    return { ...t, body: ov.body, title: ov.title ?? t.title } as T;
  });
}

/**
 * GET /api/templates
 * Шаблоны анонсов для двухнедельного интенсива. Доступно ADM, SUP, ADMIN.
 * ADMIN получает шаблоны с учётом переопределений (редактирование официальных).
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    if (user.role !== 'ADM' && user.role !== 'SUPPORT' && user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Templates are available only for ADM, SUPPORT and ADMIN' },
        { status: 403 }
      );
    }
    let supTemplates = SUP_TEMPLATES;
    let admTemplates = ADM_TEMPLATES;
    try {
      const overrides = await prisma.officialTemplateOverride.findMany({
        select: { templateId: true, scope: true, body: true, title: true },
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
  } catch (error) {
    console.error('Templates API error:', error);
    return NextResponse.json(
      { error: 'Failed to load templates' },
      { status: 500 }
    );
  }
}
