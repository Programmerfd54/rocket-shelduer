/**
 * Защита от SSRF: блокировка внутренних и опасных URL.
 * Используется при добавлении workspaceUrl и перед вызовами Rocket.Chat API.
 */

const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  '0.0.0.0.0',
]);

const BLOCKED_PREFIXES = [
  '10.',      // 10.0.0.0/8
  '172.16.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.', '172.22.', '172.23.',
  '172.24.', '172.25.', '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.', // 172.16.0.0/12
  '192.168.', // 192.168.0.0/16
  '169.254.', // link-local
  '127.',     // 127.0.0.0/8
];

function isBlockedIp(host: string): boolean {
  if (BLOCKED_HOSTS.has(host.toLowerCase())) return true;
  for (const p of BLOCKED_PREFIXES) {
    if (host.startsWith(p)) return true;
  }
  return false;
}

/**
 * Проверяет URL на SSRF. Возвращает true, если URL опасен (внутренний/локальный).
 */
export function isSsrfUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return true;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return true;
  }
  const host = parsed.hostname || parsed.host || '';
  if (!host) return true;
  const lower = host.toLowerCase();
  if (BLOCKED_HOSTS.has(lower)) return true;
  if (lower.endsWith('.localhost') || lower.endsWith('.local')) return true;
  if (isBlockedIp(host)) return true;
  if (/^\[?[0-9a-f:]+]?$/i.test(host)) {
    // IPv6
    const normalized = host.replace(/^\[|\]$/g, '');
    if (normalized === '::1' || normalized.startsWith('fd') || normalized.startsWith('fe80')) return true;
  }
  return false;
}

/**
 * Безопасная проверка workspaceUrl. Выбрасывает, если SSRF.
 */
export function assertSafeWorkspaceUrl(url: string | null | undefined): void {
  if (isSsrfUrl(url)) {
    throw new Error('Invalid workspace URL: internal or private addresses are not allowed');
  }
}
