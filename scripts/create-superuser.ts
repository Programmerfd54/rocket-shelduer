/**
 * Скрипт создания начального суперпользователя для деплоя (Docker и т.д.).
 * Логин: admin, пароль: admin. После первого входа смените их в настройках.
 *
 * Запуск: npx tsx scripts/create-superuser.ts
 * Docker: используйте тот же DATABASE_URL, что и приложение.
 *   Пример: docker exec -it <container> npx tsx scripts/create-superuser.ts
 * Если вход после логина не сохраняется — задайте в .env приложения COOKIE_SECURE=false (при доступе по HTTP).
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const DEFAULT_EMAIL = 'admin';
const DEFAULT_PASSWORD = 'admin';
const ROLE = 'ADMIN';

async function main() {
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({
      where: { email: DEFAULT_EMAIL },
    });
    if (existing) {
      console.log('Суперпользователь с логином "admin" уже существует. Ничего не делаем.');
      return;
    }
    const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 12);
    await prisma.user.create({
      data: {
        email: DEFAULT_EMAIL,
        password: hashedPassword,
        role: ROLE,
      },
    });
    console.log('Суперпользователь создан: логин = admin, пароль = admin.');
    console.log('Обязательно смените логин и пароль после первого входа в настройках.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
