import { NextResponse } from 'next/server';
import { z } from 'zod';
import { rcAdminCredentialsSchema } from '@/lib/rc-admin-credentials';
import { authenticateRcAdmin, rcAdminErrorResponse } from '@/lib/rc-admin-auth';
import prisma from '@/lib/prisma';
import { getSafeErrorMessage } from '@/lib/security';
import { requireAuth } from '@/lib/api-auth';
import { RocketChatClient } from '@/lib/rocketchat';
import { assertWorkspaceBulkUsersAccess } from '@/lib/workspace-bulk-users-access';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;

    const access = await assertWorkspaceBulkUsersAccess(user.id, workspaceId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { workspace } = access;

    const body = rcAdminCredentialsSchema.parse(await request.json());
    const rcClient = new RocketChatClient(workspace.workspaceUrl);
    let credentials;
    try {
      credentials = await authenticateRcAdmin(rcClient, body);
    } catch (error) {
      return rcAdminErrorResponse(error, workspace.workspaceUrl, 'login');
    }
    const { authToken, userId: rcUserId } = credentials;

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
    if (error?.message === 'Unauthorized') return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: error instanceof z.ZodError ? error.issues[0]?.message : 'Некорректный JSON.' }, { status: 400 });
    }
    console.error('Refresh login error:', error);
    return NextResponse.json(
      { error: getSafeErrorMessage(error, 'Failed to refresh') },
      { status: 500 }
    );
  }
}
