import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import prisma from '@/lib/prisma';

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/templates/mine/[id]/versions — список версий шаблона (ADM/SUP).
 */
export async function GET(_request: Request, { params }: Params) {
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
    const versions = await prisma.userTemplateVersion.findMany({
      where: { userTemplateId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return NextResponse.json({
      versions: versions.map((v) => ({
        id: v.id,
        body: v.body,
        title: v.title,
        channel: v.channel,
        time: v.time,
        intensiveDay: v.intensiveDay,
        createdAt: v.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Templates mine versions GET error:', error);
    return NextResponse.json(
      { error: 'Failed to load versions' },
      { status: 500 }
    );
  }
}
