import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigService } from '../src/core/economy/config.js';
import { NoopEventSink } from '../src/core/events/sink.js';
import { SessionService } from '../src/core/learning/sessionService.js';
import { parseOptions } from '../src/core/learning/schemas.js';
import { createSeededRng, type Rng } from '../src/core/random.js';
import { createFixedClock } from '../src/core/time.js';
import { normalizeTranslation } from '../src/core/test/normalize.js';
import { createTestDb, seedCategory, type TestDb } from './helpers/testDb.js';

const NOW = '2026-09-09T10:00:00.000Z';
const noSurpriseRng: Rng = { next: () => 0.99 };

let db: TestDb;
let prisma: PrismaClient;
let userId: number;
let categoryId: number;

function makeSessions(rng: Rng = createSeededRng(5)): SessionService {
  return new SessionService({
    prisma,
    events: new NoopEventSink(),
    config: new ConfigService(prisma),
    clock: createFixedClock(NOW),
    rng,
  });
}

/** Делает слова доступными для Теста: timesKnown > 0. */
async function markKnown(count: number): Promise<void> {
  const words = await prisma.word.findMany({
    where: { categoryId },
    select: { id: true },
    take: count,
    orderBy: { id: 'asc' },
  });

  for (const word of words) {
    await prisma.userWord.upsert({
      where: { userId_wordId: { userId, wordId: word.id } },
      create: { userId, wordId: word.id, timesSeen: 1, timesKnown: 1, lastAnswer: 'KNOW' },
      update: { timesKnown: 1 },
    });
  }
}

beforeEach(async () => {
  db = await createTestDb();
  prisma = db.prisma;

  await prisma.economyConfig.create({ data: { id: 1 } });
  await prisma.currencyConfig.create({ data: { id: 1 } });

  const user = await prisma.user.create({
    data: { telegramId: 1n, timezone: 'Europe/Minsk' },
    select: { id: true },
  });
  userId = user.id;
  categoryId = await seedCategory(prisma, 'Cvety', 12);
});

afterEach(async () => {
  await db.cleanup();
});

