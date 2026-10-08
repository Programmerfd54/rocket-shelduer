import { NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/api-auth';
import { getSafeErrorMessage } from '@/lib/security';
import { RocketChatClient } from '@/lib/rocketchat';
import { authenticateRcAdmin, rcAdminErrorResponse } from '@/lib/rc-admin-auth';
import { RocketChatApiError } from '@/lib/rc-api-error';
import { isRcNetworkFailure } from '@/lib/rc-network';
import { assertWorkspaceBulkUsersAccess } from '@/lib/workspace-bulk-users-access';
import { applyUserAssignments } from '@/lib/apply-user-assignments';
import {
  getDefaultAssignments, getImportUsers, userAssignmentsSchema, userImportRequestSchema,
  type UserAssignments, type UserImportRequest,
} from '@/lib/workspace-user-assignments';

type ImportJob = {
  id?: string;
  login: string;
  email: string;
  rcUserId?: string | null;
  assignments: UserAssignments;
};
type ImportResult = { login: string; status: 'ADDED' | 'ERROR' | 'ALREADY_EXISTS'; rcUserId?: string; error?: string };

export async function handleWorkspaceUserImport(request: Request, workspaceId: string, retry = false) {
  let workspaceUrl = '';
  try {
    const user = await requireAuth();
    const access = await assertWorkspaceBulkUsersAccess(user.id, workspaceId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    let body: UserImportRequest;
    let jobs: ImportJob[];
    try {
      body = userImportRequestSchema.parse(await request.json());
      if (retry) {
        const records = await prisma.workspaceAddedUser.findMany({
          where: { workspaceId, status: 'ERROR' }, orderBy: { addedAt: 'asc' },
        });
        jobs = records.map(record => ({
          id: record.id, login: record.username, email: record.email, rcUserId: record.rcUserId,
          // Saved per-user choices take precedence over current form defaults, including empty selections.
          assignments: record.pendingAssignments == null
            ? getDefaultAssignments(body)
            : userAssignmentsSchema.parse(record.pendingAssignments),
        }));
      } else {
        jobs = getImportUsers(body).map(entry => ({
          login: entry.login, email: `${entry.login}@student.21-school.ru`, assignments: entry.assignments,
        }));
      }
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError || (error instanceof Error && error.message.startsWith('Логин повторяется'))) {
        return NextResponse.json({
          error: error instanceof z.ZodError ? error.issues[0]?.message : error instanceof SyntaxError ? 'Некорректный JSON.' : error.message,
        }, { status: 400 });
      }
      throw error;
    }
    if (!jobs.length) return NextResponse.json({ results: [], message: 'Нет пользователей с ошибкой для повтора.' });

    workspaceUrl = access.workspace.workspaceUrl;
    const client = new RocketChatClient(workspaceUrl);
    let credentials;
    try {
      credentials = await authenticateRcAdmin(client, body);
    } catch (error) {
      return rcAdminErrorResponse(error, workspaceUrl, 'login');
    }
    const { authToken, userId: adminId } = credentials;
    if (jobs.some(job => job.assignments.roleIds.length)) {
      const roles = await client.listRoles(authToken, adminId);
      const available = new Set(roles.filter(role => role.scope === 'Users').map(role => role._id));
      const invalid = jobs.flatMap(job => job.assignments.roleIds).find(id => !available.has(id));
      if (invalid) return NextResponse.json({ error: `Роль ${invalid} недоступна для назначения пользователю. Обновите список ролей.` }, { status: 400 });
    }
    if (jobs.some(job => job.assignments.channels.length)) {
      const channels = await client.getProvisioningChannels(authToken, adminId);
      const available = new Map(channels.map(channel => [channel._id, channel.t]));
      const invalid = jobs.flatMap(job => job.assignments.channels).find(channel => available.get(channel.id) !== channel.type);
      if (invalid) return NextResponse.json({ error: `Канал ${invalid.name || invalid.id} недоступен. Обновите список каналов.` }, { status: 400 });
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: object) => controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n'));
        const results: ImportResult[] = [];
        let added = 0;
        let errors = 0;
        let skipped = 0;
        try {
          emit({ t: 'start', total: jobs.length });
          for (const job of jobs) {
            if (request.signal.aborted) break;
            // Keep the plan before the RC call so failures can be retried after a page reload.
            const record = job.id ? { id: job.id } : await prisma.workspaceAddedUser.create({ data: {
              workspaceId, username: job.login, email: job.email, status: 'ERROR',
              pendingAssignments: job.assignments, errorMessage: 'Создание пользователя не завершено.',
            } });
            let targetId = job.rcUserId;
            let result: ImportResult = { login: job.login, status: 'ERROR', error: 'Не удалось создать пользователя.' };
            if (!targetId) {
              const created = await client.createUser(authToken, adminId, {
                email: job.email, name: job.login, username: job.login, password: job.login,
                requirePasswordChange: true, verified: true,
              });
              if (created.success && created.userId) {
                targetId = created.userId;
                // Persist identity before any optional assignments; retry must not create this account again.
                await prisma.workspaceAddedUser.update({ where: { id: record.id }, data: {
                  rcUserId: targetId, pendingAssignments: job.assignments,
                  errorMessage: 'Пользователь создан; назначение каналов и ролей не завершено.',
                } });
              } else {
                const error = created.error || 'Не удалось создать пользователя.';
                const exists = /already exists|username is already/i.test(error);
                const status = exists && (retry || body.ifUserExists === 'skip') ? 'ALREADY_EXISTS' : 'ERROR';
                await prisma.workspaceAddedUser.update({ where: { id: record.id }, data: {
                  status, errorMessage: error, pendingAssignments: job.assignments,
                } });
                result = { login: job.login, status, error };
              }
            }
            if (targetId) {
              const assigned = await applyUserAssignments(client, authToken, adminId, targetId, job.login, job.assignments);
              const status = assigned.errors.length ? 'ERROR' : 'ADDED';
              const error = assigned.errors.length
                ? `Аккаунт создан, но не все назначения выполнены. ${assigned.errors.join('; ')}` : undefined;
              await prisma.workspaceAddedUser.update({ where: { id: record.id }, data: {
                status, rcUserId: targetId, errorMessage: error ?? null, pendingAssignments: assigned.pending,
              } });
              result = { login: job.login, status, rcUserId: targetId, error };
            }
            results.push(result);
            if (result.status === 'ADDED') added++;
            else if (result.status === 'ERROR') errors++;
            else skipped++;
            emit({ t: 'progress', current: results.length, total: jobs.length, added, errors, skipped });
            emit({ t: 'result', ...result });
          }
          await prisma.workspaceActionLog.create({ data: { workspaceId, userId: user.id, action: 'users_add' } }).catch(() => {});
          emit({ t: 'done', total: jobs.length, added, errors, skipped, results });
        } catch (error) {
          console.error('Workspace user import stream failed:', error);
          emit({ t: 'error', error: getSafeErrorMessage(error, 'Добавление прервано. Проверьте список добавленных пользователей перед повтором.') });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
    }
    if (error && typeof error === 'object' && 'code' in error && ['P2021', 'P2022'].includes(String(error.code))) {
      return NextResponse.json({ error: 'Обновите схему базы данных: npx prisma migrate deploy.', code: 'MIGRATION_NEEDED' }, { status: 503 });
    }
    if (workspaceUrl && (isRcNetworkFailure(error) || error instanceof RocketChatApiError)) {
      return rcAdminErrorResponse(error, workspaceUrl);
    }
    console.error('Workspace user import failed:', error);
    return NextResponse.json({ error: 'Не удалось выполнить импорт пользователей. Проверьте подключение и права администратора Rocket.Chat.' }, { status: 500 });
  }
}
