import { NextResponse } from 'next/server';
import { isUnsafeId } from '@/lib/security';
import { requireAuth } from '@/lib/api-auth';
import { RocketChatClient } from '@/lib/rocketchat';
import { rcNotConnectedResponse } from '@/lib/rc-http';
import { isRcNetworkFailure } from '@/lib/rc-network';
import { resolveEmojiWorkspace } from '@/lib/emoji-workspace';

/**
 * Кастомные эмодзи воркспейса Rocket.Chat.
 * Успех:  200 { emojis, workspaceUrl }
 * Ошибка RC (сеть, 401 токена RC, и т.п.): 502 { emojis: [], workspaceUrl, error, code }
 *   — клиент отличает «эмодзи нет» (пустой список, 200) от «не удалось загрузить» (поле error).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    if (isUnsafeId(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

    const access = await resolveEmojiWorkspace(user.id, id);
    if (!access) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }
    if (!access.auth) {
      return rcNotConnectedResponse({ emojis: [], workspaceUrl: access.workspaceUrl });
    }

    try {
      const rcClient = new RocketChatClient(access.workspaceUrl);
      // fetchCustomEmojis бросает ошибку при сбое (в отличие от getEmojis, который глотает её и отдаёт []).
      const emojis = await rcClient.fetchCustomEmojis(
        access.auth.authToken,
        access.auth.userId_RC
      );

      return NextResponse.json(
        {
          emojis: emojis.map((emoji) => ({
            _id: emoji._id,
            name: emoji.name,
            aliases: emoji.aliases || [],
            extension: emoji.extension || 'png',
            _updatedAt: emoji._updatedAt,
          })),
          workspaceUrl: access.workspaceUrl, // Для построения URL изображений
        },
        { headers: { 'Cache-Control': 'private, max-age=30' } }
      );
    } catch (rcError: unknown) {
      const message = rcError instanceof Error ? rcError.message : String(rcError);
      console.error('Rocket.Chat emojis error:', message);
      const network = isRcNetworkFailure(rcError);
      const unauthorized = /unauthorized|You must be logged in/i.test(message);
      return NextResponse.json(
        {
          emojis: [],
          workspaceUrl: access.workspaceUrl,
          error: network
            ? 'Сервер Rocket.Chat недоступен'
            : unauthorized
              ? 'Сессия Rocket.Chat истекла — подключитесь к пространству заново'
              : message || 'Не удалось получить эмодзи',
          code: network ? 'RC_UNREACHABLE' : unauthorized ? 'RC_UNAUTHORIZED' : 'RC_EMOJIS_FAILED',
        },
        { status: 502, headers: { 'Cache-Control': 'no-store' } }
      );
    }
  } catch (error) {
    console.error('Get emojis error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch emojis' },
      { status: 500 }
    );
  }
}
