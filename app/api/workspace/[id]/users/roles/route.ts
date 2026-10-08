import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/api-auth';
import { RocketChatClient } from '@/lib/rocketchat';
import { assertWorkspaceBulkUsersAccess } from '@/lib/workspace-bulk-users-access';
import { rcAdminCredentialsSchema } from '@/lib/rc-admin-credentials';
import { authenticateRcAdmin, rcAdminErrorResponse } from '@/lib/rc-admin-auth';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;
    const access = await assertWorkspaceBulkUsersAccess(user.id, workspaceId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const { workspace } = access;
    const body = rcAdminCredentialsSchema.parse(await request.json());
    const client = new RocketChatClient(workspace.workspaceUrl);
    let auth;
    try {
      auth = await authenticateRcAdmin(client, body);
    } catch (error) {
      return rcAdminErrorResponse(error, workspace.workspaceUrl, 'login');
    }
    // A catalogue permission failure must not discard the other successfully loaded list.
    const [roles, channels] = await Promise.allSettled([
      client.listRoles(auth.authToken, auth.userId),
      client.getProvisioningChannels(auth.authToken, auth.userId),
    ]);
    if (roles.status === 'rejected' && channels.status === 'rejected') {
      return rcAdminErrorResponse(roles.reason, workspace.workspaceUrl);
    }
    const warnings: { source: string; error: string; details?: string }[] = [];
    for (const [source, result] of [['Роли', roles], ['Каналы', channels]] as const) {
      if (result.status === 'rejected') {
        const response = rcAdminErrorResponse(result.reason, workspace.workspaceUrl);
        const problem = await response.json();
        warnings.push({ source, error: problem.error, details: problem.details });
      }
    }
    return NextResponse.json({
      roles: roles.status === 'fulfilled' ? roles.value.filter(role => role.scope === 'Users') : [],
      channels: channels.status === 'fulfilled'
        ? channels.value.map(channel => ({ id: channel._id, name: channel.fname || channel.name, type: channel.t })) : [],
      warnings,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: error instanceof z.ZodError ? error.issues[0]?.message : 'Некорректный JSON.' }, { status: 400 });
    }
    console.error('Load RC catalogues failed');
    return NextResponse.json({ error: 'Не удалось загрузить каналы и роли. Проверьте подключение приложения к базе данных.' }, { status: 500 });
  }
}
