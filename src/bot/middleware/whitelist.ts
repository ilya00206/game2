import type { NextFunction } from 'grammy';
import type { AppContext } from '../context.js';
import { env } from '../../config/env.js';
import { logger } from '../../logger.js';

const allowed = new Set(env.ALLOWED_TELEGRAM_IDS.map((id) => id.toString()));
const adminId = env.ADMIN_TELEGRAM_ID.toString();

/** Пустой список открывает доступ всем только вне production (§3.3). */
export function isAllowed(telegramId: bigint): boolean {
  const id = telegramId.toString();
  if (id === adminId) {
    return true;
  }
  if (allowed.size === 0) {
    return env.NODE_ENV !== 'production';
  }
  return allowed.has(id);
}

export async function whitelistMiddleware(
  ctx: AppContext,
  next: NextFunction,
): Promise<void> {
  const from = ctx.from;
  if (!from) {
    return;
  }

  const telegramId = BigInt(from.id);
  if (!isAllowed(telegramId)) {
    logger.warn({ telegramId: telegramId.toString() }, 'Доступ запрещён whitelist');
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: 'Этот бот личный ❤️' });
      return;
    }
    await ctx.reply('Прости, этот бот личный ❤️');
    return;
  }

  ctx.isAdmin = telegramId === env.ADMIN_TELEGRAM_ID;
  await next();
}
