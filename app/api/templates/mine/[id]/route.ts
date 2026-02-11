import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { isUnsafeId } from '@/lib/security';

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/templates/mine/[id] — обновить свой шаблон (ADM/SUP).
 */
export async function PATCH(request: Request, { params }: Params) {
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
    if (isUnsafeId(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    const existing = await prisma.userTemplate.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    const body = await request.json();
    const updates: {
      channel?: string;
      intensiveDay?: number | null;
      time?: string;
      title?: string | null;
      body?: string;
      tags?: string[];
    } = {};
    if (typeof body.channel === 'string') updates.channel = body.channel.trim();
    if (body.intensiveDay !== undefined)
      updates.intensiveDay =
        body.intensiveDay == null || body.intensiveDay === ''
          ? null
          : Number(body.intensiveDay);
    if (typeof body.time === 'string') updates.time = body.time.trim();
    if (typeof body.title === 'string') updates.title = body.title.trim() || null;
    if (typeof body.body === 'string') updates.body = body.body.trim();
    if (Array.isArray(body.tags))
      updates.tags = body.tags
        .filter((x: unknown) => typeof x === 'string')
        .map((x: string) => x.trim())
        .filter(Boolean);

    // Версионирование: перед обновлением сохраняем текущее состояние в историю
    if (Object.keys(updates).length > 0) {
      await prisma.userTemplateVersion.create({
        data: {
          userTemplateId: existing.id,
          body: existing.body,
          title: existing.title,
          channel: existing.channel,
          time: existing.time,
          intensiveDay: existing.intensiveDay,
        },
      });
    }

    const updated = await prisma.userTemplate.update({
      where: { id },
      data: updates,
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
    console.error('Templates mine PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to update template' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/templates/mine/[id] — удалить свой шаблон (ADM/SUP).
 */
export async function DELETE(_request: Request, { params }: Params) {
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
    const existing = await prisma.userTemplate.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    await prisma.userTemplate.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Templates mine DELETE error:', error);
    return NextResponse.json(
      { error: 'Failed to delete template' },
      { status: 500 }
    );
  }
}
