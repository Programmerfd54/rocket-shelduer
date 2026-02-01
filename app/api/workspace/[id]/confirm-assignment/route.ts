import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { encryptPassword } from '@/lib/encryption';
import { RocketChatClient } from '@/lib/rocketchat';
import { logSecurityEvent, getClientIp, isSuspiciousInput, SecurityEventType } from '@/lib/security';

/**
 * POST — подтвердить назначение: войти в Rocket.Chat (логин/пароль LDAP)
 * и создать своё подключение к пространству. Доступно только назначенным (ADM/SUP/VOL).
 * Body: { username, password }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;

    const assignment = await prisma.workspaceAdminAssignment.findFirst({
      where: { userId: user.id, workspaceId },
    });
    if (!assignment) {
      return NextResponse.json(
        { error: 'Вы не назначены на это пространство.' },
        { status: 403 }
      );
    }

    const workspace = await prisma.workspaceConnection.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const username = body?.username?.trim?.();
    const password = body?.password;
    if (!username || typeof password !== 'string') {
      return NextResponse.json(
        { error: 'Укажите логин и пароль Rocket.Chat (LDAP).' },
        { status: 400 }
      );
    }

    if (isSuspiciousInput(username) || isSuspiciousInput(password)) {
      const ip = getClientIp(request);
      const userAgent = request.headers.get('user-agent') ?? undefined;
      await logSecurityEvent({
        type: SecurityEventType.SUSPICIOUS_INPUT,
        path: `/api/workspace/${workspaceId}/confirm-assignment`,
        method: 'POST',
        ipAddress: ip,
        userAgent,
        details: 'Подозрительные символы при подтверждении назначения пространства',
        blocked: true,
        userId: user.id,
      });
      return NextResponse.json(
        { error: 'Invalid input' },
        { status: 400 }
      );
    }

    // VOL может иметь только одно активное пространство (ADM/SUP - неограниченно)
    if (user.role === 'VOL') {
      const count = await prisma.workspaceConnection.count({
        where: { userId: user.id, isArchived: false },
      });
      if (count >= 1) {
        return NextResponse.json(
          { error: 'Волонтёр может подключить только одно пространство.' },
          { status: 400 }
        );
      }
    }

    const normalizeWorkspaceUrl = (u: string) => (u || '').trim().replace(/\/+$/, '') || u;
    const normalizedUrl = normalizeWorkspaceUrl(workspace.workspaceUrl);

    const existing = await prisma.workspaceConnection.findFirst({
      where: {
        userId: user.id,
        OR: [
          { workspaceUrl: normalizedUrl },
          { workspaceUrl: normalizedUrl + '/' },
        ],
      },
    });
    if (existing) {
      return NextResponse.json(
        { error: 'У вас уже есть подключение к этому пространству.' },
        { status: 400 }
      );
    }

    const rcClient = new RocketChatClient(normalizedUrl);
    const { authToken, userId: rcUserId } = await rcClient.login(username.trim(), password);

    const encryptedPassword = encryptPassword(password);

    const newConnection = await prisma.workspaceConnection.create({
      data: {
        userId: user.id,
        workspaceName: workspace.workspaceName,
        workspaceUrl: normalizedUrl,
        username: username.trim(),
        encryptedPassword,
        has2FA: false,
        authToken,
        userId_RC: rcUserId,
        isActive: true,
        lastConnected: new Date(),
        startDate: workspace.startDate,
        endDate: workspace.endDate,
        color: workspace.color,
      },
      select: { id: true },
    });

    return NextResponse.json({
      success: true,
      workspaceId: newConnection.id,
    });
  } catch (error) {
    console.error('Confirm assignment error:', error);
    const rawMessage = error instanceof Error ? error.message : 'Ошибка подключения к Rocket.Chat';
    const isNetworkError =
      /fetch failed|timeout|ECONNREFUSED|ECONNRESET|UND_ERR_CONNECT_TIMEOUT|ENOTFOUND|ETIMEDOUT/i.test(rawMessage);
    const status = isNetworkError ? 503 : 500;
    const message = isNetworkError
      ? 'Сервер Rocket.Chat недоступен. Проверьте подключение к интернету и доступность сервера, затем повторите попытку.'
      : rawMessage;
    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}