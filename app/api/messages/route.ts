import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId');
    const status = searchParams.get('status');
    const filterUserId = searchParams.get('userId'); // Фильтр по пользователю (для админов)
    const scope = searchParams.get('scope'); // Специальный режим выборки (например, calendar)

    const where: any = {};

    const isSup = user.role === 'SUPPORT';
    const isAdm = user.role === 'ADM';
    const isSuper = user.role === 'ADMIN';

    if (scope === 'calendar') {
      // SUP и ADM видят все запланированные сообщения от всех пользователей
      if (filterUserId && (isSup || isAdm || isSuper)) {
        where.userId = filterUserId;
      } else if (isSup || isAdm || isSuper) {
        // Без фильтра — все сообщения
      } else {
        // VOL и остальные видят только свои сообщения
        where.userId = user.id;
      }
    } else {
      // Обычный режим
      if (filterUserId && (isSup || isAdm || isSuper)) {
        where.userId = filterUserId;
      } else if (workspaceId) {
        // Запрос по конкретному пространству: владелец или назначенный видят все сообщения по этому пространству
        const workspace = await prisma.workspaceConnection.findUnique({
          where: { id: workspaceId },
          select: { userId: true },
        });
        const assignment = workspace
          ? await prisma.workspaceAdminAssignment.findFirst({
              where: { workspaceId, userId: user.id },
            })
          : null;
        const hasAccess = workspace?.userId === user.id || assignment != null;
        if (!hasAccess) {
          where.userId = user.id; // нет доступа — только свои
        }
        // иначе не добавляем where.userId — видим все сообщения по workspace
      } else {
        where.userId = user.id;
      }
    }

    if (workspaceId) where.workspaceId = workspaceId;
    if (status) where.status = status;

    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined;
    const sort = searchParams.get('sort') || 'asc';

    const messages = await prisma.scheduledMessage.findMany({
      where,
      take: limit,
      include: {
        workspace: {
          select: {
            id: true,
            workspaceName: true,
            workspaceUrl: true,
            username: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            username: true,
            role: true,
            avatarUrl: true,
          },
        },
        scheduledBy: isSuper ? {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            avatarUrl: true,
          },
        } : false,
      },
      orderBy: sort === 'recent' 
        ? { createdAt: 'desc' }
        : { scheduledFor: sort === 'desc' ? 'desc' : 'asc' },
    });

    return NextResponse.json({ messages });
  } catch (error) {
    console.error('Get messages error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch messages' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const body = await request.json();
    const { workspaceId, channelId, channelName, message, scheduledFor, asUserId } = body;

    if (!workspaceId || !channelId || !channelName || !message || !scheduledFor) {
      return NextResponse.json(
        { error: 'All fields are required' },
        { status: 400 }
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
    const isOwner = workspace.userId === user.id;
    const assignment = await prisma.workspaceAdminAssignment.findFirst({
      where: { workspaceId, userId: user.id },
    });
    if (!isOwner && !assignment) {
      return NextResponse.json(
        { error: 'No access to this workspace' },
        { status: 403 }
      );
    }

    // SUP/ADM/ADMIN: отправить сообщение "от имени" другого пользователя (SUP/ADMIN — любой, ADM — только ADM/VOL)
    const restricted = (user.restrictedFeatures ?? []) as string[];
    let sendAsDisabled = user.role !== 'ADMIN' && restricted.includes('sendAs');
    if (!sendAsDisabled && (user.role === 'SUPPORT' || user.role === 'ADM')) {
      const sys = await prisma.systemSetting.findMany({ where: { key: { in: ['sendAsEnabledSup', 'sendAsEnabledAdm'] } } });
      const sendAsSup = sys.find((s) => s.key === 'sendAsEnabledSup')?.value ?? 'true';
      const sendAsAdm = sys.find((s) => s.key === 'sendAsEnabledAdm')?.value ?? 'true';
      if (user.role === 'SUPPORT' && sendAsSup !== 'true') sendAsDisabled = true;
      if (user.role === 'ADM' && sendAsAdm !== 'true') sendAsDisabled = true;
    }
    let authorId = user.id;
    let scheduledById: string | null = null;
    if (asUserId && !sendAsDisabled) {
      if (user.role === 'SUPPORT' || user.role === 'ADMIN') {
        const targetUser = await prisma.user.findFirst({
          where: { id: asUserId, isActive: true },
        });
        if (!targetUser) {
          return NextResponse.json(
            { error: 'User not found or inactive' },
            { status: 400 }
          );
        }
        authorId = asUserId;
        scheduledById = user.id;
      } else if (user.role === 'ADM') {
        const targetUser = await prisma.user.findFirst({
          where: { id: asUserId, isActive: true, role: { in: ['ADM', 'VOL'] } },
        });
        if (!targetUser) {
          return NextResponse.json(
            { error: 'Only ADM and VOL users can be selected for "send as"' },
            { status: 400 }
          );
        }
        authorId = asUserId;
        scheduledById = user.id;
      }
      // Чтобы в Rocket.Chat сообщение отображалось от выбранного пользователя, он должен подключить это пространство
      if (authorId !== user.id) {
        const authorConnection = await prisma.workspaceConnection.findFirst({
          where: {
            userId: authorId,
            workspaceUrl: workspace.workspaceUrl,
            isActive: true,
            authToken: { not: null },
            userId_RC: { not: null },
          },
        });
        if (!authorConnection) {
          return NextResponse.json(
            {
              error:
                'Выбранный отправитель не подключил это пространство в планировщике. Подключите Rocket.Chat под этим пользователем для этого сервера — тогда сообщения в чате будут отображаться от него.',
            },
            { status: 400 }
          );
        }
      }
    }

    const scheduledDate = new Date(scheduledFor);
    if (scheduledDate <= new Date()) {
      return NextResponse.json(
        { error: 'Scheduled time must be in the future' },
        { status: 400 }
      );
    }

    const scheduledMessage = await prisma.scheduledMessage.create({
      data: {
        userId: authorId,
        scheduledById: scheduledById || undefined,
        workspaceId,
        channelId,
        channelName,
        message,
        scheduledFor: scheduledDate,
        status: 'PENDING',
      },
      include: {
        workspace: {
          select: {
            workspaceName: true,
            workspaceUrl: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      message: scheduledMessage,
    });
  } catch (error) {
    console.error('Create scheduled message error:', error);
    return NextResponse.json(
      { error: 'Failed to schedule message' },
      { status: 500 }
    );
  }
}