describe('запуск теста', () => {
  it('создаёт 10 вопросов одной транзакцией', async () => {
    await markKnown(6);

    const started = await makeSessions().startTestSession(userId);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const session = await prisma.session.findUniqueOrThrow({
      where: { id: started.sessionId },
      select: { mode: true, plannedCount: true, categoryId: true, direction: true },
    });

    expect(session.mode).toBe('TEST');
    expect(session.plannedCount).toBe(10);
    expect(session.categoryId).toBeNull();
    expect(session.direction).toBe('PL_RU');

    const cards = await prisma.sessionCard.findMany({
      where: { sessionId: started.sessionId },
      orderBy: { position: 'asc' },
    });
    expect(cards).toHaveLength(10);
    expect(cards.map((card) => card.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('сохраняет 4 варианта из одной категории с различными переводами', async () => {
    await markKnown(6);

    const started = await makeSessions().startTestSession(userId);
    if (!started.ok) throw new Error('тест не создан');

    const cards = await prisma.sessionCard.findMany({
      where: { sessionId: started.sessionId },
      select: { options: true, correctOption: true, wordId: true, categoryId: true },
    });

    for (const card of cards) {
      const options = parseOptions(card.options);
      expect(options).toHaveLength(4);
      if (!options) continue;

      const labels = options.map((option) => normalizeTranslation(option.label));
      expect(new Set(labels).size).toBe(4);
      expect(options[card.correctOption ?? -1]?.wordId).toBe(card.wordId);

      const ids = options.map((option) => option.wordId);
      const sameCategory = await prisma.word.count({
        where: { id: { in: ids }, categoryId: card.categoryId },
      });
      expect(sameCategory).toBe(4);
    }
  });

  it('недоступен, если нет слов с timesKnown > 0', async () => {
    const started = await makeSessions().startTestSession(userId);
    expect(started).toEqual({ ok: false, reason: 'NOT_ENOUGH_WORDS' });
  });

  it('недоступен, если в категории меньше 4 различных переводов', async () => {
    const smallCategory = await prisma.category.create({
      data: { name: 'Malo', ownerId: null },
      select: { id: true },
    });
    await prisma.word.createMany({
      data: [
        { categoryId: smallCategory.id, polish: 'a', russian: 'одно', ownerId: null },
        { categoryId: smallCategory.id, polish: 'b', russian: 'одно', ownerId: null },
        { categoryId: smallCategory.id, polish: 'c', russian: 'два', ownerId: null },
      ],
    });
    await prisma.word.updateMany({ where: { categoryId }, data: { isActive: false } });

    const word = await prisma.word.findFirstOrThrow({ where: { categoryId: smallCategory.id } });
    await prisma.userWord.create({
      data: { userId, wordId: word.id, timesSeen: 1, timesKnown: 1 },
    });

    const started = await makeSessions().startTestSession(userId);
    expect(started).toEqual({ ok: false, reason: 'NOT_ENOUGH_WORDS' });
  });

  it('не создаёт тест при активной сессии', async () => {
    await markKnown(6);
    const sessions = makeSessions();

    await sessions.startFlashcardSession(userId, categoryId, 'PL_RU');
    const started = await sessions.startTestSession(userId);

    expect(started).toEqual({ ok: false, reason: 'ACTIVE_SESSION_EXISTS' });
  });

  it('считает показ вопроса целью в testSeenCount', async () => {
    await markKnown(6);
    const started = await makeSessions().startTestSession(userId);
    if (!started.ok) throw new Error('тест не создан');

    const shown = await prisma.sessionCard.findUniqueOrThrow({
      where: { id: started.card.cardId },
      select: { wordId: true, shownAt: true },
    });
    expect(shown.shownAt).not.toBeNull();

    const progress = await prisma.userWord.findUniqueOrThrow({
      where: { userId_wordId: { userId, wordId: shown.wordId } },
    });
    expect(progress.testSeenCount).toBe(1);
  });
});

describe('ответы в тесте', () => {
  it('фиксирует правильный ответ и обновляет счётчики', async () => {
    await markKnown(6);
    const sessions = makeSessions();
    const started = await sessions.startTestSession(userId);
    if (!started.ok) throw new Error('тест не создан');

    const card = await prisma.sessionCard.findUniqueOrThrow({
      where: { id: started.card.cardId },
      select: { correctOption: true, wordId: true },
    });

    const result = await sessions.answerTestCard(
      userId,
      started.card.cardId,
      card.correctOption ?? 0,
      'act-1',
    );
    expect(result.accepted).toBe(true);

    const stored = await prisma.sessionCard.findUniqueOrThrow({
      where: { id: started.card.cardId },
    });
    expect(stored.isCorrect).toBe(true);
    expect(stored.answer).toBe('TEST_OPTION');
    expect(stored.selectedOption).toBe(card.correctOption);

    const progress = await prisma.userWord.findUniqueOrThrow({
      where: { userId_wordId: { userId, wordId: card.wordId } },
    });
    expect(progress.testCorrectCount).toBe(1);
    expect(progress.testWrongCount).toBe(0);
  });

  it('фиксирует неправильный ответ', async () => {
    await markKnown(6);
    const sessions = makeSessions();
    const started = await sessions.startTestSession(userId);
    if (!started.ok) throw new Error('тест не создан');

    const card = await prisma.sessionCard.findUniqueOrThrow({
      where: { id: started.card.cardId },
      select: { correctOption: true, wordId: true },
    });
    const wrong = ((card.correctOption ?? 0) + 1) % 4;

    await sessions.answerTestCard(userId, started.card.cardId, wrong, 'act-1');

    const stored = await prisma.sessionCard.findUniqueOrThrow({
      where: { id: started.card.cardId },
    });
    expect(stored.isCorrect).toBe(false);

    const progress = await prisma.userWord.findUniqueOrThrow({
      where: { userId_wordId: { userId, wordId: card.wordId } },
    });
    expect(progress.testWrongCount).toBe(1);
  });

  it('игнорирует повторный ответ на тот же вопрос', async () => {
    await markKnown(6);
    const sessions = makeSessions();
    const started = await sessions.startTestSession(userId);
    if (!started.ok) throw new Error('тест не создан');

    const first = await sessions.answerTestCard(userId, started.card.cardId, 0, 'act-1');
    const second = await sessions.answerTestCard(userId, started.card.cardId, 1, 'act-2');

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(false);

    const session = await prisma.session.findUniqueOrThrow({
      where: { id: started.sessionId },
      select: { answeredCount: true },
    });
    expect(session.answeredCount).toBe(1);
  });

  it('за полностью пройденный тест даёт 10 единиц и стрик', async () => {
    await markKnown(6);
    const sessions = makeSessions(noSurpriseRng);
    const started = await sessions.startTestSession(userId);
    if (!started.ok) throw new Error('тест не создан');

    let cardId = started.card.cardId;
    for (let index = 0; index < 10; index += 1) {
      const result = await sessions.answerTestCard(userId, cardId, 0, `act-${index}`);
      expect(result.accepted).toBe(true);
      if (result.accepted && !result.completed) {
        cardId = result.card.cardId;
      }
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.currencyBalance).toBe(10);
    expect(user.currentStreak).toBe(1);

    const transaction = await prisma.currencyTransaction.findFirstOrThrow({
      where: { userId, reason: 'TEST_REWARD' },
    });
    expect(transaction.amount).toBe(10);

    const session = await prisma.session.findUniqueOrThrow({
      where: { id: started.sessionId },
      select: { status: true, isFull: true },
    });
    expect(session.status).toBe('COMPLETED');
    expect(session.isFull).toBe(true);
  });

  it('досрочно прерванный тест не даёт награду и стрик', async () => {
    await markKnown(6);
    const sessions = makeSessions(noSurpriseRng);
    const started = await sessions.startTestSession(userId);
    if (!started.ok) throw new Error('тест не создан');

    await sessions.answerTestCard(userId, started.card.cardId, 0, 'act-1');
    await sessions.abandonSession(userId);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.currencyBalance).toBe(0);
    expect(user.currentStreak).toBe(0);
  });

  it('восстанавливает тот же вопрос и варианты после перезапуска', async () => {
    await markKnown(6);
    const started = await makeSessions().startTestSession(userId);
    if (!started.ok) throw new Error('тест не создан');

    // Новый экземпляр сервиса = состояние только из БД.
    const restored = await makeSessions().currentCard(started.sessionId);

    expect(restored?.cardId).toBe(started.card.cardId);
    expect(restored?.promptText).toBe(started.card.promptText);
    expect(restored?.options).toEqual(started.card.options);
  });

  it('деактивация слова не меняет уже созданный тест', async () => {
    await markKnown(6);
    const started = await makeSessions().startTestSession(userId);
    if (!started.ok) throw new Error('тест не создан');

    await prisma.word.updateMany({ where: { categoryId }, data: { russian: 'изменено' } });

    const restored = await makeSessions().currentCard(started.sessionId);
    expect(restored?.options).toEqual(started.card.options);
  });
});
