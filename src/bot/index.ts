import { Bot } from 'grammy';
import type { AppContext } from './context.js';
import { env } from '../config/env.js';
import { logger } from '../logger.js';
import type { Services } from '../services.js';
import { CALLBACK } from './keyboards.js';
import { updateIdempotencyMiddleware } from './middleware/updateIdempotency.js';
import { userMiddleware } from './middleware/user.js';
import { whitelistMiddleware } from './middleware/whitelist.js';
import { showMainMenu } from './screens/menu.js';
import { activateEarlyStreak } from './screens/completion.js';
import { handlePurchase, showShop } from './screens/shop.js';
import { setReminderHour, showSettings } from './screens/settings.js';
import {
  deactivateCategory,
  deactivateWord,
  promptAddWord,
  promptNewCategory,
  showAddWordMenu,
  showMyContent,
} from './screens/vocabulary.js';
import { handleTextInput } from './textInput.js';
import {
  confirmAdminAction,
  isContentKey,
  promptCurrencyEdit,
  promptEconomyEdit,
  promptGrant,
  promptMessage,
  promptStreak,
  promptWordOfDay,
  showAdminMenu,
  showCurrencyConfig,
  showEconomyConfig,
  showTextGroups,
  showTextKeys,
  showTextVariants,
  showUserCard,
  showUsers,
  showWordOfDay,
} from './screens/admin.js';
import { pendingInput } from './state.js';
import type { ShopItem } from '../core/economy/config.js';
import {
  handleAnswer,
  handleFinish,
  handleTestAnswer,
  resumeSession,
  showCategorySummary,
  showLearnMenu,
  startSession,
  startTest,
} from './screens/learn.js';

/** Обрабатываются только эти типы update — лишние не запрашиваются (§2.2). */
export const ALLOWED_UPDATES = ['message', 'callback_query'] as const;

