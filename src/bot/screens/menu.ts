import type { AppContext } from '../context.js';
import { escapeHtml } from '../../content/service.js';
import { formatCurrencyAmount } from '../../core/economy/currency.js';
import { toLocalDate } from '../../core/time.js';
import { mainMenuKeyboard } from '../keyboards.js';
import { editOrReply } from '../ui.js';

export async function showMainMenu(ctx: AppContext): Promise<void> {
  const { content, config, admin, clock, streaks } = ctx.services;
  const today = toLocalDate(clock.now(), ctx.appUser.timezone);
  // Сверка стрика перед показом (§3.2): подтягивает пропущенные дни и списание щитов.
  const streak = await streaks.reconcile(ctx.appUser.id);
  const [title, currency, wordOfDay, earlyBooked] = await Promise.all([
    content.render('ui.menu.title', ctx.appUser.id),
    config.currency(),
    admin.getWordOfDay(today),
    streaks.hasEarlyBooking(ctx.appUser.id),
  ]);

  const balance = formatCurrencyAmount(ctx.appUser.currencyBalance, currency);
  const text = [
    escapeHtml(title),
    '',
    `${escapeHtml(currency.icon)} Баланс: <b>${escapeHtml(balance)}</b>`,
    `🔥 Серия: <b>${streak.currentStreak} ${streakWord(streak.currentStreak)}</b>`,
    `🛡️ Щиты: <b>${streak.shields}</b>`,
    ...(earlyBooked ? ['📅 Завтра забронировано — стрик защищён, даже если пропустишь день'] : []),
    ...(wordOfDay
      ? ['', `❤️ Слово дня: <b>${escapeHtml(wordOfDay.polish)}</b> — ${escapeHtml(wordOfDay.russian)}`]
      : []),
  ].join('\n');

  await editOrReply(ctx, text, mainMenuKeyboard(ctx.isAdmin));
}

function streakWord(days: number): string {
  const mod100 = days % 100;
  const mod10 = days % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'дней';
  if (mod10 === 1) return 'день';
  if (mod10 >= 2 && mod10 <= 4) return 'дня';
  return 'дней';
}
