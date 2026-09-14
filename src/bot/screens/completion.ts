import { InlineKeyboard } from 'grammy';
import type { AppContext } from '../context.js';
import type { CompletionSummary, TestSummaryItem } from '../../core/learning/sessionService.js';
import { formatCurrency, currencyNamePlural } from '../../core/economy/currency.js';
import { findStreakTitle, isStreakMilestone } from '../../content/streakTitles.js';
import { escapeHtml } from '../../content/service.js';
import { CALLBACK } from '../keyboards.js';
import { backToMenuKeyboard } from '../keyboards.js';
import { editOrReply } from '../ui.js';

/** Саммари теста: что правильно/неправильно и какие были ответы. */
function renderTestSummary(items: TestSummaryItem[]): string {
  const correctCount = items.filter((item) => item.isCorrect).length;

  const lines = items.map((item, index) => {
    const mark = item.isCorrect ? '✅' : '❌';
    const word = `<b>${escapeHtml(item.polish)}</b> — ${escapeHtml(item.correctRussian)}`;
    const yourAnswer =
      !item.isCorrect && item.selectedRussian
        ? ` (твой ответ: ${escapeHtml(item.selectedRussian)})`
        : '';
    return `${index + 1}. ${mark} ${word}${yourAnswer}`;
  });

  return [`🎯 <b>Результаты теста: ${correctCount}/${items.length}</b>`, ...lines].join('\n');
}

/**
 * Стрик, веха, рекорд и титул идут одним сообщением в фиксированном порядке (§3.2).
 * Щит и сюрприз отправляются отдельными сообщениями.
 */
export async function showCompletion(
  ctx: AppContext,
  summary: CompletionSummary,
  options: { editCurrent?: boolean } = {},
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

  if (options.editCurrent === false) {
    await ctx.reply(blocks.join('\n\n'), {
      parse_mode: 'HTML',
      reply_markup: backToMenuKeyboard(),
    });
  } else {
    await editOrReply(ctx, blocks.join('\n\n'), backToMenuKeyboard());
  }

  if (summary.testSummary) {
    await ctx.reply(renderTestSummary(summary.testSummary), { parse_mode: 'HTML' });
  }

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
