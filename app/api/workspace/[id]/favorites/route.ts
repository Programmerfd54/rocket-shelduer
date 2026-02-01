import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

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

// POST - добавить в избранное
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const { channelId, channelName } = await request.json();

    const favorite = await prisma.favoriteChannel.create({
      data: {
        userId: user.id,
        workspaceId: id,
        channelId,
        channelName,
      },
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