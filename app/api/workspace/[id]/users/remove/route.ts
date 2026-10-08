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
import {
  MAX_REMOVE_TARGETS, userRemoveRequestSchema,
  type UserRemoveRequest, type UserRemoveResult,
} from '@/lib/workspace-user-remove';

/** Пауза между пользователями: users.delete тяжёлый, не упираемся в rate limit RC. */
const THROTTLE_MS = 200;
const RATE_LIMIT_RETRY_MS = 3000;
const ADMIN_REASON = 'администратор Rocket.Chat';
const SELF_REASON = 'учётная запись, под которой выполнен вход';
const NOT_FOUND_REASON = 'не найден в Rocket.Chat';

type Job = { username: string; recordIds: string[]; rcUserId: string | null };
type Local = { id: string; username: string; rcUserId: string | null };

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const looksLikeAuthFailure = (text?: string) => !!text && /unauthori|not authori|forbidden|not allowed|permission/i.test(text);

/** Склеивает выбранные записи и логины в уникальные задания (без учёта регистра). */
function buildJobs(body: UserRemoveRequest, locals: Local[]) {
  const byId = new Map(locals.map(l => [l.id, l]));
  const byName = new Map<string, Local[]>();
  for (const l of locals) {
    const key = l.username.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), l]);
  }
  const jobs = new Map<string, Job>();
  const missing: UserRemoveResult[] = [];
  const add = (username: string, local?: Local) => {
    const key = username.toLowerCase();
    const job = jobs.get(key) ?? { username, recordIds: [], rcUserId: null };
    if (local && !job.recordIds.includes(local.id)) job.recordIds.push(local.id);
    if (local?.rcUserId && !job.rcUserId) job.rcUserId = local.rcUserId;
    jobs.set(key, job);
  };
  for (const id of body.ids ?? []) {
    const local = byId.get(id);
    if (!local) { missing.push({ username: id, status: 'skipped', reason: 'запись не найдена в списке пространства' }); continue; }
    for (const same of byName.get(local.username.toLowerCase()) ?? [local]) add(same.username, same);
  }
  for (const username of body.usernames ?? []) {
    const same = byName.get(username.toLowerCase());
    if (same?.length) same.forEach(l => add(l.username, l));
    else add(username);
  }
  return { jobs: [...jobs.values()], missing };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let workspaceUrl = '';
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;
    const access = await assertWorkspaceBulkUsersAccess(user.id, workspaceId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    let body: UserRemoveRequest;
    try {
      body = userRemoveRequestSchema.parse(await request.json());
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError) {
        return NextResponse.json({ error: error instanceof z.ZodError ? error.issues[0]?.message : 'Некорректный JSON.' }, { status: 400 });
      }
      throw error;
    }

    const locals: Local[] = await prisma.workspaceAddedUser.findMany({
      where: { workspaceId }, select: { id: true, username: true, rcUserId: true },
    });
    const { jobs, missing } = buildJobs(body, locals);
    if (jobs.length > MAX_REMOVE_TARGETS) {
      return NextResponse.json({ error: `Максимум ${MAX_REMOVE_TARGETS} пользователей за запрос.` }, { status: 400 });
    }
    if (!jobs.length) {
      return NextResponse.json({ error: 'Не найдено пользователей для обработки.', results: missing }, { status: 404 });
    }

    workspaceUrl = access.workspace.workspaceUrl;
    const client = new RocketChatClient(workspaceUrl);
    let credentials;
    try {
      credentials = await authenticateRcAdmin(client, body);
    } catch (error) {
      return rcAdminErrorResponse(error, workspaceUrl, 'login');
    }
    const { authToken, userId: adminId } = credentials;
    const mode = body.mode;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: object) => controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n'));
        const results: UserRemoveResult[] = [...missing];
        const total = jobs.length + missing.length;
        const counts = () => ({
          removed: results.filter(r => r.status === 'removed').length,
          skipped: results.filter(r => r.status === 'skipped').length,
          errors: results.filter(r => r.status === 'error').length,
        });
        const push = (result: UserRemoveResult) => {
          results.push(result);
          emit({ t: 'progress', current: results.length, total, ...counts() });
          emit({ t: 'result', ...result });
        };
        try {
          emit({ t: 'start', total, mode });
          missing.forEach(result => emit({ t: 'result', ...result }));

          // Логин текущего администратора: второй уровень защиты помимо сравнения по ID.
          const self = await client.getUserForRemoval(authToken, adminId, { userId: adminId });
          const selfNames = new Set<string>();
          if (self.state === 'found' && self.username) selfNames.add(self.username.toLowerCase());
          if (body.adminAuthMethod === 'password' && body.adminUsername) selfNames.add(body.adminUsername.replace(/^@/, '').toLowerCase());

          const state = { fatal: null as string | null };
          for (let i = 0; i < jobs.length; i++) {
            const job = jobs[i];
            if (request.signal.aborted) break;
            if (state.fatal) { push({ username: job.username, status: 'skipped', reason: state.fatal }); continue; }
            if (i > 0) await sleep(THROTTLE_MS);
            push(await processJob(job));
          }

          async function processJob(job: Job): Promise<UserRemoveResult> {
            const { username } = job;
            const dropLocal = async () => {
              if (job.recordIds.length) {
                await prisma.workspaceAddedUser.deleteMany({ where: { workspaceId, id: { in: job.recordIds } } });
              }
            };
            if (selfNames.has(username.toLowerCase())) return { username, status: 'skipped', reason: SELF_REASON };

            let info = job.rcUserId
              ? await client.getUserForRemoval(authToken, adminId, { userId: job.rcUserId })
              : await client.getUserForRemoval(authToken, adminId, { username });
            // Сохранённый ID устарел: ищем по логину, но чужой аккаунт с тем же логином не трогаем.
            if (info.state === 'not_found' && job.rcUserId) {
              const byName = await client.getUserForRemoval(authToken, adminId, { username });
              if (byName.state === 'found') {
                return { username, status: 'skipped', reason: 'в Rocket.Chat под этим логином другая учётная запись (ID не совпадает)' };
              }
              info = byName;
            }
            if (info.state === 'error') {
              if (info.status === 401 || info.status === 403) {
                state.fatal = 'прервано: Rocket.Chat отклонил запрос (недостаточно прав или токен недействителен)';
              }
              return { username, status: 'error', reason: info.error };
            }
            if (info.state === 'not_found') {
              if (mode === 'delete') {
                await dropLocal();
                return { username, status: 'skipped', reason: `${NOT_FOUND_REASON}, запись убрана из списка` };
              }
              return { username, status: 'skipped', reason: NOT_FOUND_REASON };
            }
            if (info._id === adminId) return { username, status: 'skipped', reason: SELF_REASON };
            if (!info.roles) return { username, status: 'skipped', reason: 'не удалось определить роли пользователя в Rocket.Chat' };
            if (info.roles.includes('admin')) return { username, status: 'skipped', reason: ADMIN_REASON };

            if (mode === 'deactivate') {
              if (info.active === false) return { username, status: 'skipped', reason: 'уже деактивирован' };
              let res = await client.setUserActiveStatus(authToken, adminId, info._id, false);
              if (!res.success && /too many|rate|429/i.test(res.error ?? '')) {
                await sleep(RATE_LIMIT_RETRY_MS);
                res = await client.setUserActiveStatus(authToken, adminId, info._id, false);
              }
              if (!res.success && looksLikeAuthFailure(res.error)) state.fatal = 'прервано: недостаточно прав в Rocket.Chat';
              return res.success
                ? { username, status: 'removed' }
                : { username, status: 'error', reason: res.error || 'Не удалось деактивировать пользователя' };
            }

            let res = await client.deleteUser(authToken, adminId, info._id, { confirmRelinquish: true });
            if (!res.success && res.status === 429) {
              await sleep(RATE_LIMIT_RETRY_MS);
              res = await client.deleteUser(authToken, adminId, info._id, { confirmRelinquish: true });
            }
            if (res.success) {
              await dropLocal();
              return { username, status: 'removed' };
            }
            if (res.status === 401 || res.status === 403) state.fatal = 'прервано: недостаточно прав на удаление в Rocket.Chat';
            return { username, status: 'error', reason: res.error || 'Не удалось удалить пользователя' };
          }

          const final = counts();
          await prisma.workspaceActionLog.create({ data: {
            workspaceId, userId: user.id, action: 'users_remove',
            details: JSON.stringify({ mode, total, ...final, usernames: results.map(r => r.username), aborted: request.signal.aborted || undefined }),
          } }).catch(() => {});
          emit({ t: 'done', mode, total, ...final, results });
        } catch (error) {
          console.error('Workspace user remove stream failed:', error);
          emit({ t: 'error', error: getSafeErrorMessage(error, 'Удаление прервано') });
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
    if (workspaceUrl && (isRcNetworkFailure(error) || error instanceof RocketChatApiError)) {
      return rcAdminErrorResponse(error, workspaceUrl);
    }
    console.error('Workspace user removal failed:', error);
    return NextResponse.json({ error: 'Не удалось выполнить операцию. Проверьте подключение и права администратора Rocket.Chat.' }, { status: 500 });
  }
}
