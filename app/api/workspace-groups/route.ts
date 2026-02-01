import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

export async function GET() {
  try {
    const user = await requireAuth();

    const groups = await prisma.workspaceGroup.findMany({
      where: { userId: user.id },
      include: {
        workspaces: {
          include: {
            workspace: {
              select: {
                id: true,
                workspaceName: true,
                workspaceUrl: true,
                isActive: true,
                isArchived: true,
                color: true,
              },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { order: 'asc' },
    });

    return NextResponse.json({ groups });
  } catch (error) {
    console.error('Get workspace groups error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch workspace groups' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const body = await request.json();
    const { name, color, icon } = body;

    if (!name) {
      return NextResponse.json(
        { error: 'Group name is required' },
        { status: 400 }
      );
    }

    const group = await prisma.workspaceGroup.create({
      data: {
        userId: user.id,
        name,
        color: color || '#ef4444',
        icon: icon || null,
      },
    });

    return NextResponse.json({
      success: true,
      group,
    });
  } catch (error: any) {
    console.error('Create workspace group error:', error);
    if (error.code === 'P2002') {
      return NextResponse.json(
        { error: 'Group with this name already exists' },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: 'Failed to create workspace group' },
      { status: 500 }
    );
  }
}
