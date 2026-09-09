import { InlineKeyboard } from 'grammy';
import type { AppContext } from '../context.js';
import type { CardView } from '../../core/learning/sessionService.js';
import { escapeHtml } from '../../content/service.js';
import {
  answerCallback,
  backToMenuKeyboard,
  CALLBACK,
  categoryCallback,
  directionCallback,
  optionCallback,
} from '../keyboards.js';
import { editOrReply } from '../ui.js';
import { showMainMenu } from './menu.js';
import { showCompletion } from './completion.js';

/** 🟩 пройдено, ⬜ осталось — единственное украшение экрана карточки (§4.2). */
export function progressBar(answered: number, planned: number): string {
  const filled = '🟩'.repeat(answered);
  const empty = '⬜'.repeat(Math.max(planned - answered, 0));
  return `${filled}${empty}  ${answered}/${planned}`;
}

function cardText(card: CardView): string {
  const flag = card.direction === 'PL_RU' ? '🇵🇱' : '🇷🇺';
  const header = card.mode === 'TEST' ? '🎯 Как это переводится?\n\n' : '';
  return `${header}${flag} <b>${escapeHtml(card.promptText)}</b>\n\n${progressBar(card.answeredCount, card.plannedCount)}`;
}

function cardKeyboard(card: CardView): InlineKeyboard {
  if (card.mode === 'TEST' && card.options) {
    const keyboard = new InlineKeyboard();
    card.options.forEach((option, index) => {
      keyboard.text(option.label, optionCallback(card.cardId, index)).row();
    });
    return keyboard.text('⏹️ Закончить', CALLBACK.sessionFinish);
  }

  return new InlineKeyboard()
    .text('✅ Знаю', answerCallback(card.cardId, 'KNOW'))
    .text('🤔 Не знаю', answerCallback(card.cardId, 'UNKNOWN'))
    .row()
    .text('⏹️ Закончить', CALLBACK.sessionFinish);
}

export async function renderCard(ctx: AppContext, card: CardView): Promise<void> {
  await editOrReply(ctx, cardText(card), cardKeyboard(card));
}

export async function showLearnMenu(ctx: AppContext): Promise<void> {
  const { sessions } = ctx.services;

  const active = await sessions.getActiveSession(ctx.appUser.id);
  if (active) {
    const keyboard = new InlineKeyboard()
      .text('▶️ Продолжить', CALLBACK.sessionResume)
      .row()
      .text('⏹️ Закончить', CALLBACK.sessionFinish)
      .row()
      .text('⬅️ В меню', CALLBACK.menuRoot);

    await editOrReply(
      ctx,
      `У тебя есть незаконченная сессия: ${active.answeredCount}/${active.plannedCount}.\nПродолжим?`,
      keyboard,
    );
    return;
  }

  const categories = await sessions.listCategories(ctx.appUser.id);
  const keyboard = new InlineKeyboard().text('🎯 Тест', CALLBACK.testStart).row();

  for (const category of categories) {
    keyboard.text(`${category.name} · ${category.activeWords}`, categoryCallback(category.id)).row();
  }
  keyboard.text('⬅️ В меню', CALLBACK.menuRoot);

  await editOrReply(ctx, 'Выбери категорию или пройди тест:', keyboard);
}

export async function startTest(ctx: AppContext): Promise<void> {
  const result = await ctx.services.sessions.startTestSession(ctx.appUser.id);

  if (!result.ok) {
    if (result.reason === 'NOT_ENOUGH_WORDS') {
      const text = await ctx.services.content.render('ui.test.unavailable', ctx.appUser.id);
      await editOrReply(ctx, text, backToMenuKeyboard());
      return;
    }
    await showLearnMenu(ctx);
    return;
  }

  await renderCard(ctx, result.card);
}

export async function handleTestAnswer(
  ctx: AppContext,
  cardId: number,
  option: number,
  actionId: string,
): Promise<void> {
  const result = await ctx.services.sessions.answerTestCard(
    ctx.appUser.id,
    cardId,
    option,
    actionId,
  );

  if (!result.accepted) {
    return;
  }

  if (!result.completed) {
    await renderCard(ctx, result.card);
    return;
  }

  await showCompletion(ctx, result.summary);
}

export async function showCategorySummary(ctx: AppContext, categoryId: number): Promise<void> {
  const summary = await ctx.services.sessions.categorySummary(ctx.appUser.id, categoryId);

  if (summary.total === 0) {
    const text = await ctx.services.content.render('ui.session.no_words', ctx.appUser.id);
    await editOrReply(ctx, text, backToMenuKeyboard());
    return;
  }

  const keyboard = new InlineKeyboard()
    .text('🇵🇱 польский', directionCallback(categoryId, 'PL_RU'))
    .text('🇷🇺 русский', directionCallback(categoryId, 'RU_PL'))
    .row()
    .text('⬅️ Назад', CALLBACK.menuLearn);

  const text = [
    `Всего слов: <b>${summary.total}</b>`,
    `Пройдено: <b>${summary.passed}</b>`,
    `Выучено: <b>${summary.learned}</b>`,
    `Осталось выучить: <b>${summary.remaining}</b>`,
    `Нужно повторить: <b>${summary.toRepeat}</b>`,
    '',
    'На каком языке показывать слово?',
  ].join('\n');

  await editOrReply(ctx, text, keyboard);
}

export async function startSession(
  ctx: AppContext,
  categoryId: number,
  direction: 'PL_RU' | 'RU_PL',
): Promise<void> {
  const result = await ctx.services.sessions.startFlashcardSession(
    ctx.appUser.id,
    categoryId,
    direction,
  );

  if (!result.ok) {
    if (result.reason === 'NO_WORDS') {
      const text = await ctx.services.content.render('ui.session.no_words', ctx.appUser.id);
      await editOrReply(ctx, text, backToMenuKeyboard());
      return;
    }
    await showLearnMenu(ctx);
    return;
  }

  await renderCard(ctx, result.card);
}

export async function resumeSession(ctx: AppContext): Promise<void> {
  const active = await ctx.services.sessions.getActiveSession(ctx.appUser.id);
  if (!active) {
    await showLearnMenu(ctx);
    return;
  }

  const card = await ctx.services.sessions.currentCard(active.sessionId);
  if (!card) {
    await showLearnMenu(ctx);
    return;
  }

  await renderCard(ctx, card);
}

export async function handleAnswer(
  ctx: AppContext,
  cardId: number,
  answer: 'KNOW' | 'UNKNOWN',
  actionId: string,
): Promise<void> {
  const result = await ctx.services.sessions.answerCard(ctx.appUser.id, cardId, answer, actionId);

  if (!result.accepted) {
    return;
  }

  if (!result.completed) {
    await renderCard(ctx, result.card);
    return;
  }

  await showCompletion(ctx, result.summary);
}

export async function handleFinish(ctx: AppContext): Promise<void> {
  await ctx.services.sessions.abandonSession(ctx.appUser.id);
  await showMainMenu(ctx);
}
