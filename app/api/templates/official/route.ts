import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { canPerformAction, requireAction } from '@/lib/permissions';
import {
  builtinDefaults,
  filterTemplatesForRole,
  findBuiltinTemplate,
  getEffectiveOfficialTemplates,
} from '@/lib/templates/official-templates';
import { createCustomTemplate, parseScopeParam } from '@/lib/templates/official-service';
import { handleTemplatesRouteError, parseOrThrow, readJson } from '@/lib/templates/http';
import { createOfficialTemplateSchema } from '@/lib/templates/schemas';
import type { OfficialTemplateDto } from '@/lib/templates/types';

/**
 * GET /api/templates/official?scope=SUP|ADM&includeDeleted=1
 * Эффективные официальные шаблоны в едином формате (docs/templates-api.md).
 * ADM — только набор ADM; SUP и Lead_SUP — оба. includeDeleted=1 учитывается только для Lead_SUP
 * (удалённые встроенные — для восстановления); Lead_SUP также получает defaults у встроенных.
 */
export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    requireAction(user, 'templates:official');
    const sp = new URL(request.url).searchParams;
    const scope = parseScopeParam(sp.get('scope'));
    const canManage = canPerformAction(user, 'templates:official:manage');
    const includeDeleted = canManage && (sp.get('includeDeleted') === '1' || sp.get('includeDeleted') === 'true');
    const list = filterTemplatesForRole(await getEffectiveOfficialTemplates({ scope: scope ?? undefined, includeDeleted }), user.role);
    const templates: OfficialTemplateDto[] = list.map((t) => {
      if (!canManage || t.source !== 'builtin') return t;
      const st = findBuiltinTemplate(t.id, t.scope);
      return st ? { ...t, defaults: builtinDefaults(st) } : t;
    });
    return NextResponse.json({ templates, role: user.role, canManage });
  } catch (e) {
    return handleTemplatesRouteError(e, 'list official templates');
  }
}

/**
 * POST /api/templates/official — создать официальный шаблон (Lead_SUP).
 * Body: { scope, title, body, channel, intensiveDay, time, audience?, dayLabel?, timeNote?, position?, createChannelIfMissing? }
 * → 201 { template, createdChannel }.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    requireAction(user, 'templates:official:manage');
    const input = parseOrThrow(createOfficialTemplateSchema, await readJson(request));
    const result = await createCustomTemplate(user.id, input);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return handleTemplatesRouteError(e, 'create official template');
  }
}
