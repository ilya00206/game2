import type { AppContext } from '../context.js';
import { escapeHtml } from '../../content/service.js';
import { formatCurrencyAmount } from '../../core/economy/currency.js';
import { mainMenuKeyboard } from '../keyboards.js';
import { editOrReply } from '../ui.js';

export async function showMainMenu(ctx: AppContext): Promise<void> {
  const { content, config } = ctx.services;
  const [title, currency] = await Promise.all([
    content.render('ui.menu.title', ctx.appUser.id),
    config.currency(),
  ]);

  const balance = formatCurrencyAmount(ctx.appUser.currencyBalance, currency);
  const text = [
    escapeHtml(title),
    '',
    `${escapeHtml(currency.icon)} Баланс: <b>${escapeHtml(balance)}</b>`,
    `🔥 Серия: <b>${ctx.appUser.currentStreak} ${streakWord(ctx.appUser.currentStreak)}</b>`,
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
