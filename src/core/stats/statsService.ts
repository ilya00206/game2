import type { PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';
import { LEVEL_FAMILIAR } from '../learning/progress.js';
import { daysBetweenLocalDates, toLocalDate, type Clock } from '../time.js';

export type DayPart = 'MORNING' | 'AFTERNOON' | 'EVENING';

export interface StatsTotals {
  learnedWords: number;
  answeredCards: number;
  completedTests: number;
  correctAnswers: number;
  /** null, если тестовых ответов ещё не было — показывается «—», а не 0% (§11.1). */
  accuracyPercent: number | null;
}

export interface StatsStreak {
  current: number;
  max: number;
  learningDays: number;
  missedDays: number;
  shieldsUsed: number;
}

export interface StatsTime {
  totalMs: number;
  averageMs: number | null;
  longestMs: number | null;
}

export interface StatsHabits {
  favoritePart: DayPart | null;
  /** 1 = понедельник … 7 = воскресенье (нумерация Luxon). */
  favoriteWeekday: number | null;
  sessionsPerDay: number | null;
}

export interface StatsWord {
  polish: string;
  russian: string;
  value: number;
}

export interface StatsWords {
  easiest: StatsWord | null;
  hardest: StatsWord | null;
  mostForgotten: StatsWord | null;
  fastestLearned: StatsWord | null;
  mostRepeated: StatsWord | null;
}

export interface HeatmapDay {
  day: number;
  sessions: number;
}

export interface UserStats {
  totals: StatsTotals;
  streak: StatsStreak;
  time: StatsTime;
  habits: StatsHabits;
  words: StatsWords;
  heatmap: HeatmapDay[];
  difficult: StatsWord[];
}

interface StatsDeps {
  prisma: PrismaClient;
  clock: Clock;
}

const DAY_PARTS: DayPart[] = ['MORNING', 'AFTERNOON', 'EVENING'];
const DIFFICULT_WORDS_LIMIT = 5;

const wordSelect = { word: { select: { polish: true, russian: true } } } as const;

/** Временные бакеты «любимого времени» (§4.6): вечер включает ночь. */
function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour <= 11) return 'MORNING';
  if (hour >= 12 && hour <= 17) return 'AFTERNOON';
  return 'EVENING';
}

function toStatsWord<T extends { word: { polish: string; russian: string } }>(
  row: T | null,
  value: (row: T) => number,
): StatsWord | null {
  if (!row) {
    return null;
  }
  return { polish: row.word.polish, russian: row.word.russian, value: value(row) };
}

/**
 * Статистика считается только при открытии экрана, агрегациями по доменным
 * таблицам `Session`, `SessionCard`, `UserWord` и `UserDay` (§4.6, §11.1).
 * Число запросов константно и не зависит от объёма истории.
 */
export class StatsService {
  private readonly prisma: PrismaClient;
  private readonly clock: Clock;

  constructor({ prisma, clock }: StatsDeps) {
    this.prisma = prisma;
    this.clock = clock;
  }

  async userStats(userId: number, timezone: string): Promise<UserStats> {
    const [user, learnedWords, answeredCards, completedTests, correctAnswers, testAnswers] =
      await Promise.all([
        this.prisma.user.findUniqueOrThrow({
          where: { id: userId },
          select: { currentStreak: true, maxStreak: true },
        }),
        this.prisma.userWord.count({
          where: { userId, currentLevel: LEVEL_FAMILIAR, word: { isActive: true } },
        }),
        this.prisma.sessionCard.count({
          where: { session: { userId }, answer: { in: ['KNOW', 'UNKNOWN'] } },
        }),
        this.prisma.session.count({ where: { userId, mode: 'TEST', status: 'COMPLETED' } }),
        this.prisma.sessionCard.count({ where: { session: { userId }, isCorrect: true } }),
        this.prisma.sessionCard.count({ where: { session: { userId }, isCorrect: { not: null } } }),
      ]);

    const [streak, sessions, words, heatmap, difficult] = await Promise.all([
      this.streakStats(userId, user.currentStreak, user.maxStreak),
      this.sessionStats(userId, timezone),
      this.wordStats(userId),
      this.heatmap(userId, timezone),
      this.difficultWords(userId),
    ]);

    return {
      totals: {
        learnedWords,
        answeredCards,
        completedTests,
        correctAnswers,
        accuracyPercent: testAnswers === 0 ? null : (correctAnswers / testAnswers) * 100,
      },
      streak,
      time: sessions.time,
      habits: sessions.habits,
      words,
      heatmap,
      difficult,
    };
  }

  private async streakStats(userId: number, current: number, max: number): Promise<StatsStreak> {
    const byStatus = await this.prisma.userDay.groupBy({
      by: ['status'],
      where: { userId },
      _count: { _all: true },
    });

    const count = (status: string): number =>
      byStatus.find((row) => row.status === status)?._count._all ?? 0;

    const firstLearningDay = await this.prisma.userDay.findFirst({
      where: { userId, status: 'COMPLETED' },
      orderBy: { localDate: 'asc' },
      select: { localDate: true },
    });

    // «Пропущено дней» считается только после первого дня обучения (§11.1).
    const missedDays = firstLearningDay
      ? await this.prisma.userDay.count({
          where: { userId, status: 'MISSED', localDate: { gt: firstLearningDay.localDate } },
        })
      : 0;

    return {
      current,
      max,
      learningDays: count('COMPLETED'),
      missedDays,
      shieldsUsed: count('SHIELDED'),
    };
  }

