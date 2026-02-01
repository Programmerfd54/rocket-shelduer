import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { RocketChatClient } from '@/lib/rocketchat';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;

    const workspace = await prisma.workspaceConnection.findFirst({
      where: {
        id: workspaceId,
        userId: user.id,
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const adminUsername = (body.adminUsername as string)?.trim();
    const adminPassword = typeof body.adminPassword === 'string' ? body.adminPassword : '';

    if (!adminUsername || !adminPassword) {
      return NextResponse.json(
        { error: 'Укажите логин и пароль администратора Rocket.Chat.' },
        { status: 400 }
      );
    }

    const baseUrl = workspace.workspaceUrl.replace(/\/$/, '');
    const rcClient = new RocketChatClient(baseUrl);

    let authToken: string;
    let rcUserId: string;
    try {
      const loginResult = await rcClient.login(adminUsername, adminPassword);
      authToken = loginResult.authToken;
      rcUserId = loginResult.userId;
    } catch (loginError: any) {
      return NextResponse.json(
        {
          error: 'Не удалось войти. Проверьте учётные данные администратора.',
          details: loginError?.message,
        },
        { status: 401 }
      );
    }

    const added = await prisma.workspaceAddedUser.findMany({
      where: { workspaceId, status: 'ADDED', rcUserId: { not: null } },
    });

    for (const u of added) {
      if (!u.rcUserId) continue;
      const info = await rcClient.getUserInfo(authToken, rcUserId, u.rcUserId);
      if (info?.lastLogin) {
        await prisma.workspaceAddedUser.update({
          where: { id: u.id },
          data: { lastLoginAt: new Date(info.lastLogin) },
        });
      }
    }

    const updated = await prisma.workspaceAddedUser.findMany({
      where: { workspaceId },
      orderBy: { addedAt: 'desc' },
    });

    return NextResponse.json({
      users: updated.map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        addedAt: u.addedAt.toISOString(),
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        status: u.status,
        errorMessage: u.errorMessage,
      })),
    });
  } catch (error: any) {
    console.error('Refresh login error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to refresh' },
      { status: 500 }
    );
  }
}
