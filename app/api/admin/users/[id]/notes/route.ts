import { NextResponse } from 'next/server';
import { isUnsafeId } from '@/lib/security';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/api-auth';
import { canPerformAction } from '@/lib/permissions';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await requireAuth();
    const { id } = await params;
    if (isUnsafeId(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

    if (!canPerformAction(currentUser, 'admin:users:notes')) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: { role: true },
    });
    if (targetUser?.role === 'LEAD_SUP' && currentUser.role !== 'LEAD_SUP') {
      return NextResponse.json(
        { error: 'Only superuser can view notes for ADMIN users' },
        { status: 403 }
      );
    }

    const notes = await prisma.adminNote.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        author: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    return NextResponse.json({ notes });
  } catch (error) {
    console.error('Get admin notes error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch notes' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await requireAuth();
    const { id } = await params;
    if (isUnsafeId(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

    if (!canPerformAction(currentUser, 'admin:users:notes')) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    });
    if (!targetUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }
    if (targetUser.role === 'LEAD_SUP' && currentUser.role !== 'LEAD_SUP') {
      return NextResponse.json(
        { error: 'Only superuser can add notes to ADMIN users' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { text, important } = body ?? {};

    if (typeof text === 'string' && text.length > 10_000) {
      return NextResponse.json({ error: 'Text is too long' }, { status: 400 });
    }
    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
    }

    const note = await prisma.adminNote.create({
      data: {
        userId: id,
        authorId: currentUser.id,
        text: text.trim(),
        important: Boolean(important),
      },
      include: {
        author: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    return NextResponse.json({ note });
  } catch (error) {
    console.error('Create admin note error:', error);
    return NextResponse.json(
      { error: 'Failed to create note' },
      { status: 500 }
    );
  }
}
