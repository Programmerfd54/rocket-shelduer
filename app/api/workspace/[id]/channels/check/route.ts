import { NextResponse } from 'next/server';
import { isUnsafeId } from '@/lib/security';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/api-auth';
import { RocketChatClient } from '@/lib/rocketchat';
import { getEffectiveConnectionForRc } from '@/lib/workspace-rc';
import { rcNotConnectedResponse } from '@/lib/rc-http';

/** Допустимое имя канала RC: буквы (в т.ч. кириллица), цифры, точка, дефис, подчёркивание. */
const CHANNEL_NAME_RE = /^[\p{L}\p{N}._-]{1,100}$/u;

type CheckStatus = 'found' | 'not_found' | 'unknown';

/** Ошибка RC «комната не найдена» (в разных версиях — разные тексты/коды). */
function isNotFound(error?: string): boolean {
  const e = (error || '').toLowerCase();
  return e.includes('not-found') || e.includes('not found') || e.includes('does not exist') || e.includes('error-room');
}

/**
 * GET /api/workspace/[id]/channels/check?name=support
 * Проверяет, существует ли канал (публичный или приватный) в Rocket.Chat этого пространства.
 * Ответ: { status: 'found' | 'not_found' | 'unknown', kind?: 'public' | 'private', displayName?, message? }
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    if (isUnsafeId(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    const raw = new URL(request.url).searchParams.get('name') ?? '';
    const name = raw.trim().replace(/^#/, '').replace(/\s+/g, '_');

    if (!name) return NextResponse.json({ error: 'Укажите название канала' }, { status: 400 });
    if (!CHANNEL_NAME_RE.test(name)) {
      return NextResponse.json({ error: 'Название канала может содержать только буквы, цифры, точку, дефис и подчёркивание' }, { status: 400 });
    }

    let workspace = await prisma.workspaceConnection.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!workspace) {
      const assignment = await prisma.workspaceAdminAssignment.findFirst({ where: { workspaceId: id, userId: user.id } });
      if (assignment) workspace = await prisma.workspaceConnection.findUnique({ where: { id }, select: { id: true } });
    }
    if (!workspace) return NextResponse.json({ error: 'Пространство не найдено' }, { status: 404 });

    const effective = await getEffectiveConnectionForRc(user.id, id);
    if (!effective?.authToken || !effective.userId_RC) return rcNotConnectedResponse();

    const rc = new RocketChatClient(effective.workspaceUrl);
    const pub = await rc.getRoomInfoByName(effective.authToken, effective.userId_RC, name, false);
    if (pub.room) {
      return NextResponse.json({
        status: 'found' satisfies CheckStatus,
        kind: 'public',
        displayName: pub.room.fname || pub.room.name || name,
        readOnly: !!pub.room.ro,
      });
    }
    const priv = await rc.getRoomInfoByName(effective.authToken, effective.userId_RC, name, true);
    if (priv.room) {
      return NextResponse.json({
        status: 'found' satisfies CheckStatus,
        kind: 'private',
        displayName: priv.room.fname || priv.room.name || name,
        readOnly: !!priv.room.ro,
      });
    }

    if (isNotFound(pub.error) && isNotFound(priv.error)) {
      return NextResponse.json({ status: 'not_found' satisfies CheckStatus });
    }
    // Приватные каналы, в которых вы не состоите, RC скрывает — честно говорим, что проверить не удалось.
    return NextResponse.json({
      status: 'unknown' satisfies CheckStatus,
      message: pub.error || priv.error || 'Не удалось получить ответ от Rocket.Chat',
    });
  } catch (error: any) {
    if (error?.message === 'Unauthorized') return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
    console.error('Channel check error:', error);
    return NextResponse.json({ error: 'Не удалось проверить канал' }, { status: 500 });
  }
}
