import { NextRequest, NextResponse } from 'next/server';
import { isUnsafeId } from '@/lib/security';
import { isForbiddenError } from '@/lib/auth';
import { requireAuth } from '@/lib/api-auth';
import prisma from '@/lib/prisma';
import { ADM_TEMPLATES, SUP_TEMPLATES } from '@/lib/templates-data';
import { requireAction } from '@/lib/permissions';
import { GLOBAL_SCOPE } from '@/lib/legacy-scope';

const ADM_IDS = new Set(ADM_TEMPLATES.map((t) => t.id));
const SUP_IDS = new Set(SUP_TEMPLATES.map((t) => t.id));

function isValidTemplate(templateId: string, scope: string): boolean {
  if (scope === 'ADM') return ADM_IDS.has(templateId);
  if (scope === 'SUP') return SUP_IDS.has(templateId);
  return false;
}

function authErrorResponse(e: unknown, forbiddenMessage: string): NextResponse | null {
  if (isForbiddenError(e)) return NextResponse.json({ error: forbiddenMessage }, { status: 403 });
  if (e instanceof Error && e.message === 'Unauthorized') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

/**
 * PATCH /api/templates/official/[templateId]
 * Body: { scope: 'SUP' | 'ADM', body, title?, channel?, time? }
 * Глобальное переопределение официального шаблона (только Lead_SUP).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> },
) {
  try {
    const user = await requireAuth();
    requireAction(user, 'admin:templates:edit');
    const { templateId } = await params;
    if (isUnsafeId(templateId)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    const body = await request.json();
    const scope = body?.scope;
    if (scope !== 'SUP' && scope !== 'ADM') {
      return NextResponse.json({ error: 'scope должен быть SUP или ADM' }, { status: 400 });
    }
    if (!isValidTemplate(templateId, scope)) {
      return NextResponse.json({ error: 'Unknown template id for this scope' }, { status: 400 });
    }

    const textBody = typeof body.body === 'string' ? body.body : '';
    const title = typeof body.title === 'string' ? body.title : null;
    const channel = typeof body.channel === 'string' && body.channel.trim() ? body.channel.trim() : null;
    const time = typeof body.time === 'string' && body.time.trim() ? body.time.trim() : null;
    const data = { body: textBody, title, channel, time, updatedById: user.id };

    // Составной unique с NULL не поддерживает upsert — ищем глобальную строку и обновляем/создаём.
    const existing = await prisma.officialTemplateOverride.findFirst({
      where: { templateId, scope, ...GLOBAL_SCOPE },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (existing) {
      await prisma.officialTemplateOverride.update({ where: { id: existing.id }, data });
    } else {
      await prisma.officialTemplateOverride.create({ data: { templateId, scope, ...data } });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const authRes = authErrorResponse(e, 'Only superuser can edit official templates');
    if (authRes) return authRes;
    console.error('PATCH official template override error:', e);
    return NextResponse.json({ error: 'Failed to save override' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> },
) {
  try {
    const user = await requireAuth();
    requireAction(user, 'admin:templates:edit');
    const { templateId } = await params;
    if (isUnsafeId(templateId)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    const scope = request.nextUrl.searchParams.get('scope');
    if (scope !== 'SUP' && scope !== 'ADM') {
      return NextResponse.json({ error: 'параметр scope должен быть SUP или ADM' }, { status: 400 });
    }
    if (!isValidTemplate(templateId, scope)) {
      return NextResponse.json({ error: 'Unknown template id for this scope' }, { status: 400 });
    }

    await prisma.officialTemplateOverride.deleteMany({
      where: { templateId, scope, ...GLOBAL_SCOPE },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const authRes = authErrorResponse(e, 'Only superuser can reset official templates');
    if (authRes) return authRes;
    console.error('DELETE official template override error:', e);
    return NextResponse.json({ error: 'Failed to reset override' }, { status: 500 });
  }
}
