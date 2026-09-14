import { GrammyError } from 'grammy';
import type { InlineKeyboard } from 'grammy';
import type { AppContext } from './context.js';
import { logger } from '../logger.js';

/**
 * Карточка с озвучкой уходит голосовым сообщением с подписью, а такое сообщение
 * нельзя отредактировать в текстовое. Поэтому её id запоминается и перед
 * следующим экраном она удаляется — в чате остаётся один активный экран.
 */
const voiceCards = new Map<number, number>();

async function deleteMessage(ctx: AppContext, messageId: number): Promise<void> {
  try {
    await ctx.api.deleteMessage(ctx.chatId!, messageId);
  } catch (error) {
    logger.warn({ err: error, messageId }, 'Не удалось удалить сообщение');
  }
}

/** Убирает предыдущую голосовую карточку; true — если она была. */
async function dropVoiceCard(ctx: AppContext): Promise<boolean> {
  const messageId = voiceCards.get(ctx.appUser.id);
  if (messageId === undefined) {
    return false;
  }

  voiceCards.delete(ctx.appUser.id);
  await deleteMessage(ctx, messageId);
  return true;
}

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
  const hadVoiceCard = await dropVoiceCard(ctx);

  if (!hadVoiceCard && ctx.callbackQuery?.message) {
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

/**
 * Экран одним голосовым сообщением с подписью: произношение и текст карточки
 * вместе. Предыдущий экран удаляется, при ошибке — откат на обычный текст.
 */
export async function replyVoice(
  ctx: AppContext,
  voiceFileId: string,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<void> {
  const replyMarkup = keyboard ? { reply_markup: keyboard } : {};
  await dropVoiceCard(ctx);

  const previous = ctx.callbackQuery?.message;
  if (previous) {
    await deleteMessage(ctx, previous.message_id);
  }

  try {
    const message = await ctx.api.sendVoice(ctx.chatId!, voiceFileId, {
      caption: text,
      parse_mode: 'HTML',
      ...replyMarkup,
    });
    voiceCards.set(ctx.appUser.id, message.message_id);
  } catch (error) {
    logger.warn({ err: error }, 'Не удалось отправить озвучку, показываю карточку текстом');
    await ctx.reply(text, { parse_mode: 'HTML', ...replyMarkup });
  }
}
