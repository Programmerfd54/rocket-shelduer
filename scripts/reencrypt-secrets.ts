/**
 * Перешифровка секретов подключений в формат v2 текущим ключом (ENCRYPTION_KEY).
 *
 *   npx tsx scripts/reencrypt-secrets.ts            # перешифровать
 *   npx tsx scripts/reencrypt-secrets.ts --dry-run  # только посчитать, ничего не записывать
 *
 * Что делает (идемпотентно — повторный запуск ничего не меняет):
 *  - WorkspaceConnection.authToken       → v2 'rc-auth-token', AAD ws:<userId> (в т.ч. legacy plaintext и v1 `enc:`)
 *  - WorkspaceConnection.encryptedPassword → v2 'rc-password',  AAD ws:<userId> ('' — пароль не хранится, пропуск)
 *  - WorkspaceSettings.ldapBindPass / smtpPass → v2 'workspace-settings-secret', AAD wss:<workspaceId>
 * Для каждой строки: расшифровать (любым известным ключом: ENCRYPTION_KEY + ENCRYPTION_KEY_PREVIOUS) →
 * зашифровать v2 → расшифровать снова и сравнить ДО записи → записать с оптимистичным условием
 * (where: старое значение), чтобы не затереть параллельное изменение.
 *
 * Ротация ключа: ENCRYPTION_KEY=<новый>, ENCRYPTION_KEY_PREVIOUS=<старый>, запустить скрипт,
 * убедиться, что undecryptable = 0, затем убрать старый ключ из ENCRYPTION_KEY_PREVIOUS.
 *
 * Печатает только счётчики и id строк, которые не удалось расшифровать (значения — никогда).
 * Код выхода 0, даже если часть строк не расшифровалась (такие подключения нужно переподключить);
 * 1 — только при фатальной ошибке (нет ключа в production, нет доступа к БД).
 */
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import {
  connectionAad,
  workspaceSettingsAad,
  decryptAuthToken,
  encryptAuthToken,
  decryptPassword,
  encryptPassword,
  decryptSettingsSecret,
  encryptSettingsSecret,
  isBoundV2,
  isCurrentV2,
  type SecretPurpose,
} from '../lib/encryption';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH = 200;

type Counters = { total: number; upToDate: number; upgraded: number; emptied: number; undecryptable: number; conflicts: number; errors: number };
const newCounters = (): Counters => ({ total: 0, upToDate: 0, upgraded: 0, emptied: 0, undecryptable: 0, conflicts: 0, errors: 0 });

