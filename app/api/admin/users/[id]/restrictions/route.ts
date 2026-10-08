import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/api-auth';
import { isUnsafeId } from '@/lib/security';

const ALLOWED_FEATURE_KEYS = ['sendAs', 'activityView', 'adminPanel'] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await requireAuth();
    if (currentUser.role !== 'LEAD_SUP') {
      return NextResponse.json(
        { error: 'Only superuser can set user restrictions' },
        { status: 403 }
      );
    }

    const { id } = await params;
    if (isUnsafeId(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    const body = await request.json().catch(() => ({}));
    const list: unknown[] = Array.isArray(body?.restrictedFeatures) ? body.restrictedFeatures : [];
    const restrictedFeatures = [
      ...new Set(
        list.filter((k): k is string =>
          typeof k === 'string' && (ALLOWED_FEATURE_KEYS as readonly string[]).includes(k)
        )
      ),
    ];
    const exists = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const updated = await prisma.user.update({
      where: { id },
      data: { restrictedFeatures },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        restrictedFeatures: true,
      },
    });

    return NextResponse.json({ user: updated });
  } catch (error) {
    console.error('Update user restrictions error:', error);
    return NextResponse.json(
      { error: 'Failed to update restrictions' },
      { status: 500 }
    );
  }
}
