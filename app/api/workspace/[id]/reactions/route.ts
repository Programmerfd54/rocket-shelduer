import { NextResponse } from 'next/server';
import type { ReactionRatingSettings } from '@prisma/client';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/api-auth';
import { assertReactionsAccess } from '@/lib/reactions/access';
import { DEFAULT_TIMEZONE, isValidPeriod, periodOf } from '@/lib/reactions/core';
import {
  ReactionRatingError,
  buildMonthlyPost,
  buildWeeklyPost,
  enqueuePost,
  finalizeMonth,
  getLeaderboard,
  listMonthlyHistory,
  listPeriods,
  parseChannels,
  syncWorkspace,
  verifyReportChannel,
} from '@/lib/reactions/service';
import { isUnsafeId } from '@/lib/security';

const MAX_CHANNELS = 50;
const MAX_POST_LENGTH = 5000;

type Params = { params: Promise<{ id: string }> };

function defaultSettings(workspaceId: string): ReactionRatingSettings {
  const now = new Date();
  return {
    id: '',
    workspaceId,
    enabled: false,
    channels: [],
    excludeOwnMessages: true,
    excludeBots: true,
    includeThreads: false,
    excludedUsernames: [],
    timezone: DEFAULT_TIMEZONE,
    reportChannelId: null,
    reportChannelName: null,
    weeklyEnabled: false,
    weeklyDay: 1,
    reportHour: 12,
    monthlyEnabled: false,
    topN: 10,
    mentionUsers: false,
    lastSyncAt: null,
    lastSyncError: null,
    lastWeeklyPostKey: null,
    lastMonthlyPostPeriod: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function logAction(workspaceId: string, userId: string, action: string, details: Record<string, unknown>) {
  try {
    await prisma.workspaceActionLog.create({
      data: { workspaceId, userId, action: `reactions_${action}`, details: JSON.stringify(details).slice(0, 4000) },
    });
  } catch {
    /* ignore */
  }
}

function errorResponse(error: unknown, scope: string) {
  if (error instanceof ReactionRatingError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof Error && error.message === 'Unauthorized') {
    return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
  }
  console.error(`[reactions:${scope}]`, error);
  return NextResponse.json(
    {
      error: 'Не удалось выполнить операцию с рейтингом реакций',
      ...(process.env.NODE_ENV !== 'production' && { details: error instanceof Error ? error.message : String(error) }),
    },
    { status: 500 },
  );
}

async function authorize(params: Params['params']) {
  const user = await requireAuth();
  const { id: workspaceId } = await params;
  const access = await assertReactionsAccess(user.id, user.role, workspaceId);
  return { user, workspaceId, access };
}

async function loadSettings(workspaceId: string) {
  return (await prisma.reactionRatingSettings.findUnique({ where: { workspaceId } })) ?? null;
}

// ── GET: настройки, рейтинг за период, история ──

export async function GET(request: Request, { params }: Params) {
  try {
    const { workspaceId, access } = await authorize(params);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const stored = await loadSettings(workspaceId);
    const settings = stored ?? defaultSettings(workspaceId);
    const tz = settings.timezone || DEFAULT_TIMEZONE;
    const requested = new URL(request.url).searchParams.get('period');
    const period = isValidPeriod(requested) ? requested : periodOf(new Date(), tz);

    const [leaderboard, periods, history] = await Promise.all([
      getLeaderboard(workspaceId, settings, period),
      listPeriods(workspaceId, tz),
      listMonthlyHistory(workspaceId),
    ]);

    return NextResponse.json({
      configured: !!stored,
      settings: { ...settings, channels: parseChannels(settings.channels) },
      leaderboard,
      periods,
      history,
    });
  } catch (error) {
    return errorResponse(error, 'get');
  }
}

// ── PUT: сохранение настроек ──

function bool(v: unknown, fallback: boolean) {
  return typeof v === 'boolean' ? v : fallback;
}

function intIn(v: unknown, min: number, max: number, fallback: number) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

function parseUsernames(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\s,;]+/) : [];
  const out = new Set<string>();
  for (const x of list) {
    const u = typeof x === 'string' ? x.trim().replace(/^@/, '').toLowerCase() : '';
    if (u && /^[\w.\-]{1,64}$/.test(u)) out.add(u);
  }
  return [...out].slice(0, 200);
}

