import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

const ALLOWED_FEATURE_KEYS = ['sendAs', 'activityView', 'adminPanel'] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await requireAuth();
    if (currentUser.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only superuser can set user restrictions' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const body = await request.json();
    const list = Array.isArray(body.restrictedFeatures) ? body.restrictedFeatures : [];
    const restrictedFeatures = list.filter((k: string) =>
      ALLOWED_FEATURE_KEYS.includes(k as any)
    );

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
