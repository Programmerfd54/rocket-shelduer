import { NextResponse } from 'next/server';

/** Коды undici/Node при недоступности хоста RC. */
export function getFetchFailureCode(err: unknown): string | undefined {
  const visited = new Set<unknown>();
  let current = err;
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    if ('code' in current && current.code) return String(current.code);
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

export function isRcNetworkFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code = getFetchFailureCode(err);
  return (
    msg.includes('fetch failed') ||
    msg.includes('Connection timeout') ||
    msg.includes('TimeoutError') ||
    msg.includes('timed out') ||
    msg.includes('Network error') ||
    msg.includes('Cannot connect to Rocket.Chat') ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError'))
  );
}

export function hostFromWorkspaceUrl(url: string): string {
  try {
    return new URL(url.replace(/\/$/, '') || url).host;
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }
}

export function rcUnreachableResponse(workspaceUrl: string, err?: unknown) {
  const host = hostFromWorkspaceUrl(workspaceUrl);
  const code = getFetchFailureCode(err);
  const isTimeout =
    code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT' ||
    (err instanceof Error && /timeout|timed out/i.test(err.message)) ||
    (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError'));

  return NextResponse.json(
    {
      code: 'RC_UNREACHABLE' as const,
      error: isTimeout
        ? `Сервер Rocket.Chat не отвечает (${host}): таймаут подключения.`
        : `Не удалось подключиться к Rocket.Chat (${host}).`,
      details: isTimeout
        ? 'Проверьте VPN или сеть школы, доступность сервера и URL пространства. Инстансы *.21-school.ru с локального компьютера часто доступны только из корпоративной сети.'
        : 'Проверьте URL пространства и что сервер Rocket.Chat запущен и доступен из вашей сети.',
      host,
      failureCode: code,
    },
    { status: 503 }
  );
}
