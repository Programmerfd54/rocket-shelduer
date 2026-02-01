import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import prisma from '@/lib/prisma';

/**
 * GET /api/templates/mine — список своих шаблонов (ADM/SUP, не VOL).
 */
export async function GET() {
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
    const list = await prisma.userTemplate.findMany({
      where: { userId: user.id },
      orderBy: [{ intensiveDay: 'asc' }, { time: 'asc' }, { createdAt: 'asc' }],
    });
    return NextResponse.json({
      templates: list.map((t) => ({
        id: t.id,
        channel: t.channel,
        intensiveDay: t.intensiveDay,
        time: t.time,
        title: t.title,
        body: t.body,
        tags: t.tags ?? [],
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Templates mine GET error:', error);
    return NextResponse.json(
      { error: 'Failed to load templates' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/templates/mine — создать свой шаблон (ADM/SUP).
 * Body: { channel, intensiveDay?, time, title?, body, tags? }
 */
export async function POST(request: Request) {
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
    const body = await request.json();
    const channel = typeof body.channel === 'string' ? body.channel.trim() : '';
    const time = typeof body.time === 'string' ? body.time.trim() : '';
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (!channel || !time || !text) {
      return NextResponse.json(
        { error: 'channel, time and body are required' },
        { status: 400 }
      );
    }
    const intensiveDay =
      body.intensiveDay != null && Number.isInteger(Number(body.intensiveDay))
        ? Number(body.intensiveDay)
        : null;
    const title = typeof body.title === 'string' ? body.title.trim() || null : null;
    const tags = Array.isArray(body.tags)
      ? body.tags.filter((x: unknown) => typeof x === 'string').map((x: string) => x.trim()).filter(Boolean)
      : [];

    const created = await prisma.userTemplate.create({
      data: {
        userId: user.id,
        channel,
        intensiveDay,
        time,
        title,
        body: text,
        tags,
      },
    });
    return NextResponse.json({
      template: {
        id: created.id,
        channel: created.channel,
        intensiveDay: created.intensiveDay,
        time: created.time,
        title: created.title,
        body: created.body,
        tags: created.tags,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Templates mine POST error:', error);
    return NextResponse.json(
      { error: 'Failed to create template' },
      { status: 500 }
    );
  }
}
