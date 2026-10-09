import { NextRequest, NextResponse } from 'next/server';
import { isValidOfficialTemplateId } from '@/lib/security';
import { requireAuth } from '@/lib/api-auth';
import { requireAction } from '@/lib/permissions';
import { parseScopeParam, resetBuiltinTemplate } from '@/lib/templates/official-service';
import { TemplatesApiError, handleTemplatesRouteError, readJson } from '@/lib/templates/http';

/**
 * POST /api/templates/official/[templateId]/reset?scope= (Lead_SUP) — сбросить все изменения встроенного
 * шаблона к значениям из lib/templates-data. Удалённый шаблон остаётся удалённым. → { ok: true, template }.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const user = await requireAuth();
    requireAction(user, 'templates:official:manage');
    const { templateId } = await params;
    if (!isValidOfficialTemplateId(templateId)) throw new TemplatesApiError(400, 'BAD_REQUEST', 'Некорректный id шаблона');
    const body = await readJson(request);
    const scope = parseScopeParam(request.nextUrl.searchParams.get('scope') ?? body.scope);
    const template = await resetBuiltinTemplate(user.id, templateId.trim(), scope);
    return NextResponse.json({ ok: true, template });
  } catch (e) {
    return handleTemplatesRouteError(e, 'reset official template');
  }
}
