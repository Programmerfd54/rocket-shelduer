import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { workspaceTabForbiddenResponse } from '@/lib/workspace-tab-access';
import { resolveWorkspaceForEmojiImport } from '@/lib/emoji-import-access';
import { getSafeErrorMessage, isUnsafeId } from '@/lib/security';
import { safeFetchPublic, SafeFetchError } from '@/lib/emoji-safe-fetch';
import { parseEmojiCatalog, EMOJI_CATALOG_MAX_BYTES } from '@/lib/emoji-catalog';

const DEFAULT_YAML_URL =
  'https://raw.githubusercontent.com/Programmerfd54/emoji/refs/heads/main/emojis.yaml';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;
    if (isUnsafeId(workspaceId)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    const tabDenied = await workspaceTabForbiddenResponse(user, 'emojiImport');
    if (tabDenied) return tabDenied;

    const workspace = await resolveWorkspaceForEmojiImport(user.id, workspaceId);
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const yamlUrl = (typeof body.yamlUrl === 'string' ? body.yamlUrl.trim() : '') || DEFAULT_YAML_URL;

    // SSRF: только публичные http(s)-адреса, редиректы проверяются, размер ограничен.
    let yamlRes;
    try {
      yamlRes = await safeFetchPublic(yamlUrl, { maxBytes: EMOJI_CATALOG_MAX_BYTES, timeoutMs: 15000 });
    } catch (e) {
      if (e instanceof SafeFetchError) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }
    if (!yamlRes.ok) {
      return NextResponse.json(
        { error: `Не удалось загрузить каталог: HTTP ${yamlRes.status}` },
        { status: 502 }
      );
    }

    const { emojis } = parseEmojiCatalog(new TextDecoder('utf-8', { fatal: false }).decode(yamlRes.body));
    const names = emojis.map((e) => e.name);

    return NextResponse.json({
      total: names.length,
      names: names.slice(0, 200),
    });
  } catch (error: any) {
    console.error('Emoji preview error:', error);
    return NextResponse.json(
      { error: getSafeErrorMessage(error, 'Не удалось загрузить каталог') },
      { status: 500 }
    );
  }
}