function sameSecret(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function isUpToDate(stored: string, purpose: SecretPurpose): boolean {
  return isCurrentV2(stored, purpose) && isBoundV2(stored);
}

type Plan = { kind: 'skip' } | { kind: 'ok' } | { kind: 'write'; value: string; emptied?: boolean } | { kind: 'undecryptable' };

/** Решение по одному значению: перешифровать (с проверкой обратной расшифровки) или оставить. */
function planValue(
  stored: string | null,
  purpose: SecretPurpose,
  decrypt: (v: string) => string | null,
  encrypt: (v: string) => string,
  emptyAllowed: boolean
): Plan {
  if (stored == null || stored === '') return { kind: 'skip' };
  if (isUpToDate(stored, purpose)) return { kind: 'ok' };
  const plain = decrypt(stored);
  if (plain == null) return { kind: 'undecryptable' };
  if (plain === '') return emptyAllowed ? { kind: 'write', value: '', emptied: true } : { kind: 'undecryptable' };
  const next = encrypt(plain);
  const check = decrypt(next);
  if (check == null || !sameSecret(check, plain)) throw new Error('verification failed');
  return { kind: 'write', value: next };
}

function apply(c: Counters, plan: Plan): void {
  if (plan.kind === 'ok') c.upToDate++;
  else if (plan.kind === 'undecryptable') c.undecryptable++;
  else if (plan.kind === 'write') {
    if (plan.emptied) c.emptied++;
    else c.upgraded++;
  }
}

async function reencryptConnections(prisma: PrismaClient) {
  const tokens = newCounters();
  const passwords = newCounters();
  const needReconnect = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.workspaceConnection.findMany({
      select: { id: true, userId: true, authToken: true, encryptedPassword: true },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      tokens.total++;
      passwords.total++;
      const aad = connectionAad(row.userId);
      let tokenPlan: Plan;
      let passwordPlan: Plan;
      try {
        tokenPlan = planValue(
          row.authToken,
          'rc-auth-token',
          (v) => decryptAuthToken(v, aad),
          (v) => encryptAuthToken(v, aad),
          false
        );
      } catch {
        tokens.errors++;
        tokenPlan = { kind: 'skip' };
      }
      try {
        passwordPlan = planValue(
          row.encryptedPassword,
          'rc-password',
          (v) => {
            try {
              return decryptPassword(v, aad);
            } catch {
              return null;
            }
          },
          (v) => encryptPassword(v, aad),
          true
        );
      } catch {
        passwords.errors++;
        passwordPlan = { kind: 'skip' };
      }
      if (tokenPlan.kind === 'undecryptable') needReconnect.add(row.id);

      const data: { authToken?: string; encryptedPassword?: string } = {};
      if (tokenPlan.kind === 'write') data.authToken = tokenPlan.value;
      if (passwordPlan.kind === 'write') data.encryptedPassword = passwordPlan.value;

      if (Object.keys(data).length === 0 || DRY_RUN) {
        apply(tokens, tokenPlan);
        apply(passwords, passwordPlan);
        continue;
      }
      try {
        const res = await prisma.workspaceConnection.updateMany({
          where: { id: row.id, authToken: row.authToken, encryptedPassword: row.encryptedPassword },
          data,
        });
        if (res.count === 1) {
          apply(tokens, tokenPlan);
          apply(passwords, passwordPlan);
        } else {
          // Строку изменили параллельно (переподключение и т.п.) — новое значение уже записано приложением
          tokens.conflicts++;
        }
      } catch {
        tokens.errors++;
      }
    }
  }
  return { tokens, passwords, needReconnect };
}

async function reencryptSettings(prisma: PrismaClient) {
  const c = newCounters();
  const rows = await prisma.workspaceSettings.findMany({
    where: { OR: [{ ldapBindPass: { not: null } }, { smtpPass: { not: null } }] },
    select: { id: true, workspaceId: true, ldapBindPass: true, smtpPass: true },
  });
  for (const row of rows) {
    const aad = workspaceSettingsAad(row.workspaceId);
    const dec = (v: string) => {
      try {
        return decryptSettingsSecret(v, aad);
      } catch {
        return null;
      }
    };
    const enc = (v: string) => encryptSettingsSecret(v, aad);
    const data: { ldapBindPass?: string | null; smtpPass?: string | null } = {};
    const plans: Plan[] = [];
    for (const field of ['ldapBindPass', 'smtpPass'] as const) {
      c.total++;
      let plan: Plan;
      try {
        plan = planValue(row[field], 'workspace-settings-secret', dec, enc, true);
      } catch {
        c.errors++;
        continue;
      }
      if (plan.kind === 'skip') {
        c.total--;
        continue;
      }
      if (plan.kind === 'write') data[field] = plan.emptied ? null : plan.value;
      plans.push(plan);
    }
    if (Object.keys(data).length === 0 || DRY_RUN) {
      plans.forEach((p) => apply(c, p));
      continue;
    }
    try {
      const res = await prisma.workspaceSettings.updateMany({
        where: { id: row.id, ldapBindPass: row.ldapBindPass, smtpPass: row.smtpPass },
        data,
      });
      if (res.count === 1) plans.forEach((p) => apply(c, p));
      else c.conflicts++;
    } catch {
      c.errors++;
    }
  }
  return c;
}

function fmt(name: string, c: Counters): string {
  return (
    `${name}: total=${c.total} up-to-date=${c.upToDate} ${DRY_RUN ? 'would-upgrade' : 'upgraded'}=${c.upgraded}` +
    ` emptied=${c.emptied} undecryptable=${c.undecryptable} conflicts=${c.conflicts} errors=${c.errors}`
  );
}

async function main() {
  // Без ключа в production шифрование падает — сразу выходим (не трогаем данные)
  try {
    encryptAuthToken('probe');
  } catch {
    console.error('[reencrypt] ENCRYPTION_KEY is not configured — nothing done.');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const started = Date.now();
    const conn = await reencryptConnections(prisma);
    const settings = await reencryptSettings(prisma);
    console.log(`[reencrypt]${DRY_RUN ? ' (dry run)' : ''} done in ${Date.now() - started} ms`);
    console.log(`[reencrypt] ${fmt('rc auth tokens', conn.tokens)}`);
    console.log(`[reencrypt] ${fmt('rc passwords', conn.passwords)}`);
    console.log(`[reencrypt] ${fmt('ldap/smtp secrets', settings)}`);
    if (conn.needReconnect.size > 0) {
      const ids = [...conn.needReconnect].slice(0, 50).join(', ');
      console.log(
        `[reencrypt] ${conn.needReconnect.size} connection(s) have an unreadable token (unknown key?) and need reconnect: ${ids}`
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  // Только тип ошибки — без сообщений, которые могли бы содержать данные
  console.error(`[reencrypt] fatal: ${e instanceof Error ? e.name : 'unknown error'}`);
  process.exit(1);
});
