import { NextRequest, NextResponse } from 'next/server';
import { isValidOfficialTemplateId } from '@/lib/security';
import { requireAuth } from '@/lib/api-auth';
import { requireAction } from '@/lib/permissions';
import { parseScopeParam, restoreBuiltinTemplate } from '@/lib/templates/official-service';
import { TemplatesApiError, handleTemplatesRouteError, readJson } from '@/lib/templates/http';

/**
 * POST /api/templates/official/[templateId]/restore?scope= (Lead_SUP) — вернуть удалённый встроенный шаблон
 * (вместе с его прежними изменениями). scope можно передать и в теле. → { ok: true, template }.
 * 409 TEMPLATE_NOT_DELETED — шаблон не удалён.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const user = await requireAuth();
    requireAction(user, 'templates:official:manage');
    const { templateId } = await params;
    if (!isValidOfficialTemplateId(templateId)) throw new TemplatesApiError(400, 'BAD_REQUEST', 'Некорректный id шаблона');
    const body = await readJson(request);
    const scope = parseScopeParam(request.nextUrl.searchParams.get('scope') ?? body.scope);
    const template = await restoreBuiltinTemplate(user.id, templateId.trim(), scope);
    return NextResponse.json({ ok: true, template });
  } catch (e) {
    return handleTemplatesRouteError(e, 'restore official template');
  }
}