function validTimezone(tz: unknown): string | null {
  if (typeof tz !== 'string' || !tz.trim()) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz.trim() });
    return tz.trim();
  } catch {
    return null;
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const { user, workspaceId, access } = await authorize(params);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const body = await request.json().catch(() => ({}));
    const current = (await loadSettings(workspaceId)) ?? defaultSettings(workspaceId);

    const channels = parseChannels(body.channels).slice(0, MAX_CHANNELS);
    if (Array.isArray(body.channels) && body.channels.length > MAX_CHANNELS) {
      return NextResponse.json({ error: `Можно выбрать не больше ${MAX_CHANNELS} каналов` }, { status: 400 });
    }
    const timezone = body.timezone === undefined ? current.timezone : validTimezone(body.timezone);
    if (!timezone) return NextResponse.json({ error: 'Некорректный часовой пояс' }, { status: 400 });

    const requestedReportChannelId =
      body.reportChannelId === undefined
        ? current.reportChannelId
        : typeof body.reportChannelId === 'string' && body.reportChannelId.trim()
          ? body.reportChannelId.trim()
          : null;
    if (requestedReportChannelId && isUnsafeId(requestedReportChannelId)) {
      return NextResponse.json({ error: 'Некорректный канал рейтинга' }, { status: 400 });
    }
    let reportChannelId: string | null = requestedReportChannelId;
    let reportChannelName: string | null = reportChannelId ? current.reportChannelName : null;
    // Новый канал публикаций проверяем в Rocket.Chat под учётной записью того, кто сохраняет настройки:
    // публикации уходят от имени владельца пространства, поэтому канал нельзя задать произвольной строкой.
    if (reportChannelId && reportChannelId !== current.reportChannelId) {
      const verified = await verifyReportChannel(workspaceId, user.id, reportChannelId);
      reportChannelId = verified.id;
      reportChannelName = verified.name;
    }
    const weeklyEnabled = bool(body.weeklyEnabled, current.weeklyEnabled);
    const monthlyEnabled = bool(body.monthlyEnabled, current.monthlyEnabled);
    if ((weeklyEnabled || monthlyEnabled) && !reportChannelId) {
      return NextResponse.json({ error: 'Для автопубликаций выберите канал рейтинга' }, { status: 400 });
    }

    const data = {
      enabled: bool(body.enabled, current.enabled),
      channels: body.channels === undefined ? parseChannels(current.channels) : channels,
      excludeOwnMessages: bool(body.excludeOwnMessages, current.excludeOwnMessages),
      excludeBots: bool(body.excludeBots, current.excludeBots),
      includeThreads: bool(body.includeThreads, current.includeThreads),
      excludedUsernames: body.excludedUsernames === undefined ? current.excludedUsernames : parseUsernames(body.excludedUsernames),
      timezone,
      reportChannelId,
      reportChannelName,
      weeklyEnabled,
      weeklyDay: intIn(body.weeklyDay, 1, 7, current.weeklyDay),
      reportHour: intIn(body.reportHour, 0, 23, current.reportHour),
      monthlyEnabled,
      topN: intIn(body.topN, 3, 50, current.topN),
      mentionUsers: bool(body.mentionUsers, current.mentionUsers),
    };

    const saved = await prisma.reactionRatingSettings.upsert({
      where: { workspaceId },
      create: { workspaceId, ...data },
      update: data,
    });
    await logAction(workspaceId, user.id, 'settings', {
      enabled: saved.enabled,
      channels: data.channels.length,
      reportChannelId: saved.reportChannelId,
      reportChannelName: saved.reportChannelName,
    });
    return NextResponse.json({ settings: { ...saved, channels: parseChannels(saved.channels) } });
  } catch (error) {
    return errorResponse(error, 'put');
  }
}

