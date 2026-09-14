import { InlineKeyboard } from 'grammy';
import type { AppContext } from '../context.js';
import { SHOP_ITEMS } from '../../core/economy/config.js';
import { formatCurrency } from '../../core/economy/currency.js';
import { SHOP_ITEM_TITLES } from '../../core/economy/shopService.js';
import { backToMenuKeyboard, buyCallback, CALLBACK } from '../keyboards.js';
import { editOrReply } from '../ui.js';
import { logger } from '../../logger.js';

export async function showShop(ctx: AppContext): Promise<void> {
  const { shop, config } = ctx.services;
  const [state, prices, currency] = await Promise.all([
    shop.state(ctx.appUser.id),
    shop.prices(),
    config.currency(),
  ]);

  const keyboard = new InlineKeyboard();
  for (const item of SHOP_ITEMS) {
    keyboard.text(`${SHOP_ITEM_TITLES[item]} · ${prices[item]}${currency.icon}`, buyCallback(item));
    keyboard.row();
  }
  keyboard.text('⬅️ В меню', CALLBACK.menuRoot);

  const text = [
    `Баланс: <b>${formatCurrency(state.balance, currency)}</b>`,
    `Щитов на руках: <b>${state.shields}</b>`,
    '',
    'Что выберем?',
  ].join('\n');

  await editOrReply(ctx, text, keyboard);
}

export async function handlePurchase(
  ctx: AppContext,
  item: ShopItem,
  requestId: string,
): Promise<void> {
  const result = await ctx.services.shop.buy(ctx.appUser.id, item, requestId);
  const currency = await ctx.services.config.currency();

  if (!result.ok) {
    if (result.reason === 'INSUFFICIENT_FUNDS') {
      await editOrReply(
        ctx,
        'Пока не хватает — но ты уже близко ❤️ Позанимаемся ещё?',
        backToMenuKeyboard(),
      );
    }
    return;
  }

  await editOrReply(
    ctx,
    `${SHOP_ITEM_TITLES[item]} — твой ❤️\n\nОстаток: <b>${formatCurrency(result.balanceAfter, currency)}</b>`,
    backToMenuKeyboard(),
  );

  // Telegram вызывается уже после коммита; сбой отправки не откатывает покупку (§5.1).
  try {
    await ctx.api.sendMessage(
      ctx.services.adminTelegramId.toString(),
      `🛍️ Покупка: ${SHOP_ITEM_TITLES[item]} за ${result.cost}. Остаток: ${result.balanceAfter}.`,
    );
  } catch (error) {
    logger.error({ err: error, item }, 'Не удалось уведомить админа о покупке');
  }
}
