import { InlineKeyboard } from 'grammy';
import type { AppContext } from '../context.js';
import { parseWordInput } from '../../core/vocabulary/vocabularyService.js';
import { escapeHtml } from '../../content/service.js';
import {
  addWordCategoryCallback,
  backToMenuKeyboard,
  CALLBACK,
  deactivateCategoryCallback,
  deactivateWordCallback,
} from '../keyboards.js';
import { pendingInput, type PendingInput } from '../state.js';
import { editOrReply } from '../ui.js';

export async function showAddWordMenu(ctx: AppContext): Promise<void> {
  const categories = await ctx.services.sessions.listCategories(ctx.appUser.id);
  const keyboard = new InlineKeyboard()
    .text('➕ Новая категория', CALLBACK.vocabularyNewCategory)
    .row();

  for (const category of categories) {
    keyboard.text(category.name, addWordCategoryCallback(category.id)).row();
  }

  keyboard.text('🗂 Мои слова', CALLBACK.vocabularyMine).row();
  keyboard.text('⬅️ В меню', CALLBACK.menuRoot);

  await editOrReply(ctx, 'Куда добавим слово?', keyboard);
}

export async function promptAddWord(ctx: AppContext, categoryId: number): Promise<void> {
  pendingInput.set(ctx.appUser.id, { kind: 'ADD_WORD', categoryId });

  await editOrReply(
    ctx,
    'Напиши слово и перевод через дефис:\n\n<code>kot - кот</code>',
    backToMenuKeyboard(),
  );
}

export async function promptNewCategory(ctx: AppContext): Promise<void> {
  pendingInput.set(ctx.appUser.id, { kind: 'NEW_CATEGORY' });

  await editOrReply(ctx, 'Как назовём новую категорию?', backToMenuKeyboard());
}

/** Обрабатывает текстовый ответ для пользовательского словаря. */
export async function handleVocabularyInput(
  ctx: AppContext,
  pending: PendingInput,
  text: string,
): Promise<boolean> {
  if (pending.kind === 'NEW_CATEGORY') {
    const result = await ctx.services.vocabulary.createCategory(ctx.appUser.id, text);

    if (!result.ok) {
      const message =
        result.reason === 'DUPLICATE'
          ? 'Такая категория у тебя уже есть 🙂'
          : 'Название должно быть от 1 до 100 символов.';
      await ctx.reply(message, { reply_markup: backToMenuKeyboard() });
      return true;
    }

    pendingInput.set(ctx.appUser.id, { kind: 'ADD_WORD', categoryId: result.categoryId });
    await ctx.reply('Категория создана ❤️ Теперь пришли слово: <code>kot - кот</code>', {
      parse_mode: 'HTML',
      reply_markup: backToMenuKeyboard(),
    });
    return true;
  }

  const parsed = parseWordInput(text);
  if (!parsed) {
    await ctx.reply('Не разобрал. Формат такой: <code>kot - кот</code>', {
      parse_mode: 'HTML',
    });
    return true;
  }

  if (pending.kind !== 'ADD_WORD') {
    return false;
  }

  const result = await ctx.services.vocabulary.addWord(
    ctx.appUser.id,
    pending.categoryId,
    parsed.polish,
    parsed.russian,
  );

  if (!result.ok) {
    const message =
      result.reason === 'DUPLICATE'
        ? 'Такое слово в этой категории уже есть 🙂'
        : result.reason === 'CATEGORY_NOT_FOUND'
          ? 'Категория больше недоступна.'
          : 'Слово и перевод должны быть от 1 до 100 символов.';
    await ctx.reply(message, { reply_markup: backToMenuKeyboard() });
    return true;
  }

  const keyboard = new InlineKeyboard()
    .text('➕ Ещё слово', addWordCategoryCallback(pending.categoryId))
    .row()
    .text('⬅️ В меню', CALLBACK.menuRoot);

  await ctx.reply(
    `Добавлено: <b>${escapeHtml(parsed.polish)}</b> — ${escapeHtml(parsed.russian)} ❤️`,
    { parse_mode: 'HTML', reply_markup: keyboard },
  );
  return true;
}

export async function showMyContent(ctx: AppContext): Promise<void> {
  const { vocabulary } = ctx.services;
  const [categories, words] = await Promise.all([
    vocabulary.listOwnCategories(ctx.appUser.id),
    vocabulary.listOwnWords(ctx.appUser.id),
  ]);

  if (categories.length === 0 && words.length === 0) {
    await editOrReply(ctx, 'Ты пока ничего не добавляла ❤️', backToMenuKeyboard());
    return;
  }

  const keyboard = new InlineKeyboard();

  for (const category of categories) {
    keyboard
      .text(`🗑 Категория: ${category.name}`, deactivateCategoryCallback(category.id))
      .row();
  }

  for (const word of words) {
    keyboard.text(`🗑 ${word.polish} — ${word.russian}`, deactivateWordCallback(word.id)).row();
  }

  keyboard.text('⬅️ Назад', CALLBACK.menuAddWord);

  await editOrReply(ctx, 'Что убрать из обучения? История сохранится.', keyboard);
}

export async function deactivateWord(ctx: AppContext, wordId: number): Promise<void> {
  await ctx.services.vocabulary.deactivateWord(ctx.appUser.id, wordId);
  await showMyContent(ctx);
}

export async function deactivateCategory(ctx: AppContext, categoryId: number): Promise<void> {
  await ctx.services.vocabulary.deactivateCategory(ctx.appUser.id, categoryId);
  await showMyContent(ctx);
}
