import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StatsService } from '../src/core/stats/statsService.js';
import { createFixedClock } from '../src/core/time.js';
import { createTestDb, seedCategory, type TestDb } from './helpers/testDb.js';

const TIMEZONE = 'Europe/Minsk';

let db: TestDb;
let prisma: PrismaClient;
let stats: StatsService;
let userId: number;
let categoryId: number;
let wordIds: number[];

// 2026-03-10 12:00 UTC → 15:00 в Europe/Minsk.
const clock = createFixedClock('2026-03-10T12:00:00.000Z');

async function createSession(options: {
  mode: 'FLASHCARDS' | 'TEST';
  status: 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
  startedAt: string;
  finishedAt?: string;
}): Promise<number> {
  const session = await prisma.session.create({
    data: {
      userId,
      mode: options.mode,
      categoryId,
      status: options.status,
      plannedCount: 10,
      startedAt: new Date(options.startedAt),
      finishedAt: options.finishedAt ? new Date(options.finishedAt) : null,
    },
    select: { id: true },
  });
  return session.id;
}

describe('статистика пользователя', () => {
  beforeEach(async () => {
    db = await createTestDb();
    prisma = db.prisma;
    stats = new StatsService({ prisma, clock });

    const user = await prisma.user.create({
      data: { telegramId: 1n, currentStreak: 4, maxStreak: 9, timezone: TIMEZONE },
      select: { id: true },
    });
    userId = user.id;

    categoryId = await seedCategory(prisma, 'Kolory', 4);
    const words = await prisma.word.findMany({
      where: { categoryId },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    wordIds = words.map((word) => word.id);
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it('считает итоги по доменным таблицам', async () => {
    await prisma.userWord.createMany({
      data: [
        { userId, wordId: wordIds[0]!, currentLevel: 2, timesSeen: 4, timesKnown: 4 },
        { userId, wordId: wordIds[1]!, currentLevel: 1, timesSeen: 2, timesKnown: 1 },
      ],
    });

    const sessionId = await createSession({
      mode: 'FLASHCARDS',
      status: 'COMPLETED',
      startedAt: '2026-03-09T06:00:00.000Z',
      finishedAt: '2026-03-09T06:10:00.000Z',
    });
    const testId = await createSession({
      mode: 'TEST',
      status: 'COMPLETED',
      startedAt: '2026-03-09T07:00:00.000Z',
      finishedAt: '2026-03-09T07:20:00.000Z',
    });

    await prisma.sessionCard.createMany({
      data: [
        {
          sessionId,
          wordId: wordIds[0]!,
          categoryId,
          position: 0,
          promptText: 'a',
          answer: 'KNOW',
        },
        {
          sessionId,
          wordId: wordIds[1]!,
          categoryId,
          position: 1,
          promptText: 'b',
          answer: 'UNKNOWN',
        },
        {
          sessionId: testId,
          wordId: wordIds[0]!,
          categoryId,
          position: 0,
          promptText: 'c',
          answer: 'TEST_OPTION',
          isCorrect: true,
        },
        {
          sessionId: testId,
          wordId: wordIds[1]!,
          categoryId,
          position: 1,
          promptText: 'd',
          answer: 'TEST_OPTION',
          isCorrect: false,
        },
      ],
    });

    const result = await stats.userStats(userId, TIMEZONE);

    expect(result.totals.learnedWords).toBe(1);
    expect(result.totals.answeredCards).toBe(2);
    expect(result.totals.completedTests).toBe(1);
    expect(result.totals.correctAnswers).toBe(1);
    expect(result.totals.accuracyPercent).toBe(50);
  });

  it('показывает «—» вместо 0% при отсутствии тестовых ответов', async () => {
    const result = await stats.userStats(userId, TIMEZONE);
    expect(result.totals.accuracyPercent).toBeNull();
    expect(result.time.averageMs).toBeNull();
    expect(result.habits.favoritePart).toBeNull();
  });

  it('считает дни обучения, щиты и пропуски только после первого дня обучения', async () => {
    await prisma.userDay.createMany({
      data: [
        { userId, localDate: '2026-03-01', status: 'MISSED' },
        { userId, localDate: '2026-03-02', status: 'COMPLETED', completedSessions: 2 },
        { userId, localDate: '2026-03-03', status: 'MISSED' },
        { userId, localDate: '2026-03-04', status: 'SHIELDED' },
        { userId, localDate: '2026-03-05', status: 'COMPLETED', completedSessions: 1 },
      ],
    });

    const result = await stats.userStats(userId, TIMEZONE);

    expect(result.streak.current).toBe(4);
    expect(result.streak.max).toBe(9);
    expect(result.streak.learningDays).toBe(2);
    expect(result.streak.shieldsUsed).toBe(1);
    expect(result.streak.missedDays).toBe(1);
  });

  it('строит тепловую карту с 1-го числа месяца по сегодня', async () => {
    await prisma.userDay.createMany({
      data: [
        { userId, localDate: '2026-02-28', status: 'COMPLETED', completedSessions: 5 },
        { userId, localDate: '2026-03-02', status: 'COMPLETED', completedSessions: 3 },
      ],
    });

    const result = await stats.userStats(userId, TIMEZONE);

    expect(result.heatmap).toHaveLength(10);
    expect(result.heatmap[1]).toEqual({ day: 2, sessions: 3 });
    expect(result.heatmap[0]).toEqual({ day: 1, sessions: 0 });
  });

  it('считает время и привычки по завершённым сессиям в таймзоне пользователя', async () => {
    // 06:00 UTC = 09:00 в Минске (утро), 19:00 UTC = 22:00 (вечер).
    await createSession({
      mode: 'FLASHCARDS',
      status: 'COMPLETED',
      startedAt: '2026-03-09T06:00:00.000Z',
      finishedAt: '2026-03-09T06:10:00.000Z',
    });
    await createSession({
      mode: 'FLASHCARDS',
      status: 'ABANDONED',
      startedAt: '2026-03-09T06:30:00.000Z',
      finishedAt: '2026-03-09T06:50:00.000Z',
    });
    await createSession({
      mode: 'TEST',
      status: 'COMPLETED',
      startedAt: '2026-03-10T19:00:00.000Z',
      finishedAt: '2026-03-10T19:05:00.000Z',
    });
    // Активная сессия в агрегаты не входит (§11.1).
    await createSession({
      mode: 'FLASHCARDS',
      status: 'ACTIVE',
      startedAt: '2026-03-10T11:00:00.000Z',
    });

    const result = await stats.userStats(userId, TIMEZONE);

    expect(result.time.totalMs).toBe(35 * 60_000);
    expect(result.time.longestMs).toBe(20 * 60_000);
    expect(result.time.averageMs).toBeCloseTo((35 / 3) * 60_000);
    expect(result.habits.favoritePart).toBe('MORNING');
    expect(result.habits.favoriteWeekday).toBe(1);
    expect(result.habits.sessionsPerDay).toBeCloseTo(1.5);
  });

  it('находит крайние слова и топ трудных', async () => {
    await prisma.userWord.createMany({
      data: [
        {
          userId,
          wordId: wordIds[0]!,
          timesSeen: 5,
          timesUnknown: 4,
          currentScore: -3,
          timesSeenToLearn: 9,
          firstSeenAt: new Date('2026-03-01T00:00:00.000Z'),
        },
        {
          userId,
          wordId: wordIds[1]!,
          timesSeen: 5,
          timesUnknown: 1,
          currentScore: 5,
          timesSeenToLearn: 3,
          firstSeenAt: new Date('2026-03-02T00:00:00.000Z'),
        },
        { userId, wordId: wordIds[2]!, timesSeen: 0, currentScore: 0 },
      ],
    });

    const result = await stats.userStats(userId, TIMEZONE);

    expect(result.words.easiest?.value).toBe(5);
    expect(result.words.hardest?.value).toBe(-3);
    expect(result.words.mostForgotten?.value).toBe(4);
    expect(result.words.fastestLearned?.value).toBe(3);
    expect(result.words.mostRepeated?.value).toBe(9);
    expect(result.difficult).toHaveLength(2);
    expect(result.difficult[0]?.value).toBe(4);
  });
});
