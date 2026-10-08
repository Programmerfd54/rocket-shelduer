import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/api-auth';
import { isUnsafeId } from '@/lib/security';

// GET - получить избранные каналы
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;

    const favorites = await prisma.favoriteChannel.findMany({
      where: {
        userId: user.id,
        workspaceId: id,
      },
      select: {
        id: true,
        channelId: true,
        channelName: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ favorites });
  } catch (error) {
    console.error('Get favorites error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch favorites' },
      { status: 500 }
    );
  }
}

/** Владелец пространства или назначенный на него пользователь. */
async function hasWorkspaceAccess(userId: string, workspaceId: string): Promise<boolean> {
  if (isUnsafeId(workspaceId)) return false;
  const ws = await prisma.workspaceConnection.findUnique({
    where: { id: workspaceId },
    select: { userId: true },
  });
  if (!ws) return false;
  if (ws.userId === userId) return true;
  const assignment = await prisma.workspaceAdminAssignment.findFirst({
    where: { workspaceId, userId },
    select: { id: true },
  });
  return !!assignment;
}

// POST - добавить в избранное
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const channelId = body?.channelId;
    const channelName = body?.channelName;
    if (
      typeof channelId !== 'string' ||
      isUnsafeId(channelId) ||
      typeof channelName !== 'string' ||
      !channelName.trim() ||
      channelName.length > 200
    ) {
      return NextResponse.json({ error: 'channelId and channelName are required' }, { status: 400 });
    }
    if (!(await hasWorkspaceAccess(user.id, id))) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    const favorite = await prisma.favoriteChannel.create({
      data: {
        userId: user.id,
        workspaceId: id,
        channelId,
        channelName,
      },
      select: { id: true, channelId: true, channelName: true, createdAt: true },
    });

    return NextResponse.json({ success: true, favorite });
  } catch (error: any) {
    // Если уже существует
    if (error.code === 'P2002') {
      return NextResponse.json(
        { error: 'Channel already in favorites' },
        { status: 409 }
      );
    }
    
    console.error('Add favorite error:', error);
    return NextResponse.json(
      { error: 'Failed to add favorite' },
      { status: 500 }
    );
  }
}

// DELETE - удалить из избранного
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const channelId = searchParams.get('channelId');

    if (!channelId) {
      return NextResponse.json(
        { error: 'channelId is required' },
        { status: 400 }
      );
    }

    await prisma.favoriteChannel.deleteMany({
      where: {
        userId: user.id,
        workspaceId: id,
        channelId,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete favorite error:', error);
    return NextResponse.json(
      { error: 'Failed to delete favorite' },
      { status: 500 }
    );
  }
}