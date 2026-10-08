/**
 * Скрипт создания начального Lead_SUP (верхняя роль) для чистого деплоя (Docker и т.д.).
 *
 * Безопасное поведение:
 *  - пользователь создаётся ТОЛЬКО если в БД ещё нет ни одного LEAD_SUP (скрипт вызывается при каждом
 *    старте контейнера — переименованный/удалённый admin не «воскресает» с известным паролем);
 *  - пароль: из SUPERUSER_PASSWORD (минимум 12 символов) или случайный, печатается один раз;
 *  - стоит requirePasswordChange: при первом входе сервер пропускает только смену пароля.
 *
 * Запуск: npx tsx scripts/create-superuser.ts
 *   SUPERUSER_LOGIN=admin  (по умолчанию "admin")
 *   SUPERUSER_PASSWORD=... (необязательно; иначе будет сгенерирован)
 * Docker: используйте тот же DATABASE_URL, что и приложение.
 *   Пример: docker exec -it <container> npx tsx scripts/create-superuser.ts
 * Если вход после логина не сохраняется — задайте в .env приложения COOKIE_SECURE=false (при доступе по HTTP).
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const DEFAULT_LOGIN = 'admin';
const ROLE = 'LEAD_SUP';
const MIN_ENV_PASSWORD_LENGTH = 12;
const FORBIDDEN_PASSWORDS = new Set(['admin', 'password', 'changeme', 'administrator']);

/** Случайный пароль: 20 символов из алфавита без похожих символов + гарантированно разные классы. */
function generatePassword(): string {
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const special = '!@#$%^&*';
  const all = lower + upper + digits + special;
  const pick = (set: string) => set[crypto.randomInt(set.length)];
  const chars = [pick(lower), pick(upper), pick(digits), pick(special)];
  while (chars.length < 20) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function resolvePassword(login: string): { password: string; generated: boolean } {
  const fromEnv = process.env.SUPERUSER_PASSWORD;
  if (fromEnv) {
    const weak =
      fromEnv.length < MIN_ENV_PASSWORD_LENGTH ||
      FORBIDDEN_PASSWORDS.has(fromEnv.toLowerCase()) ||
      fromEnv.toLowerCase() === login.toLowerCase();
    if (!weak) return { password: fromEnv, generated: false };
    console.warn(
      `SUPERUSER_PASSWORD слишком слабый (нужно ≥ ${MIN_ENV_PASSWORD_LENGTH} символов, не admin/логин) — генерируем случайный.`
    );
  }
  return { password: generatePassword(), generated: true };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const login = (process.env.SUPERUSER_LOGIN || DEFAULT_LOGIN).trim().toLowerCase();

    const existingLead = await prisma.user.findFirst({
      where: { role: ROLE },
      select: { id: true },
    });
    if (existingLead) {
      console.log('В БД уже есть пользователь с ролью LEAD_SUP. Ничего не делаем.');
      return;
    }

    const existing = await prisma.user.findUnique({
      where: { email: login },
      select: { id: true },
    });
    if (existing) {
      console.log(
        `Пользователь с логином "${login}" уже существует, но LEAD_SUP в БД нет. ` +
          'Назначьте роль вручную или задайте другой SUPERUSER_LOGIN.'
      );
      return;
    }

    const { password, generated } = resolvePassword(login);
    const hashedPassword = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: {
        email: login,
        password: hashedPassword,
        role: ROLE,
        requirePasswordChange: true,
      },
    });
    console.log(`Lead_SUP создан: логин = ${login}, роль = LEAD_SUP.`);
    if (generated) {
      console.log('Временный пароль (показывается один раз, сохраните его):');
      console.log(`  ${password}`);
    } else {
      console.log('Пароль взят из SUPERUSER_PASSWORD.');
    }
    console.log('При первом входе потребуется задать новый пароль.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
