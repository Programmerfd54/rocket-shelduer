import { NextResponse } from 'next/server';
import { isUnsafeId } from '@/lib/security';
import { getCurrentUser } from '@/lib/api-auth';
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
    const { id } = await params;
    if (isUnsafeId(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
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
