import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  try {
    const currentUser = await requireAuth();
    const { id, noteId } = await params;

    if (currentUser.role !== 'SUPPORT' && currentUser.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const note = await prisma.adminNote.findFirst({
      where: { id: noteId, userId: id },
      include: { user: { select: { role: true } } },
    });

    if (!note) {
      return NextResponse.json(
        { error: 'Note not found' },
        { status: 404 }
      );
    }
    if (note.user?.role === 'ADMIN' && currentUser.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only superuser can delete notes for ADMIN users' },
        { status: 403 }
      );
    }

    await prisma.adminNote.delete({
      where: { id: noteId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete admin note error:', error);
    return NextResponse.json(
      { error: 'Failed to delete note' },
      { status: 500 }
    );
  }
}
