import type { AppContext } from '../context.js';
import { formatCurrency } from '../../core/economy/currency.js';
import { mainMenuKeyboard } from '../keyboards.js';
import { editOrReply } from '../ui.js';

export async function showMainMenu(ctx: AppContext): Promise<void> {
  const { content, config } = ctx.services;
  const [title, currency] = await Promise.all([
    content.render('ui.menu.title', ctx.appUser.id),
    config.currency(),
  ]);

  const balance = formatCurrency(ctx.appUser.currencyBalance, currency);
  const text = `${title}\n\nБаланс: ${balance}\n🔥 Серия: ${ctx.appUser.currentStreak}`;

  await editOrReply(ctx, text, mainMenuKeyboard(ctx.isAdmin));
}
