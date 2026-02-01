import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { RocketChatClient } from '@/lib/rocketchat';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    let user;
    try {
      user = await requireAuth();
    } catch (authError: any) {
      if (authError?.message === 'Unauthorized') {
        return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
      }
      throw authError;
    }
    const { id: workspaceId } = await params;

    const workspace = await prisma.workspaceConnection.findFirst({
      where: { id: workspaceId, userId: user.id },
    });
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
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
    const loginResult = await rcClient.login(adminUsername, adminPassword);
    const roles = await rcClient.listRoles(loginResult.authToken, loginResult.userId);

    return NextResponse.json({ roles });
  } catch (error: any) {
    console.error('List roles error:', error);
    return NextResponse.json(
      { error: error?.message || 'Не удалось загрузить роли' },
      { status: 500 }
    );
  }
}
