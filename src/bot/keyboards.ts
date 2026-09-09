import { InlineKeyboard } from 'grammy';

export const CALLBACK = {
  menuRoot: 'menu:root',
  menuLearn: 'menu:learn',
  menuAddWord: 'menu:add_word',
  menuStats: 'menu:stats',
  menuSettings: 'menu:settings',
  menuShop: 'menu:shop',
  menuAdmin: 'menu:admin',
  sessionResume: 'learn:resume',
  sessionFinish: 'card:finish',
  streakEarlyActivate: 'streak:early',
  testStart: 'learn:test',
  vocabularyNewCategory: 'vocab:new_category',
  vocabularyMine: 'vocab:mine',
  adminUsers: 'admin:users',
  adminCurrency: 'admin:currency',
  adminCurrencyEdit: 'admin:currency_edit',
  adminEconomy: 'admin:economy',
  adminTexts: 'admin:texts',
  adminWordOfDay: 'admin:wod',
  adminWordOfDayAdd: 'admin:wod_add',
  adminConfirm: 'admin:confirm',
} as const;

export const categoryCallback = (categoryId: number): string => `learn:cat:${categoryId}`;
export const directionCallback = (categoryId: number, direction: string): string =>
  `learn:dir:${categoryId}:${direction}`;
export const answerCallback = (cardId: number, answer: string): string =>
  `card:ans:${cardId}:${answer}`;
export const optionCallback = (cardId: number, index: number): string =>
  `card:opt:${cardId}:${index}`;
export const buyCallback = (item: string): string => `shop:buy:${item}`;
export const reminderHourCallback = (hour: number): string => `settings:hour:${hour}`;
export const addWordCategoryCallback = (categoryId: number): string => `vocab:add:${categoryId}`;
export const deactivateWordCallback = (wordId: number): string => `vocab:del_word:${wordId}`;
export const deactivateCategoryCallback = (categoryId: number): string =>
  `vocab:del_cat:${categoryId}`;

export function mainMenuKeyboard(isAdmin: boolean): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text('📚 Учиться', CALLBACK.menuLearn)
    .row()
    .text('➕ Добавить слово', CALLBACK.menuAddWord)
    .row()
    .text('📊 Статистика', CALLBACK.menuStats)
    .row()
    .text('🛍️ Магазин', CALLBACK.menuShop)
    .text('⚙️ Настройки', CALLBACK.menuSettings);

  if (isAdmin) {
    keyboard.row().text('🧑‍💻 Админ', CALLBACK.menuAdmin);
  }

  return keyboard;
}

export function backToMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('⬅️ В меню', CALLBACK.menuRoot);
}