  /**
   * SQLite не умеет конвертировать в IANA-таймзону, поэтому бакеты времени и дня
   * недели считаются в Node по одному чтению двух колонок завершённых сессий.
   */
  private async sessionStats(
    userId: number,
    timezone: string,
  ): Promise<{ time: StatsTime; habits: StatsHabits }> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, finishedAt: { not: null } },
      select: { startedAt: true, finishedAt: true },
      orderBy: { startedAt: 'asc' },
    });

    const [first] = sessions;
    if (!first) {
      return {
        time: { totalMs: 0, averageMs: null, longestMs: null },
        habits: { favoritePart: null, favoriteWeekday: null, sessionsPerDay: null },
      };
    }

    let totalMs = 0;
    let longestMs = 0;
    const partCounts = new Map<DayPart, number>();
    const weekdayCounts = new Map<number, number>();

    for (const session of sessions) {
      const finishedAt = session.finishedAt ?? session.startedAt;
      const durationMs = Math.max(0, finishedAt.getTime() - session.startedAt.getTime());
      totalMs += durationMs;
      longestMs = Math.max(longestMs, durationMs);

      const local = DateTime.fromJSDate(session.startedAt, { zone: timezone });
      const part = dayPart(local.hour);
      partCounts.set(part, (partCounts.get(part) ?? 0) + 1);
      weekdayCounts.set(local.weekday, (weekdayCounts.get(local.weekday) ?? 0) + 1);
    }

    // При равенстве выбирается более ранний бакет или день недели (§11.1).
    const favoritePart = pickTopKey(DAY_PARTS, partCounts);
    const favoriteWeekday = pickTopKey([1, 2, 3, 4, 5, 6, 7], weekdayCounts);

    const firstDate = toLocalDate(first.startedAt, timezone);
    const today = toLocalDate(this.clock.now(), timezone);
    // Календарные дни от первой сессии до сегодня включительно (§11.1).
    const days = Math.max(1, daysBetweenLocalDates(firstDate, today) + 1);

    return {
      time: {
        totalMs,
        averageMs: totalMs / sessions.length,
        longestMs,
      },
      habits: {
        favoritePart,
        favoriteWeekday,
        sessionsPerDay: sessions.length / days,
      },
    };
  }

  private async wordStats(userId: number): Promise<StatsWords> {
    const seen = { userId, timesSeen: { gt: 0 } };
    const learned = { userId, timesSeenToLearn: { not: null } };

    const [easiest, hardest, mostForgotten, fastestLearned, mostRepeated] = await Promise.all([
      this.prisma.userWord.findFirst({
        where: seen,
        orderBy: [{ currentScore: 'desc' }, { firstSeenAt: 'asc' }],
        select: { currentScore: true, ...wordSelect },
      }),
      this.prisma.userWord.findFirst({
        where: seen,
        orderBy: [{ currentScore: 'asc' }, { firstSeenAt: 'asc' }],
        select: { currentScore: true, ...wordSelect },
      }),
      this.prisma.userWord.findFirst({
        where: { userId, timesUnknown: { gt: 0 } },
        orderBy: [{ timesUnknown: 'desc' }, { firstSeenAt: 'asc' }],
        select: { timesUnknown: true, ...wordSelect },
      }),
      this.prisma.userWord.findFirst({
        where: learned,
        orderBy: [{ timesSeenToLearn: 'asc' }, { firstLearnedAt: 'asc' }],
        select: { timesSeenToLearn: true, ...wordSelect },
      }),
      this.prisma.userWord.findFirst({
        where: learned,
        orderBy: [{ timesSeenToLearn: 'desc' }, { firstLearnedAt: 'asc' }],
        select: { timesSeenToLearn: true, ...wordSelect },
      }),
    ]);

    return {
      easiest: toStatsWord(easiest, (row) => row.currentScore),
      hardest: toStatsWord(hardest, (row) => row.currentScore),
      mostForgotten: toStatsWord(mostForgotten, (row) => row.timesUnknown),
      fastestLearned: toStatsWord(fastestLearned, (row) => row.timesSeenToLearn ?? 0),
      mostRepeated: toStatsWord(mostRepeated, (row) => row.timesSeenToLearn ?? 0),
    };
  }

  /** Активность по дням текущего календарного месяца (§4.6). */
  private async heatmap(userId: number, timezone: string): Promise<HeatmapDay[]> {
    const today = DateTime.fromJSDate(this.clock.now(), { zone: timezone });
    const monthPrefix = today.toFormat('yyyy-MM');

    const days = await this.prisma.userDay.findMany({
      where: { userId, localDate: { startsWith: monthPrefix } },
      select: { localDate: true, completedSessions: true },
    });

    const byDay = new Map(
      days.map((day) => [Number(day.localDate.slice(8, 10)), day.completedSessions]),
    );

    return Array.from({ length: today.day }, (_, index) => ({
      day: index + 1,
      sessions: byDay.get(index + 1) ?? 0,
    }));
  }

  private async difficultWords(userId: number): Promise<StatsWord[]> {
    const rows = await this.prisma.userWord.findMany({
      where: { userId, timesUnknown: { gt: 0 } },
      orderBy: [{ timesUnknown: 'desc' }, { firstSeenAt: 'asc' }],
      take: DIFFICULT_WORDS_LIMIT,
      select: { timesUnknown: true, ...wordSelect },
    });

    return rows.map((row) => ({
      polish: row.word.polish,
      russian: row.word.russian,
      value: row.timesUnknown,
    }));
  }
}

function pickTopKey<K>(order: K[], counts: Map<K, number>): K | null {
  let best: K | null = null;
  let bestCount = 0;

  for (const key of order) {
    const count = counts.get(key) ?? 0;
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }

  return best;
}
