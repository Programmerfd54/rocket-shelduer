import { NextRequest, NextResponse } from 'next/server';
import { isValidOfficialTemplateId } from '@/lib/security';
import { requireAuth } from '@/lib/api-auth';
import { canPerformAction, requireAction } from '@/lib/permissions';
import { builtinDefaults, customRowId, findBuiltinTemplate, getEffectiveOfficialTemplate, templateScopesForRole } from '@/lib/templates/official-templates';
import {
  deleteOfficialTemplate,
  parseScopeParam,
  resolveBuiltinScope,
  updateOfficialTemplate,
} from '@/lib/templates/official-service';
import { TemplatesApiError, handleTemplatesRouteError, parseOrThrow, readJson } from '@/lib/templates/http';
import { updateOfficialTemplateSchema } from '@/lib/templates/schemas';

type Params = { params: Promise<{ templateId: string }> };

async function templateIdOf(params: Params['params']): Promise<string> {
  const { templateId } = await params;
  if (!isValidOfficialTemplateId(templateId)) {
    throw new TemplatesApiError(400, 'BAD_REQUEST', 'Некорректный id шаблона');
  }
  return templateId.trim();
}

/**
 * GET /api/templates/official/[templateId]?scope= — один эффективный шаблон.
 * Удалённый встроенный виден только Lead_SUP. Наборы — по роли (ADM — только ADM).
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    requireAction(user, 'templates:official');
    const id = await templateIdOf(params);
    const scopeParam = parseScopeParam(request.nextUrl.searchParams.get('scope'));
    const scope = customRowId(id) ? scopeParam : resolveBuiltinScope(id, scopeParam);
    const t = await getEffectiveOfficialTemplate(id, scope);
    const canManage = canPerformAction(user, 'templates:official:manage');
    if (!t || !templateScopesForRole(user.role).includes(t.scope) || (t.isDeleted && !canManage)) {
      throw new TemplatesApiError(404, 'TEMPLATE_NOT_FOUND', 'Шаблон не найден');
    }
    const st = canManage && t.source === 'builtin' ? findBuiltinTemplate(t.id, t.scope) : null;
    return NextResponse.json({ template: st ? { ...t, defaults: builtinDefaults(st) } : t });
  } catch (e) {
    return handleTemplatesRouteError(e, 'get official template');
  }
}

/**
 * PATCH /api/templates/official/[templateId] (Lead_SUP)
 * Body: { scope?, title?, body?, channel?, intensiveDay?, time?, audience?, dayLabel?, timeNote?, position?, createChannelIfMissing? }
 * Встроенный: scope выбирает набор (можно ?scope=); null у поля — значение по умолчанию; отсутствует — без изменений.
 * Созданный ('c_…'): scope — перенос в другой набор. → { ok: true, template, createdChannel }.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    requireAction(user, 'templates:official:manage');
    const id = await templateIdOf(params);
    const input = parseOrThrow(updateOfficialTemplateSchema, await readJson(request));
    const scopeParam = parseScopeParam(request.nextUrl.searchParams.get('scope'));
    const result = await updateOfficialTemplate(user.id, id, scopeParam, input);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return handleTemplatesRouteError(e, 'update official template');
  }
}

/**
 * DELETE /api/templates/official/[templateId]?scope= (Lead_SUP)
 * Встроенный → скрыт для набора (обратимо: POST …/restore); созданный → удаляется безвозвратно.
 * Сброс изменений встроенного к умолчанию — POST …/reset (раньше это делал DELETE).
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    requireAction(user, 'templates:official:manage');
    const id = await templateIdOf(params);
    const scopeParam = parseScopeParam(request.nextUrl.searchParams.get('scope'));
    const result = await deleteOfficialTemplate(user.id, id, scopeParam);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return handleTemplatesRouteError(e, 'delete official template');
  }
}
