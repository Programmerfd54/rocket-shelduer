import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import yaml from 'js-yaml';

const DEFAULT_YAML_URL =
  'https://raw.githubusercontent.com/Programmerfd54/emoji/refs/heads/main/emojis.yaml';

interface YamlEmoji {
  name: string;
  src: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;

    const workspace = await prisma.workspaceConnection.findFirst({
      where: { id: workspaceId, userId: user.id },
    });
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const yamlUrl = (body.yamlUrl as string)?.trim() || DEFAULT_YAML_URL;

    const yamlRes = await fetch(yamlUrl, { signal: AbortSignal.timeout(15000) });
    if (!yamlRes.ok) {
      return NextResponse.json(
        { error: `Не удалось загрузить каталог: ${yamlRes.statusText}` },
        { status: 502 }
      );
    }

    const yamlText = await yamlRes.text();
    const parsed = yaml.load(yamlText) as { emojis?: YamlEmoji[] };
    const emojis: YamlEmoji[] = Array.isArray(parsed?.emojis) ? parsed.emojis : [];
    const names = emojis.map((e) => e.name);

    return NextResponse.json({
      total: names.length,
      names: names.slice(0, 200),
    });
  } catch (error: any) {
    console.error('Emoji preview error:', error);
    return NextResponse.json(
      { error: error?.message || 'Не удалось загрузить каталог' },
      { status: 500 }
    );
  }
}
