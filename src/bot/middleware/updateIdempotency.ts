import { Prisma } from '@prisma/client';
import type { NextFunction } from 'grammy';
import type { AppContext } from '../context.js';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../logger.js';

/**
 * Резервирует update_id, чтобы повторная доставка не выполнялась дважды (§5.1).
 * При ошибке обработки резервирование снимается, чтобы update можно было повторить.
 */
export async function updateIdempotencyMiddleware(
  ctx: AppContext,
  next: NextFunction,
): Promise<void> {
  const updateId = BigInt(ctx.update.update_id);

  try {
    await prisma.processedTelegramUpdate.create({ data: { updateId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      logger.debug({ updateId: updateId.toString() }, 'Повторный update пропущен');
      return;
    }
    throw error;
  }

  try {
    await next();
  } catch (error) {
    await prisma.processedTelegramUpdate
      .delete({ where: { updateId } })
      .catch(() => undefined);
    throw error;
  }
}
