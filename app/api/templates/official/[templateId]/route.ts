import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { ADM_TEMPLATES, SUP_TEMPLATES } from '@/lib/templates-data';

const ADM_IDS = new Set(ADM_TEMPLATES.map((t) => t.id));
const SUP_IDS = new Set(SUP_TEMPLATES.map((t) => t.id));

function isValidTemplate(templateId: string, scope: string): boolean {
  if (scope === 'ADM') return ADM_IDS.has(templateId);
  if (scope === 'SUPPORT') return SUP_IDS.has(templateId);
  return false;
}

/**
 * PATCH /api/templates/official/[templateId]
 * ADMIN: сохранить переопределение официального шаблона (body, title) для scope SUP или ADM.
 * Body: { scope: 'SUPPORT' | 'ADM', body: string, title?: string }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    if (user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only superuser can edit official templates' },
        { status: 403 }
      );
    }
    const { templateId } = await params;
    const body = await request.json();
    const scope = body?.scope;
    if (scope !== 'SUPPORT' && scope !== 'ADM') {
      return NextResponse.json(
        { error: 'scope must be SUP or ADM' },
        { status: 400 }
      );
    }
    if (!isValidTemplate(templateId, scope)) {
      return NextResponse.json(
        { error: 'Unknown template id for this scope' },
        { status: 400 }
      );
    }
    const textBody = typeof body.body === 'string' ? body.body : '';
    const title = typeof body.title === 'string' ? body.title : null;

    await prisma.officialTemplateOverride.upsert({
      where: {
        templateId_scope: { templateId, scope },
      },
      create: {
        templateId,
        scope,
        body: textBody,
        title,
        updatedById: user.id,
      },
      update: {
        body: textBody,
        title,
        updatedById: user.id,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('PATCH official template override error:', error);
    return NextResponse.json(
      { error: 'Failed to save override' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/templates/official/[templateId]?scope=SUP|ADM
 * ADMIN: сбросить переопределение (вернуть шаблон к значению по умолчанию).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    if (user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only superuser can reset official templates' },
        { status: 403 }
      );
    }
    const { templateId } = await params;
    const scope = request.nextUrl.searchParams.get('scope');
    if (scope !== 'SUPPORT' && scope !== 'ADM') {
      return NextResponse.json(
        { error: 'scope query must be SUP or ADM' },
        { status: 400 }
      );
    }
    if (!isValidTemplate(templateId, scope)) {
      return NextResponse.json(
        { error: 'Unknown template id for this scope' },
        { status: 400 }
      );
    }
    await prisma.officialTemplateOverride.deleteMany({
      where: { templateId, scope },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('DELETE official template override error:', error);
    return NextResponse.json(
      { error: 'Failed to reset override' },
      { status: 500 }
    );
  }
}
