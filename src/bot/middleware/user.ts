import type { NextFunction } from 'grammy';
import type { AppContext } from '../context.js';
import { prisma } from '../../db/prisma.js';
import { schedulerRegistry } from '../../scheduler/registry.js';

const USER_FIELDS = {
  id: true,
  telegramId: true,
  timezone: true,
  reminderHour: true,
  currencyBalance: true,
  currentStreak: true,
  maxStreak: true,
  shields: true,
} as const;

/** Создаёт пользователя при первом обращении и держит реестр планировщика в актуальном виде. */
export async function userMiddleware(ctx: AppContext, next: NextFunction): Promise<void> {
  const from = ctx.from;
  if (!from) {
    return;
  }

  const telegramId = BigInt(from.id);
  const user = await prisma.user.upsert({
    where: { telegramId },
    create: { telegramId },
    update: {},
    select: USER_FIELDS,
  });

  ctx.appUser = user;
  schedulerRegistry.upsert({
    userId: user.id,
    telegramId: user.telegramId,
    timezone: user.timezone,
    reminderHour: user.reminderHour,
  });

  await next();
}