export function createBot(services: Services): Bot<AppContext> {
  const bot = new Bot<AppContext>(env.TELEGRAM_BOT_TOKEN);

  bot.use((ctx, next) => {
    ctx.services = services;
    ctx.isAdmin = false;
    return next();
  });

  bot.use(updateIdempotencyMiddleware);
  bot.use(whitelistMiddleware);
  bot.use(userMiddleware);

  bot.command('start', async (ctx) => {
    await showMainMenu(ctx);
  });

  bot.command('menu', async (ctx) => {
    await showMainMenu(ctx);
  });

  bot.callbackQuery(CALLBACK.menuRoot, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMainMenu(ctx);
  });

  bot.callbackQuery(CALLBACK.menuLearn, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showLearnMenu(ctx);
  });

  bot.callbackQuery(/^learn:cat:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showCategorySummary(ctx, Number(ctx.match[1]));
  });

  bot.callbackQuery(/^learn:dir:(\d+):(PL_RU|RU_PL)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await startSession(ctx, Number(ctx.match[1]), ctx.match[2] as 'PL_RU' | 'RU_PL');
  });

  bot.callbackQuery(CALLBACK.sessionResume, async (ctx) => {
    await ctx.answerCallbackQuery();
    await resumeSession(ctx);
  });

  bot.callbackQuery(/^card:ans:(\d+):(KNOW|UNKNOWN)$/, async (ctx) => {
    // callback_query.id уникален для нажатия и служит ключом идемпотентности (§5.1).
    const actionId = ctx.callbackQuery.id;
    await ctx.answerCallbackQuery();
    await handleAnswer(ctx, Number(ctx.match[1]), ctx.match[2] as 'KNOW' | 'UNKNOWN', actionId);
  });

  bot.callbackQuery(CALLBACK.testStart, async (ctx) => {
    await ctx.answerCallbackQuery();
    await startTest(ctx);
  });

  bot.callbackQuery(/^card:opt:(\d+):([0-3])$/, async (ctx) => {
    const actionId = ctx.callbackQuery.id;
    await ctx.answerCallbackQuery();
    await handleTestAnswer(ctx, Number(ctx.match[1]), Number(ctx.match[2]), actionId);
  });

  bot.callbackQuery(CALLBACK.sessionFinish, async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleFinish(ctx);
  });

  bot.callbackQuery(CALLBACK.menuAddWord, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showAddWordMenu(ctx);
  });

  bot.callbackQuery(CALLBACK.vocabularyNewCategory, async (ctx) => {
    await ctx.answerCallbackQuery();
    await promptNewCategory(ctx);
  });

  bot.callbackQuery(/^vocab:add:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await promptAddWord(ctx, Number(ctx.match[1]));
  });

  bot.callbackQuery(CALLBACK.vocabularyMine, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMyContent(ctx);
  });

  bot.callbackQuery(/^vocab:del_word:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await deactivateWord(ctx, Number(ctx.match[1]));
  });

  bot.callbackQuery(/^vocab:del_cat:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await deactivateCategory(ctx, Number(ctx.match[1]));
  });

  bot.on('message:text', async (ctx) => {
    await handleTextInput(ctx, ctx.message.text);
  });

  bot.callbackQuery(CALLBACK.menuShop, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showShop(ctx);
  });

  bot.callbackQuery(/^shop:buy:(GIFT_SMALL|GIFT_SPECIAL|SHIELD)$/, async (ctx) => {
    const requestId = ctx.callbackQuery.id;
    await ctx.answerCallbackQuery();
    await handlePurchase(ctx, ctx.match[1] as ShopItem, requestId);
  });

  bot.callbackQuery(CALLBACK.streakEarlyActivate, async (ctx) => {
    await ctx.answerCallbackQuery();
    await activateEarlyStreak(ctx);
  });

  bot.callbackQuery(CALLBACK.menuSettings, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showSettings(ctx);
  });

  bot.callbackQuery(/^settings:hour:(\d{1,2})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await setReminderHour(ctx, Number(ctx.match[1]));
  });

  bot.callbackQuery(CALLBACK.menuAdmin, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.isAdmin) {
      return;
    }
    await showAdminMenu(ctx);
  });

  // Все админские callback проходят одну проверку прав (§4.8).
  bot.callbackQuery(/^admin:/, async (ctx, next) => {
    if (!ctx.isAdmin) {
      await ctx.answerCallbackQuery();
      return;
    }
    await next();
  });

  bot.callbackQuery(CALLBACK.adminUsers, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showUsers(ctx);
  });

  bot.callbackQuery(/^admin:user:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showUserCard(ctx, Number(ctx.match[1]));
  });

  bot.callbackQuery(/^admin:grant:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await promptGrant(ctx, Number(ctx.match[1]));
  });

  bot.callbackQuery(/^admin:streak:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await promptStreak(ctx, Number(ctx.match[1]));
  });

  bot.callbackQuery(/^admin:msg:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await promptMessage(ctx, Number(ctx.match[1]));
  });

  bot.callbackQuery(CALLBACK.adminConfirm, async (ctx) => {
    const requestId = ctx.callbackQuery.id;
    await ctx.answerCallbackQuery();
    await confirmAdminAction(ctx, requestId);
  });

  bot.callbackQuery(CALLBACK.adminCurrency, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showCurrencyConfig(ctx);
  });

  bot.callbackQuery(CALLBACK.adminCurrencyEdit, async (ctx) => {
    await ctx.answerCallbackQuery();
    await promptCurrencyEdit(ctx);
  });

  bot.callbackQuery(CALLBACK.adminEconomy, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showEconomyConfig(ctx);
  });

  bot.callbackQuery(/^admin:econ:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await promptEconomyEdit(ctx, ctx.match[1] as string);
  });

  bot.callbackQuery(CALLBACK.adminTexts, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showTextGroups(ctx);
  });

  bot.callbackQuery(/^admin:tgroup:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showTextKeys(ctx, ctx.match[1] as string);
  });

  bot.callbackQuery(/^admin:tkey:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const key = ctx.match[1] as string;
    if (isContentKey(key)) {
      await showTextVariants(ctx, key);
    }
  });

  bot.callbackQuery(/^admin:ttoggle:(.+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const key = ctx.match[1] as string;
    if (!isContentKey(key)) {
      return;
    }
    await ctx.services.admin.toggleTextVariant(key, Number(ctx.match[2]));
    ctx.services.content.invalidate(key);
    await showTextVariants(ctx, key);
  });

  bot.callbackQuery(/^admin:tedit:(.+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const key = ctx.match[1] as string;
    if (!isContentKey(key)) {
      return;
    }
    pendingInput.set(ctx.appUser.id, {
      kind: 'ADMIN_TEXT_EDIT',
      key,
      variant: Number(ctx.match[2]),
    });
    await ctx.reply('Пришли новый текст варианта:');
  });

  bot.callbackQuery(/^admin:tadd:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const key = ctx.match[1] as string;
    if (!isContentKey(key)) {
      return;
    }
    pendingInput.set(ctx.appUser.id, { kind: 'ADMIN_TEXT_ADD', key });
    await ctx.reply('Пришли текст нового варианта:');
  });

  bot.callbackQuery(/^admin:tseed:(.+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const key = ctx.match[1] as string;
    if (!isContentKey(key)) {
      return;
    }
    await ctx.services.admin.restoreSeedVariant(key, Number(ctx.match[2]));
    ctx.services.content.invalidate(key);
    await showTextVariants(ctx, key);
  });

  bot.callbackQuery(CALLBACK.adminWordOfDay, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showWordOfDay(ctx);
  });

  bot.callbackQuery(CALLBACK.adminWordOfDayAdd, async (ctx) => {
    await ctx.answerCallbackQuery();
    await promptWordOfDay(ctx);
  });

  bot.callbackQuery(/^admin:wodel:(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.services.admin.removeWordOfDay(ctx.match[1] as string);
    await showWordOfDay(ctx);
  });

  bot.catch((error) => {
    logger.error(
      { err: error.error, updateId: error.ctx.update.update_id },
      'Ошибка обработки update',
    );
  });

  return bot;
}
