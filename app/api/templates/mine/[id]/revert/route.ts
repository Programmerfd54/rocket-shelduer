import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import prisma from '@/lib/prisma';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/templates/mine/[id]/revert — откатить шаблон к версии (ADM/SUP).
 * Body: { versionId: string }
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    if (user.role === 'VOL' || user.role === 'USER') {
      return NextResponse.json(
        { error: 'My templates are available only for ADM and SUPPORT' },
        { status: 403 }
      );
    }
    const { id } = await params;
    const template = await prisma.userTemplate.findFirst({
      where: { id, userId: user.id },
    });
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    const body = await request.json();
    const versionId = typeof body.versionId === 'string' ? body.versionId.trim() : '';
    if (!versionId) {
      return NextResponse.json(
        { error: 'versionId is required' },
        { status: 400 }
      );
    }
    const version = await prisma.userTemplateVersion.findFirst({
      where: { id: versionId, userTemplateId: id },
    });
    if (!version) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 });
    }
    // Сохраняем текущее состояние в историю перед откатом
    await prisma.userTemplateVersion.create({
      data: {
        userTemplateId: template.id,
        body: template.body,
        title: template.title,
        channel: template.channel,
        time: template.time,
        intensiveDay: template.intensiveDay,
      },
    });
    const updated = await prisma.userTemplate.update({
      where: { id },
      data: {
        body: version.body,
        title: version.title,
        channel: version.channel,
        time: version.time,
        intensiveDay: version.intensiveDay,
      },
    });
    return NextResponse.json({
      template: {
        id: updated.id,
        channel: updated.channel,
        intensiveDay: updated.intensiveDay,
        time: updated.time,
        title: updated.title,
        body: updated.body,
        tags: updated.tags,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Templates mine revert POST error:', error);
    return NextResponse.json(
      { error: 'Failed to revert template' },
      { status: 500 }
    );
  }
}
