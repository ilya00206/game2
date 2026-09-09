import { InlineKeyboard } from 'grammy';
import type { AppContext } from '../context.js';
import type { CompletionSummary } from '../../core/learning/sessionService.js';
import { formatCurrency, currencyNamePlural } from '../../core/economy/currency.js';
import { findStreakTitle, isStreakMilestone } from '../../content/streakTitles.js';
import { CALLBACK } from '../keyboards.js';
import { backToMenuKeyboard } from '../keyboards.js';
import { editOrReply } from '../ui.js';

/**
 * Стрик, веха, рекорд и титул идут одним сообщением в фиксированном порядке (§3.2).
 * Щит и сюрприз отправляются отдельными сообщениями.
 */
export async function showCompletion(
  ctx: AppContext,
  summary: CompletionSummary,
): Promise<void> {
  const { content, config } = ctx.services;
  const userId = ctx.appUser.id;
  const currency = await config.currency();
  const { streak, reward, surprise } = summary;

  const blocks: string[] = [await content.render('praise.session_finished', userId)];

  if (streak.increasedToday) {
    blocks.push(await content.render('streak.current', userId, { streak: streak.currentStreak }));

    if (isStreakMilestone(streak.currentStreak)) {
      blocks.push(
        await content.render('streak.milestone', userId, { streak: streak.currentStreak }),
      );
    }

    if (streak.isNewRecord) {
      blocks.push(await content.render('streak.record', userId, { streak: streak.maxStreak }));
    }

    const title = findStreakTitle(streak.currentStreak);
    if (title) {
      blocks.push(`🏅 ${title}`);
    }
  } else if (streak.missedDates.length > 0) {
    blocks.push(await content.render('streak.lost', userId));
  }

  if (reward.granted) {
    blocks.push(`+${formatCurrency(reward.amount, currency)}`);
  } else if (reward.reason === 'LIMIT_REACHED') {
    blocks.push(
      await content.render('ui.session.limit_reached', userId, {
        currency: currencyNamePlural(currency),
      }),
    );
  }

  await editOrReply(ctx, blocks.join('\n\n'), backToMenuKeyboard());

  if (streak.shieldedDates.length > 0) {
    await ctx.reply(await content.render('streak.shield_used', userId));
  }

  if (surprise.granted) {
    await ctx.reply(
      await content.render('surprise.random', userId, {
        amount: surprise.amount,
        currency: currencyNamePlural(currency),
      }),
    );
  }

  if (summary.offerEarlyStreak) {
    const keyboard = new InlineKeyboard()
      .text('Активировать', CALLBACK.streakEarlyActivate)
      .text('Не сейчас', CALLBACK.menuRoot);

    await ctx.reply(await content.render('streak.early_offer', userId), {
      reply_markup: keyboard,
    });
  }
}

export async function activateEarlyStreak(ctx: AppContext): Promise<void> {
  const result = await ctx.services.streaks.bookEarly(ctx.appUser.id);

  if (!result.ok) {
    const text =
      result.reason === 'ALREADY_BOOKED'
        ? 'Завтрашний день уже закрыт заранее ❤️'
        : 'Для этого нужно пройти сегодня три полные сессии.';
    await editOrReply(ctx, text, backToMenuKeyboard());
    return;
  }

  const text = await ctx.services.content.render('streak.early_activated', ctx.appUser.id);
  await editOrReply(ctx, text, backToMenuKeyboard());
}
