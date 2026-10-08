/**
 * Токены приглашений: в БД (колонка InviteToken.token) хранится только sha256 от токена с префиксом
 * «sha256:». Сырой токен возвращается один раз — в ответе на создание (ссылка приглашения).
 * Старые приглашения (созданные до хеширования) хранят токен как есть — для них оставлен поиск по
 * сырому значению (legacy), но только для значений без префикса, чтобы украденный из БД хеш нельзя
 * было предъявить вместо токена.
 */
import { createHash, randomBytes } from 'crypto';
import prisma from '@/lib/prisma';

const TOKEN_BYTES = 32;
export const INVITE_TOKEN_HASH_PREFIX = 'sha256:';
/** Сырые токены — base64url (randomBytes). Legacy-поиск только для таких значений. */
const RAW_TOKEN_RE = /^[A-Za-z0-9_-]{16,256}$/;

export function hashInviteToken(rawToken: string): string {
  return INVITE_TOKEN_HASH_PREFIX + createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

/** Новый токен: raw — для ссылки (показать один раз), stored — для записи в БД. */
export function generateInviteToken(): { raw: string; stored: string } {
  const raw = randomBytes(TOKEN_BYTES).toString('base64url');
  return { raw, stored: hashInviteToken(raw) };
}

/** Значения колонки token, по которым ищем приглашение для предъявленного сырого токена. */
export function inviteTokenLookupValues(rawToken: string): string[] {
  const token = rawToken.trim();
  if (!RAW_TOKEN_RE.test(token)) return [];
  return [hashInviteToken(token), token];
}

/** Найти приглашение по сырому токену: сначала по хешу, затем (legacy) по сырому значению. */
export async function findInviteByRawToken(rawToken: string) {
  const values = inviteTokenLookupValues(rawToken);
  if (values.length === 0) return null;
  const rows = await prisma.inviteToken.findMany({ where: { token: { in: values } }, take: 2 });
  return rows.find((r) => r.token === values[0]) ?? rows.find((r) => r.token === values[1]) ?? null;
}

/**
 * Если в приглашении указан логин (email-подсказка), зарегистрироваться можно только с ним.
 * Сравнение без учёта регистра (логины в приложении хранятся в нижнем регистре).
 */
export function inviteLoginMatches(inviteEmail: string | null | undefined, login: string): boolean {
  if (!inviteEmail) return true;
  return inviteEmail.trim().toLowerCase() === login.trim().toLowerCase();
}
