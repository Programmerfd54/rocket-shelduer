import { PrismaClient } from '@prisma/client';

declare global {
  var prisma: PrismaClient | undefined;
}

/**
 * В development не кэшируем клиент на global: после `prisma generate` старый singleton
 * остаётся со схемой без новых полей до полного перезапуска процесса → PrismaClientValidationError.
 * В production singleton нужен, чтобы не плодить подключения к БД.
 */
export const prisma =
  process.env.NODE_ENV === 'production'
    ? (global.prisma ?? new PrismaClient())
    : new PrismaClient();

if (process.env.NODE_ENV === 'production') {
  global.prisma = prisma;
}

export default prisma;