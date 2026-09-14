import { InlineKeyboard } from 'grammy';
import type { AppContext } from '../context.js';
import type { CardView, RevealView } from '../../core/learning/sessionService.js';
import { escapeHtml } from '../../content/service.js';
import {
  answerCallback,
  backToMenuKeyboard,
  CALLBACK,
  categoryCallback,
  directionCallback,
  optionCallback,
  typingCallback,
} from '../keyboards.js';
import { editOrReply, replyVoice } from '../ui.js';
import { showMainMenu } from './menu.js';
import { showCompletion } from './completion.js';

/** 🟩 пройдено, ⬜ осталось — единственное украшение экрана карточки (§4.2). */
export function progressBar(answered: number, planned: number): string {
  const filled = '🟩'.repeat(answered);
  const empty = '⬜'.repeat(Math.max(planned - answered, 0));
  return `${filled}${empty}  ${answered}/${planned}`;
}

/** В тесте квадрат красит по правильности ответа: 🟩 верно, 🟥 неверно, ⬜ ещё не отвечено. */
export function testProgressBar(results: boolean[], planned: number): string {
  const answered = results.map((isCorrect) => (isCorrect ? '🟩' : '🟥')).join('');
  const empty = '⬜'.repeat(Math.max(planned - results.length, 0));
  return `${answered}${empty}  ${results.length}/${planned}`;
}

function cardText(card: CardView, translation?: string): string {
  const flag = card.direction === 'PL_RU' ? '🇵🇱' : '🇷🇺';
  const header =
    card.mode === 'TEST'
      ? '🎯 Как это переводится?\n\n'
      : card.mode === 'TYPING'
        ? '✍️ Напиши перевод:\n\n'
        : '';
  const word = translation
    ? `${escapeHtml(card.promptText)} — ${escapeHtml(translation)}`
    : escapeHtml(card.promptText);
  const bar = card.testResults
    ? testProgressBar(card.testResults, card.plannedCount)
    : progressBar(card.answeredCount, card.plannedCount);
  return `${header}${flag} <b>${word}</b>\n\n${bar}`;
}

function cardKeyboard(card: CardView): InlineKeyboard {
  if (card.mode === 'TEST' && card.options) {
    const keyboard = new InlineKeyboard();
    card.options.forEach((option, index) => {
      keyboard.text(option.label, optionCallback(card.cardId, index)).row();
    });
    return keyboard.text('⏹️ Закончить', CALLBACK.sessionFinish);
  }

  if (card.mode === 'TYPING') {
    return new InlineKeyboard().text('⏹️ Закончить', CALLBACK.sessionFinish);
  }

  return new InlineKeyboard()
    .text('✅ Знаю', answerCallback(card.cardId, 'KNOW'))
    .text('🤔 Не знаю', answerCallback(card.cardId, 'UNKNOWN'))
    .row()
    .text('⏹️ Закончить', CALLBACK.sessionFinish);
}