// ── POST: действия ──

export async function POST(request: Request, { params }: Params) {
  try {
    const { user, workspaceId, access } = await authorize(params);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const body = await request.json().catch(() => ({}));
    const action = typeof body.action === 'string' ? body.action : '';
    const settings = await loadSettings(workspaceId);
    if (!settings) return NextResponse.json({ error: 'Сначала сохраните настройки рейтинга' }, { status: 400 });
    const tz = settings.timezone || DEFAULT_TIMEZONE;

    switch (action) {
      case 'sync': {
        const result = await syncWorkspace(workspaceId, { actingUserId: user.id });
        return NextResponse.json({ ok: true, result });
      }

      case 'recalculate': {
        if (!isValidPeriod(body.period)) return NextResponse.json({ error: 'Укажите период в формате ГГГГ-ММ' }, { status: 400 });
        const period = body.period;
        if (period > periodOf(new Date(), tz)) return NextResponse.json({ error: 'Период ещё не наступил' }, { status: 400 });
        const finalized = await prisma.reactionMonthlyResult.findUnique({
          where: { workspaceId_period: { workspaceId, period } },
          select: { id: true },
        });
        // Зафиксированный месяц пересчитываем вместе с итогами, но без повторного объявления
        const result = finalized
          ? await finalizeMonth(workspaceId, period, { announce: false, actingUserId: user.id }).then(() => null)
          : await syncWorkspace(workspaceId, { periods: [period], actingUserId: user.id });
        await logAction(workspaceId, user.id, 'recalculate', { period, finalized: !!finalized });
        return NextResponse.json({ ok: true, period, result });
      }

      case 'preview': {
        const kind = body.kind === 'monthly' ? 'monthly' : 'weekly';
        const period = isValidPeriod(body.period) ? body.period : periodOf(new Date(), tz);
        const text =
          kind === 'weekly'
            ? (await buildWeeklyPost(workspaceId, settings)).text
            : await buildMonthlyPost(workspaceId, settings, period);
        return NextResponse.json({ ok: true, kind, text });
      }

      case 'publish': {
        // Текст публикации формируется только на сервере из сохранённых результатов (тот же, что в «preview»);
        // канал — только сохранённый и проверенный канал рейтинга этого пространства. Свободный текст клиента не принимается.
        if (!settings.reportChannelId) {
          return NextResponse.json({ error: 'Не выбран канал для публикации рейтинга' }, { status: 400 });
        }
        const kind = body.kind === 'monthly' ? 'monthly' : 'weekly';
        const period = isValidPeriod(body.period) ? body.period : periodOf(new Date(), tz);
        if (kind === 'monthly' && period > periodOf(new Date(), tz)) {
          return NextResponse.json({ error: 'Период ещё не наступил' }, { status: 400 });
        }
        const text =
          kind === 'weekly'
            ? (await buildWeeklyPost(workspaceId, settings)).text
            : await buildMonthlyPost(workspaceId, settings, period);
        if (!text.trim()) return NextResponse.json({ error: 'Текст публикации пуст' }, { status: 400 });
        if (text.length > MAX_POST_LENGTH) {
          return NextResponse.json({ error: `Текст длиннее ${MAX_POST_LENGTH} символов` }, { status: 400 });
        }
        const msg = await enqueuePost(workspaceId, settings, text);
        await logAction(workspaceId, user.id, 'publish', {
          kind,
          ...(kind === 'monthly' ? { period } : {}),
          channelId: settings.reportChannelId,
          channel: settings.reportChannelName,
          messageId: msg.id,
          length: text.length,
        });
        return NextResponse.json({ ok: true, messageId: msg.id, scheduledFor: msg.scheduledFor, text });
      }

      default:
        return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 });
    }
  } catch (error) {
    return errorResponse(error, 'post');
  }
}
