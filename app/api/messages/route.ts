import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/api-auth';
import { isUnsafeId, isValidOfficialTemplateId } from '@/lib/security';
import { admMessageScopeWhere, getAccessibleWorkspaceIds } from '@/lib/message-scope';
import { ApiError, apiError } from '@/lib/intensives/http';
import {
  createMessageWithPlanLink,
  findIdempotentMessage,
  hasPlanContext,
  parsePlanFields,
  resolvePlanContext,
  type ResolvedPlanContext,
} from '@/lib/intensives/schedule';

const MESSAGE_STATUSES = ['PENDING', 'SENT', 'FAILED', 'CANCELLED'];
const MAX_LIST_LIMIT = 1000;
const MAX_MESSAGE_LENGTH = 20_000;

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId');
    const status = searchParams.get('status');
    const filterUserId = searchParams.get('userId'); // Фильтр по пользователю (для админов)
    if (workspaceId && isUnsafeId(workspaceId)) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }
    if (filterUserId && isUnsafeId(filterUserId)) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }
    const scope = searchParams.get('scope'); // Специальный режим выборки (например, calendar)

    const where: any = {};

    const isSup = user.role === 'SUP';
    const isAdm = user.role === 'ADM';
    const isSuper = user.role === 'LEAD_SUP';

    // SUP / Lead_SUP видят сообщения всех пользователей. ADM — только свои и в пространствах,
    // которыми владеет или на которые назначен (фильтр userId лишь сужает эту область).
    const admScope = isAdm && (scope === 'calendar' || filterUserId)
      ? admMessageScopeWhere(user.id, await getAccessibleWorkspaceIds(user.id))
      : null;

    if (scope === 'calendar') {
      if (isSup || isSuper) {
        if (filterUserId) where.userId = filterUserId;
      } else if (isAdm && admScope) {
        Object.assign(where, admScope);
        if (filterUserId) where.userId = filterUserId;
      } else {
        // VOL и остальные видят только свои сообщения
        where.userId = user.id;
      }
    } else {
      // Обычный режим
      if (filterUserId && (isSup || isSuper)) {
        where.userId = filterUserId;
      } else if (filterUserId && isAdm && admScope) {
        Object.assign(where, admScope);
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
    // Интенсивы (необязательные фильтры): intensiveId=<id> | intensiveId=none (без привязки), planItemId=<id>
    const intensiveFilter = searchParams.get('intensiveId');
    if (intensiveFilter != null) {
      if (intensiveFilter === 'none') where.intensiveId = null;
      else if (isUnsafeId(intensiveFilter)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
      else where.intensiveId = intensiveFilter;
    }
    const planItemFilter = searchParams.get('planItemId');
    if (planItemFilter != null) {
      if (isUnsafeId(planItemFilter)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
      where.planItemId = planItemFilter;
    }
    if (status) {
      if (!MESSAGE_STATUSES.includes(status)) {
        return NextResponse.json({ error: 'Bad request' }, { status: 400 });
      }
      where.status = status;
    }

    // limit: только положительное целое, не больше MAX_LIST_LIMIT (без limit — как раньше, весь список)
    const limitRaw = searchParams.get('limit');
    const limitParsed = limitRaw ? parseInt(limitRaw, 10) : NaN;
    const limit = Number.isFinite(limitParsed) && limitParsed > 0 ? Math.min(limitParsed, MAX_LIST_LIMIT) : undefined;
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
    // Интенсивы: необязательные intensiveId / planItemId / clientRequestId / isPlanRepeat (docs/intensives-api.md)
    const planFields = body && typeof body === 'object' ? parsePlanFields(body) : null;
    if (!planFields) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }
    if (planFields.clientRequestId) {
      const existing = await findIdempotentMessage(user, planFields.clientRequestId);
      if (existing) {
        return NextResponse.json({ success: true, message: existing, idempotent: true });
      }
    }
    const {
      workspaceId,
      channelId,
      channelName,
      message,
      scheduledFor,
      asUserId,
      sourceUserTemplateId,
      sourceOfficialTemplateId,
    } = body;

    if (!workspaceId || !channelId || !channelName || !message || !scheduledFor) {
      return NextResponse.json(
        { error: 'All fields are required' },
        { status: 400 }
      );
    }
    if (
      typeof workspaceId !== 'string' ||
      typeof channelId !== 'string' ||
      typeof channelName !== 'string' ||
      typeof message !== 'string' ||
      (typeof scheduledFor !== 'string' && typeof scheduledFor !== 'number') ||
      (asUserId != null && typeof asUserId !== 'string') ||
      (sourceUserTemplateId != null && typeof sourceUserTemplateId !== 'string')
    ) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }
    if (message.length > MAX_MESSAGE_LENGTH || channelName.length > 200) {
      return NextResponse.json({ error: 'Сообщение слишком длинное' }, { status: 400 });
    }
    if (Number.isNaN(new Date(scheduledFor).getTime())) {
      return NextResponse.json({ error: 'Invalid scheduledFor' }, { status: 400 });
    }
    if (isUnsafeId(workspaceId) || isUnsafeId(channelId)) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }
    if (asUserId && isUnsafeId(asUserId)) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }
    if (sourceUserTemplateId && isUnsafeId(sourceUserTemplateId)) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }
    if (sourceOfficialTemplateId != null && typeof sourceOfficialTemplateId !== 'string') {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }
    if (sourceOfficialTemplateId && !isValidOfficialTemplateId(sourceOfficialTemplateId)) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }
    if (sourceUserTemplateId && sourceOfficialTemplateId) {
      return NextResponse.json(
        { error: 'Укажите только один тип шаблона' },
        { status: 400 }
      );
    }

    const workspace = await prisma.workspaceConnection.findUnique({
      where: { id: workspaceId },
      select: { id: true, userId: true, workspaceUrl: true, isArchived: true, orgSpaceId: true },
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
    if (workspace.isArchived) {
      return NextResponse.json(
        { error: 'Пространство в архиве — планирование сообщений недоступно.' },
        { status: 400 }
      );
    }

    // SUP/ADM/Lead_SUP: «от имени» (SUP/Lead_SUP — широко, ADM — только ADM/MEMBER)
    const restricted = (user.restrictedFeatures ?? []) as string[];
    let sendAsDisabled = user.role !== 'LEAD_SUP' && restricted.includes('sendAs');
    if (!sendAsDisabled && (user.role === 'SUP' || user.role === 'ADM')) {
      const sys = await prisma.systemSetting.findMany({ where: { key: { in: ['sendAsEnabledSup', 'sendAsEnabledAdm'] } } });
      const sendAsSup = sys.find((s) => s.key === 'sendAsEnabledSup')?.value ?? 'true';
      const sendAsAdm = sys.find((s) => s.key === 'sendAsEnabledAdm')?.value ?? 'true';
      if (user.role === 'SUP' && sendAsSup !== 'true') sendAsDisabled = true;
      if (user.role === 'ADM' && sendAsAdm !== 'true') sendAsDisabled = true;
    }
    let authorId = user.id;
    let scheduledById: string | null = null;
    if (asUserId && !sendAsDisabled) {
      if (user.role === 'SUP' || user.role === 'LEAD_SUP') {
        const targetUser = await prisma.user.findFirst({
          where: { id: asUserId, isActive: true, isBlocked: false },
          select: { id: true, role: true },
        });
        // SUP не может писать «от имени» Lead_SUP (вышестоящая роль)
        if (targetUser && targetUser.role === 'LEAD_SUP' && user.role !== 'LEAD_SUP') {
          return NextResponse.json(
            { error: 'Нельзя отправлять сообщения от имени пользователя с этой ролью.' },
            { status: 403 }
          );
        }
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
          where: { id: asUserId, isActive: true, isBlocked: false, role: { in: ['ADM', 'MEMBER'] } },
          select: { id: true },
        });
        if (!targetUser) {
          return NextResponse.json(
            { error: 'Для «от имени» можно выбрать только пользователей с ролями ADM или MEMBER.' },
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
          select: { id: true },
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

    let templateIdToLink: string | undefined;
    if (sourceUserTemplateId) {
      const tpl = await prisma.userTemplate.findFirst({
        where: { id: sourceUserTemplateId, userId: user.id },
      });
      if (!tpl) {
        return NextResponse.json({ error: 'Шаблон не найден' }, { status: 404 });
      }
      templateIdToLink = tpl.id;
    }

    const officialIdToLink =
      sourceOfficialTemplateId && !templateIdToLink
        ? sourceOfficialTemplateId.trim()
        : undefined;

    let planContext: ResolvedPlanContext | null = null;
    if (hasPlanContext(planFields)) {
      planContext = await resolvePlanContext({
        user,
        workspace,
        fields: planFields,
        scheduledDate,
        messageText: message,
      });
    }

    if (planContext || planFields.clientRequestId) {
      const { message: created, idempotent } = await createMessageWithPlanLink({
        user,
        plan: planContext,
        clientRequestId: planFields.clientRequestId,
        data: {
          userId: authorId,
          scheduledById: scheduledById || undefined,
          workspaceId,
          channelId,
          channelName,
          message,
          scheduledFor: scheduledDate,
          status: 'PENDING',
          ...(templateIdToLink ? { sourceUserTemplateId: templateIdToLink } : {}),
          ...(officialIdToLink ? { sourceOfficialTemplateId: officialIdToLink } : {}),
        },
      });
      return NextResponse.json({ success: true, message: created, ...(idempotent ? { idempotent: true } : {}) });
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
        ...(templateIdToLink ? { sourceUserTemplateId: templateIdToLink } : {}),
        ...(officialIdToLink ? { sourceOfficialTemplateId: officialIdToLink } : {}),
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
    if (error instanceof ApiError) return apiError(error.status, error.code, error.message, error.extra);
    console.error('Create scheduled message error:', error);
    return NextResponse.json(
      { error: 'Failed to schedule message' },
      { status: 500 }
    );
  }
}