export async function renderCard(ctx: AppContext, card: CardView): Promise<void> {
  const text = cardText(card);
  const keyboard = cardKeyboard(card);

  // Озвучка звучит только когда польское слово уже на экране, иначе она подскажет ответ.
  if (card.voiceFileId && card.direction === 'PL_RU') {
    await replyVoice(ctx, card.voiceFileId, text, keyboard);
    return;
  }

  await editOrReply(ctx, text, keyboard);
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
    .text('✍️ Польский → русский', typingCallback(categoryId, 'PL_RU'))
    .row()
    .text('✍️ Русский → польский', typingCallback(categoryId, 'RU_PL'))
    .row()
    .text('⬅️ Назад', CALLBACK.menuLearn);

  const text = [
    `Всего слов: <b>${summary.total}</b>`,
    `Пройдено: <b>${summary.passed}</b>`,
    `Выучено: <b>${summary.learned}</b>`,
    `Осталось выучить: <b>${summary.remaining}</b>`,
    `Нужно повторить: <b>${summary.toRepeat}</b>`,
    '',
    'Карточки (Знаю/Не знаю) или напиши перевод сам?',
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

export async function startTypingSession(
  ctx: AppContext,
  categoryId: number,
  direction: 'PL_RU' | 'RU_PL',
): Promise<void> {
  const result = await ctx.services.sessions.startFlashcardSession(
    ctx.appUser.id,
    categoryId,
    direction,
    'TYPING',
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

  if (result.completed) {
    if (result.reveal) {
      await showReveal(ctx, result.reveal, false);
      await showCompletion(ctx, result.summary, { editCurrent: false });
      return;
    }
    await showCompletion(ctx, result.summary);
    return;
  }

  if (result.reveal) {
    await showReveal(ctx, result.reveal);
    return;
  }

  await renderCard(ctx, result.card);
}

/** Показывает перевод в том же сообщении карточки, прежде чем перейти к следующей (§4.2). */
async function showReveal(
  ctx: AppContext,
  reveal: RevealView,
  canContinue = true,
): Promise<void> {
  const text = cardText(
    {
      cardId: 0,
      promptText: reveal.promptText,
      direction: reveal.direction,
      position: 0,
      answeredCount: reveal.answeredCount,
      plannedCount: reveal.plannedCount,
      mode: 'FLASHCARDS',
      options: null,
      testResults: null,
      voiceFileId: reveal.voiceFileId,
    },
    reveal.translationText,
  );

  const keyboard = canContinue
    ? new InlineKeyboard()
        .text('▶️ Дальше', CALLBACK.sessionResume)
        .row()
        .text('⏹️ Закончить', CALLBACK.sessionFinish)
    : backToMenuKeyboard();

  // На экране ответа польское слово уже открыто, поэтому озвучка звучит всегда.
  if (reveal.voiceFileId) {
    await replyVoice(ctx, reveal.voiceFileId, text, keyboard);
    return;
  }

  await editOrReply(ctx, text, keyboard);
}

/** Ответ печатается текстом, поэтому и правильный, и неправильный вариант ведут дальше (§4.2). */
function typedResultText(reveal: RevealView, isCorrect: boolean): string {
  const flag = reveal.direction === 'PL_RU' ? '🇵🇱' : '🇷🇺';
  const header = isCorrect ? '✅ Правильно! Умница ❤️\n\n' : '📝 Правильный ответ:\n\n';
  const word = `${escapeHtml(reveal.promptText)} — ${escapeHtml(reveal.translationText)}`;
  const bar = progressBar(reveal.answeredCount, reveal.plannedCount);
  return `${header}${flag} <b>${word}</b>\n\n${bar}`;
}

async function showTypedResult(
  ctx: AppContext,
  reveal: RevealView,
  isCorrect: boolean,
  canContinue = true,
): Promise<void> {
  const text = typedResultText(reveal, isCorrect);

  const keyboard = canContinue
    ? new InlineKeyboard()
        .text('▶️ Дальше', CALLBACK.sessionResume)
        .row()
        .text('⏹️ Закончить', CALLBACK.sessionFinish)
    : backToMenuKeyboard();

  if (reveal.voiceFileId) {
    await replyVoice(ctx, reveal.voiceFileId, text, keyboard);
    return;
  }

  await editOrReply(ctx, text, keyboard);
}

export async function handleTypedAnswer(
  ctx: AppContext,
  cardId: number,
  rawInput: string,
  actionId: string,
): Promise<void> {
  const result = await ctx.services.sessions.answerTypedCard(
    ctx.appUser.id,
    cardId,
    rawInput,
    actionId,
  );

  if (!result.accepted) {
    return;
  }

  if (result.completed) {
    await showTypedResult(ctx, result.reveal, result.isCorrect, false);
    await showCompletion(ctx, result.summary, { editCurrent: false });
    return;
  }

  await showTypedResult(ctx, result.reveal, result.isCorrect);
}

/** Разбор свободного текста: обрабатывается только когда ждём ответ режима «Написание» (§4.2). */
export async function handleTypingCardInput(ctx: AppContext, text: string): Promise<boolean> {
  const active = await ctx.services.sessions.getActiveSession(ctx.appUser.id);
  if (!active || active.mode !== 'TYPING') {
    return false;
  }

  const card = await ctx.services.sessions.currentCard(active.sessionId);
  if (!card) {
    return false;
  }

  const actionId = `text:${ctx.chat?.id ?? ctx.appUser.id}:${ctx.msg?.message_id ?? Date.now()}`;
  await handleTypedAnswer(ctx, card.cardId, text, actionId);
  return true;
}

export async function handleFinish(ctx: AppContext): Promise<void> {
  await ctx.services.sessions.abandonSession(ctx.appUser.id);
  await showMainMenu(ctx);
}
