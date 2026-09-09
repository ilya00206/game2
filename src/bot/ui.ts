import { GrammyError } from 'grammy';
import type { InlineKeyboard } from 'grammy';
import type { AppContext } from './context.js';
import { logger } from '../logger.js';

/**
 * Редактирует текущее сообщение вместо отправки нового (§2.2).
 * Ошибка "message is not modified" ожидаема и не логируется как error.
 */
export async function editOrReply(
  ctx: AppContext,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<void> {
  const replyMarkup = keyboard ? { reply_markup: keyboard } : {};

  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...replyMarkup });
      return;
    } catch (error) {
      if (error instanceof GrammyError && error.description.includes('message is not modified')) {
        return;
      }
      logger.warn({ err: error }, 'Не удалось отредактировать сообщение, отправляю новое');
    }
  }

  await ctx.reply(text, { parse_mode: 'HTML', ...replyMarkup });
}
