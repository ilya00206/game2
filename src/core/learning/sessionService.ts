import type { Prisma, PrismaClient } from '@prisma/client';
import type { PrismaTransaction } from '../../db/types.js';
import type { ConfigService, EconomySettings } from '../economy/config.js';
import { generateTest } from '../test/generator.js';
import { isCategoryEligible } from '../test/normalize.js';
import { QUESTION_COUNT } from '../test/weights.js';
import { localDayRange, toLocalDate } from '../time.js';
import {
  grantSessionReward,
  maybeGrantSurprise,
  type RewardResult,
  type SurpriseResult,
} from '../economy/economyService.js';
import type { EventSink } from '../events/types.js';
import { cardEventKey, sessionEventKey, type DomainEvent } from '../events/types.js';
import type { Rng } from '../random.js';
import {
  applyStreak,
  EARLY_STREAK_REQUIRED_SESSIONS,
  type StreakOutcome,
} from '../streak/streakService.js';
import type { Clock } from '../time.js';
import { withWriteRetry } from '../../db/retry.js';
import { buildSessionPlan, summarizeCategory, type CategorySummary } from './planner.js';
import { applyAnswer, emptyProgress, type AnswerKind, type WordProgress } from './progress.js';
import type { Direction } from './schemas.js';
import { parseOptions, serializeOptions, type TestOption } from './schemas.js';

export interface SessionDeps {
  prisma: PrismaClient;
  events: EventSink;
  config: ConfigService;
  clock: Clock;
  rng: Rng;
}

/** Всё, что нужно показать после коммита; Telegram внутри транзакции не вызывается. */
export interface CompletionSummary {
  streak: StreakOutcome;
  reward: RewardResult;
  surprise: SurpriseResult;
  offerEarlyStreak: boolean;
  /** Заполнено только для теста: по каждому вопросу — правильный и выбранный ответ (§4.3). */
  testSummary: TestSummaryItem[] | null;
}

export interface TestSummaryItem {
  polish: string;
  correctRussian: string;
  selectedRussian: string | null;
  isCorrect: boolean;
}

export interface CategoryListItem {
  id: number;
  name: string;
  activeWords: number;
}

export interface CardView {
  cardId: number;
  promptText: string;
  direction: Direction;
  position: number;
  answeredCount: number;
  plannedCount: number;
  mode: 'FLASHCARDS' | 'TEST';
  options: TestOption[] | null;
  /** Итог по уже отвеченным вопросам теста по порядку позиций; null для FLASHCARDS. */
  testResults: boolean[] | null;
}

export interface ActiveSessionView {
  sessionId: number;
  mode: string;
  categoryId: number | null;
  direction: Direction | null;
  answeredCount: number;
  plannedCount: number;
}

export type StartSessionResult =
  | { ok: true; sessionId: number; card: CardView }
  | { ok: false; reason: 'ACTIVE_SESSION_EXISTS' | 'NO_WORDS' };

export type StartTestResult =
  | { ok: true; sessionId: number; card: CardView }
  | { ok: false; reason: 'ACTIVE_SESSION_EXISTS' | 'NOT_ENOUGH_WORDS' };

export type AnswerResult =
  | { accepted: false }
  | {
      accepted: true;
      completed: false;
      card: CardView;
      reveal:
        | {
            promptText: string;
            translationText: string;
            direction: Direction;
            answeredCount: number;
            plannedCount: number;
          }
        | null;
    }
  | { accepted: true; completed: true; sessionId: number; summary: CompletionSummary };

/** Видимость контента: системное + собственное, чужое недоступно (§3.3). */
function visibleOwner(userId: number) {
  return [{ ownerId: null }, { ownerId: userId }];
}

export class SessionService {
  constructor(private readonly deps: SessionDeps) {}

  async listCategories(userId: number): Promise<CategoryListItem[]> {
    const categories = await this.deps.prisma.category.findMany({
      where: { isActive: true, OR: visibleOwner(userId) },
      select: {
        id: true,
        name: true,
        _count: {
          select: { words: { where: { isActive: true, OR: visibleOwner(userId) } } },
        },
      },
      orderBy: { name: 'asc' },
    });

    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      activeWords: category._count.words,
    }));
  }

  async categorySummary(userId: number, categoryId: number): Promise<CategorySummary> {
    const words = await this.deps.prisma.word.findMany({
      where: { categoryId, isActive: true, OR: visibleOwner(userId) },
      select: {
        userWords: {
          where: { userId },
          select: { currentLevel: true, lastAnswer: true, timesKnown: true },
        },
      },
    });

    return summarizeCategory(
      words.map(
        (word) => word.userWords[0] ?? { currentLevel: 0, lastAnswer: null, timesKnown: 0 },
      ),
    );
  }

  async getActiveSession(userId: number): Promise<ActiveSessionView | null> {
    const session = await this.deps.prisma.session.findFirst({
      where: { userId, status: 'ACTIVE' },
      select: {
        id: true,
        mode: true,
        categoryId: true,
        direction: true,
        answeredCount: true,
        plannedCount: true,
      },
    });

    if (!session) {
      return null;
    }

    return {
      sessionId: session.id,
      mode: session.mode,
      categoryId: session.categoryId,
      direction: session.direction as Direction | null,
      answeredCount: session.answeredCount,
      plannedCount: session.plannedCount,
    };
  }

  /** Показывает первую неотвеченную карточку и фиксирует момент показа (§4.3). */
  async currentCard(sessionId: number): Promise<CardView | null> {
    const session = await this.deps.prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        answeredCount: true,
        plannedCount: true,
        direction: true,
        status: true,
        mode: true,
        userId: true,
      },
    });

    if (!session || session.status !== 'ACTIVE') {
      return null;
    }

    const card = await this.deps.prisma.sessionCard.findFirst({
      where: { sessionId, answeredAt: null },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        promptText: true,
        position: true,
        shownAt: true,
        options: true,
        wordId: true,
      },
    });

    if (!card) {
      return null;
    }

    const isTest = session.mode === 'TEST';

    if (card.shownAt === null) {
      await this.deps.prisma.sessionCard.update({
        where: { id: card.id },
        data: { shownAt: this.deps.clock.now() },
      });

      if (isTest) {
        await this.deps.prisma.userWord.upsert({
          where: { userId_wordId: { userId: session.userId, wordId: card.wordId } },
          create: { userId: session.userId, wordId: card.wordId, testSeenCount: 1 },
          update: { testSeenCount: { increment: 1 } },
        });
      }
    }

    const testResults = isTest
      ? (
          await this.deps.prisma.sessionCard.findMany({
            where: { sessionId, answeredAt: { not: null } },
            orderBy: { position: 'asc' },
            select: { isCorrect: true },
          })
        ).map((row) => row.isCorrect ?? false)
      : null;

    return {
      cardId: card.id,
      promptText: card.promptText,
      direction: (session.direction ?? 'PL_RU') as Direction,
      position: card.position,
      mode: isTest ? 'TEST' : 'FLASHCARDS',
      options: parseOptions(card.options),
      answeredCount: session.answeredCount,
      plannedCount: session.plannedCount,
      testResults,
    };
  }

  /**
   * Создаёт сессию и фиксирует план одной транзакцией.
   * Единственность ACTIVE-сессии дополнительно защищена частичным индексом (§4.2).
   */
  async startFlashcardSession(
    userId: number,
    categoryId: number,
    direction: Direction,
  ): Promise<StartSessionResult> {
    const now = this.deps.clock.now();

    const words = await this.deps.prisma.word.findMany({
      where: { categoryId, isActive: true, OR: visibleOwner(userId) },
      select: {
        id: true,
        polish: true,
        russian: true,
        userWords: {
          where: { userId },
          select: {
            currentLevel: true,
            timesUnknown: true,
            consecutiveUnknown: true,
            nextReviewAt: true,
          },
        },
      },
    });

    if (words.length === 0) {
      return { ok: false, reason: 'NO_WORDS' };
    }

    const plan = buildSessionPlan(
      words.map((word) => {
        const progress = word.userWords[0];
        return {
          wordId: word.id,
          currentLevel: progress?.currentLevel ?? 0,
          timesUnknown: progress?.timesUnknown ?? 0,
          consecutiveUnknown: progress?.consecutiveUnknown ?? 0,
          nextReviewAt: progress?.nextReviewAt ?? null,
        };
      }),
      this.deps.rng,
      now,
    );

    if (plan.length === 0) {
      return { ok: false, reason: 'NO_WORDS' };
    }

    const byId = new Map(words.map((word) => [word.id, word]));

    try {
      const sessionId = await withWriteRetry(() =>
        this.deps.prisma.$transaction(async (tx) => {
          const existing = await tx.session.findFirst({
            where: { userId, status: 'ACTIVE' },
            select: { id: true },
          });
          if (existing) {
            throw new ActiveSessionExistsError();
          }

          const session = await tx.session.create({
            data: {
              userId,
              mode: 'FLASHCARDS',
              categoryId,
              direction,
              plannedCount: plan.length,
            },
            select: { id: true },
          });

          await tx.sessionCard.createMany({
            data: plan.map((wordId, index) => {
              const word = byId.get(wordId);
              return {
                sessionId: session.id,
                wordId,
                categoryId,
                position: index,
                promptText: direction === 'PL_RU' ? (word?.polish ?? '') : (word?.russian ?? ''),
                // Перевод — снимок на момент создания плана, показывается после «Не знаю».
                translationText: direction === 'PL_RU' ? (word?.russian ?? '') : (word?.polish ?? ''),
              };
            }),
          });

          return session.id;
        }),
      );

      const card = await this.currentCard(sessionId);
      if (!card) {
        return { ok: false, reason: 'NO_WORDS' };
      }
      return { ok: true, sessionId, card };
    } catch (error) {
      if (error instanceof ActiveSessionExistsError || isUniqueViolation(error)) {
        return { ok: false, reason: 'ACTIVE_SESSION_EXISTS' };
      }
      throw error;
    }
  }

  /**
   * Принимает ответ ровно один раз: атомарный UPDATE ... WHERE answeredAt IS NULL (§5.1).
   * Telegram не вызывается внутри транзакции.
   */
  async answerCard(
    userId: number,
    cardId: number,
    answer: AnswerKind,
    actionId: string,
  ): Promise<AnswerResult> {
    const now = this.deps.clock.now();
    const economy = await this.deps.config.economy();

    const result = await withWriteRetry(() =>
      this.deps.prisma.$transaction(async (tx) => {
        const card = await tx.sessionCard.findUnique({
          where: { id: cardId },
          select: {
            id: true,
            wordId: true,
            sessionId: true,
            shownAt: true,
            promptText: true,
            translationText: true,
            session: {
              select: {
                id: true,
                userId: true,
                mode: true,
                status: true,
                direction: true,
                answeredCount: true,
                plannedCount: true,
                user: { select: { timezone: true } },
              },
            },
          },
        });

        if (!card || card.session.userId !== userId || card.session.status !== 'ACTIVE') {
          return { accepted: false as const };
        }

        const claimed = await tx.sessionCard.updateMany({
          where: { id: cardId, answeredAt: null },
          data: { answer, answeredAt: now, answerActionId: actionId },
        });

        if (claimed.count === 0) {
          return { accepted: false as const };
        }

        const progressRow = await tx.userWord.findUnique({
          where: { userId_wordId: { userId, wordId: card.wordId } },
        });

        const previous: WordProgress = progressRow
          ? {
              timesSeen: progressRow.timesSeen,
              timesKnown: progressRow.timesKnown,
              timesUnknown: progressRow.timesUnknown,
              currentScore: progressRow.currentScore,
              currentLevel: progressRow.currentLevel,
              lastAnswer: progressRow.lastAnswer as AnswerKind | null,
              lastAnswerAt: progressRow.lastAnswerAt,
              consecutiveKnown: progressRow.consecutiveKnown,
              consecutiveUnknown: progressRow.consecutiveUnknown,
              firstSeenAt: progressRow.firstSeenAt,
              lastSeenAt: progressRow.lastSeenAt,
              firstLearnedAt: progressRow.firstLearnedAt,
              timesSeenToLearn: progressRow.timesSeenToLearn,
              nextReviewAt: progressRow.nextReviewAt,
            }
          : emptyProgress();

        const next = applyAnswer(previous, answer, now);

        await tx.userWord.upsert({
          where: { userId_wordId: { userId, wordId: card.wordId } },
          create: { userId, wordId: card.wordId, ...next },
          update: next,
        });

        const answeredCount = card.session.answeredCount + 1;
        const completed = answeredCount >= card.session.plannedCount;

        await tx.session.update({
          where: { id: card.session.id },
          data: {
            answeredCount,
            ...(completed
              ? { status: 'COMPLETED', isFull: true, finishedAt: now }
              : {}),
          },
        });

        const events: DomainEvent[] = [
          {
            eventType: answer === 'KNOW' ? 'CARD_KNOWN' : 'CARD_UNKNOWN',
            idempotencyKey: cardEventKey(
              answer === 'KNOW' ? 'CARD_KNOWN' : 'CARD_UNKNOWN',
              cardId,
            ),
            userId,
            sessionId: card.session.id,
            cardId,
            answer,
            responseTimeMs: card.shownAt ? now.getTime() - card.shownAt.getTime() : null,
            timestamp: now,
          },
        ];

        if (completed) {
          events.push({
            eventType: 'SESSION_FINISHED',
            idempotencyKey: sessionEventKey('SESSION_FINISHED', card.session.id),
            userId,
            sessionId: card.session.id,
            cardId: null,
            answer: null,
            responseTimeMs: null,
            timestamp: now,
          });
        }

        let summary: CompletionSummary | null = null;

        if (completed) {
          summary = await this.applyCompletion(tx, {
            userId,
            sessionId: card.session.id,
            mode: card.session.mode === 'TEST' ? 'TEST' : 'FLASHCARDS',
            timezone: card.session.user.timezone,
            now,
            economy,
            events,
          });
        }

        await this.deps.events.record(tx, events);

        return {
          accepted: true as const,
          completed,
          sessionId: card.session.id,
          summary,
          translationText: card.translationText,
          promptText: card.promptText,
          direction: (card.session.direction ?? 'PL_RU') as Direction,
          answeredCount,
          plannedCount: card.session.plannedCount,
        };
      }),
    );

    if (!result.accepted) {
      return { accepted: false };
    }

    if (result.completed && result.summary) {
      return {
        accepted: true,
        completed: true,
        sessionId: result.sessionId,
        summary: result.summary,
      };
    }

    const card = await this.currentCard(result.sessionId);
    if (!card) {
      return { accepted: false };
    }

    return {
      accepted: true,
      completed: false,
      card,
      reveal:
        answer === 'UNKNOWN' && result.translationText !== null
          ? {
              promptText: result.promptText,
              translationText: result.translationText,
              direction: result.direction,
              answeredCount: result.answeredCount,
              plannedCount: result.plannedCount,
            }
          : null,
    };
  }

  /** Общая для карточек и теста часть: стрик, награда и сюрприз в той же транзакции. */
  private async applyCompletion(
    tx: PrismaTransaction,
    params: {
      userId: number;
      sessionId: number;
      mode: 'FLASHCARDS' | 'TEST';
      timezone: string;
      now: Date;
      economy: EconomySettings;
      events: DomainEvent[];
    },
  ): Promise<CompletionSummary> {
    const streak = await applyStreak(tx, {
      userId: params.userId,
      timezone: params.timezone,
      now: params.now,
      registerCompletedSession: true,
    });

    const reward = await grantSessionReward(tx, {
      userId: params.userId,
      sessionId: params.sessionId,
      mode: params.mode,
      now: params.now,
      timezone: params.timezone,
      localDate: streak.today,
      economy: params.economy,
    });

    const surprise =
      streak.completedSessionsToday === 1
        ? await maybeGrantSurprise(tx, {
            userId: params.userId,
            localDate: streak.today,
            now: params.now,
            rng: this.deps.rng,
          })
        : { granted: false, amount: 0, balanceAfter: null };

    params.events.push(...streak.events);

    const testSummary =
      params.mode === 'TEST' ? await this.buildTestSummary(tx, params.sessionId) : null;

    const offerEarlyStreak =
      streak.completedSessionsToday >= EARLY_STREAK_REQUIRED_SESSIONS &&
      !(await this.hasFutureEarlyBooking(tx, params.userId, streak.today));

    return {
      streak,
      reward,
      surprise,
      offerEarlyStreak,
      testSummary,
    };
  }

  /** Не предлагать повторно, если бронь на следующий день уже сделана (§3.2). */
  private async hasFutureEarlyBooking(
    tx: PrismaTransaction,
    userId: number,
    today: string,
  ): Promise<boolean> {
    const booking = await tx.userDay.findFirst({
      where: { userId, status: 'EARLY', localDate: { gt: today } },
      select: { localDate: true },
    });
    return booking !== null;
  }

  /** Один читаемый список: правильный вариант, выбор пользователя и итог по каждому вопросу. */
  private async buildTestSummary(
    tx: PrismaTransaction,
    sessionId: number,
  ): Promise<TestSummaryItem[]> {
    const cards = await tx.sessionCard.findMany({
      where: { sessionId },
      orderBy: { position: 'asc' },
      select: {
        promptText: true,
        options: true,
        correctOption: true,
        selectedOption: true,
        isCorrect: true,
      },
    });

    return cards.map((card) => {
      const options = parseOptions(card.options) ?? [];
      const correct = card.correctOption !== null ? options[card.correctOption] : undefined;
      const selected = card.selectedOption !== null ? options[card.selectedOption] : undefined;

      return {
        polish: card.promptText,
        correctRussian: correct?.label ?? '—',
        selectedRussian: selected?.label ?? null,
        isCorrect: card.isCorrect ?? false,
      };
    });
  }

  /**
   * Все 10 вопросов создаются сразу, в одной транзакции вместе с Session (§4.3).
   * Кандидаты и варианты читаются одним запросом, без N+1.
   */
  async startTestSession(userId: number): Promise<StartTestResult> {
    const now = this.deps.clock.now();

    const user = await this.deps.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });

    const categories = await this.deps.prisma.category.findMany({
      where: { isActive: true, OR: visibleOwner(userId) },
      select: {
        id: true,
        words: {
          where: { isActive: true, OR: visibleOwner(userId) },
          select: {
            id: true,
            polish: true,
            russian: true,
            userWords: {
              where: { userId },
              select: {
                timesKnown: true,
                testCorrectCount: true,
                testWrongCount: true,
              },
            },
          },
        },
      },
    });

    const wordsByCategory = new Map<number, { wordId: number; russian: string }[]>();
    const candidates = [];

    for (const category of categories) {
      const words = category.words.map((word) => ({ wordId: word.id, russian: word.russian }));
      if (!isCategoryEligible(words)) {
        continue;
      }

      wordsByCategory.set(category.id, words);

      for (const word of category.words) {
        const progress = word.userWords[0];
        if ((progress?.timesKnown ?? 0) > 0) {
          candidates.push({
            wordId: word.id,
            categoryId: category.id,
            polish: word.polish,
            russian: word.russian,
            testCorrectCount: progress?.testCorrectCount ?? 0,
            testWrongCount: progress?.testWrongCount ?? 0,
          });
        }
      }
    }

    if (candidates.length === 0) {
      return { ok: false, reason: 'NOT_ENOUGH_WORDS' };
    }

    const { start, end } = localDayRange(toLocalDate(now, user.timezone), user.timezone);
    const historyRows = await this.deps.prisma.sessionCard.findMany({
      where: {
        session: { userId, mode: 'TEST' },
        shownAt: { gte: start, lt: end },
      },
      select: { wordId: true },
      orderBy: [{ shownAt: 'asc' }, { sessionId: 'asc' }, { position: 'asc' }],
    });

    const questions = generateTest({
      candidates,
      wordsByCategory,
      history: historyRows.map((row) => row.wordId),
      rng: this.deps.rng,
    });

    if (questions.length < QUESTION_COUNT) {
      return { ok: false, reason: 'NOT_ENOUGH_WORDS' };
    }

    try {
      const sessionId = await withWriteRetry(() =>
        this.deps.prisma.$transaction(async (tx) => {
          const existing = await tx.session.findFirst({
            where: { userId, status: 'ACTIVE' },
            select: { id: true },
          });
          if (existing) {
            throw new ActiveSessionExistsError();
          }

          const session = await tx.session.create({
            data: {
              userId,
              mode: 'TEST',
              categoryId: null,
              direction: 'PL_RU',
              plannedCount: questions.length,
            },
            select: { id: true },
          });

          await tx.sessionCard.createMany({
            data: questions.map((question, index) => ({
              sessionId: session.id,
              wordId: question.wordId,
              categoryId: question.categoryId,
              position: index,
              promptText: question.promptText,
              options: serializeOptions(question.options),
              correctOption: question.correctOption,
            })),
          });

          return session.id;
        }),
      );

      const card = await this.currentCard(sessionId);
      if (!card) {
        return { ok: false, reason: 'NOT_ENOUGH_WORDS' };
      }
      return { ok: true, sessionId, card };
    } catch (error) {
      if (error instanceof ActiveSessionExistsError || isUniqueViolation(error)) {
        return { ok: false, reason: 'ACTIVE_SESSION_EXISTS' };
      }
      throw error;
    }
  }

  /** Ответ на вопрос теста: принимается ровно один раз (§5.1). */
  async answerTestCard(
    userId: number,
    cardId: number,
    selectedOption: number,
    actionId: string,
  ): Promise<AnswerResult> {
    const now = this.deps.clock.now();
    const economy = await this.deps.config.economy();

    const result = await withWriteRetry(() =>
      this.deps.prisma.$transaction(async (tx) => {
        const card = await tx.sessionCard.findUnique({
          where: { id: cardId },
          select: {
            id: true,
            wordId: true,
            shownAt: true,
            correctOption: true,
            session: {
              select: {
                id: true,
                userId: true,
                mode: true,
                status: true,
                answeredCount: true,
                plannedCount: true,
                user: { select: { timezone: true } },
              },
            },
          },
        });

        if (
          !card ||
          card.session.userId !== userId ||
          card.session.status !== 'ACTIVE' ||
          card.session.mode !== 'TEST'
        ) {
          return { accepted: false as const };
        }

        const isCorrect = card.correctOption === selectedOption;

        const claimed = await tx.sessionCard.updateMany({
          where: { id: cardId, answeredAt: null },
          data: {
            answer: 'TEST_OPTION',
            selectedOption,
            isCorrect,
            answeredAt: now,
            answerActionId: actionId,
          },
        });

        if (claimed.count === 0) {
          return { accepted: false as const };
        }

        await tx.userWord.upsert({
          where: { userId_wordId: { userId, wordId: card.wordId } },
          create: {
            userId,
            wordId: card.wordId,
            testCorrectCount: isCorrect ? 1 : 0,
            testWrongCount: isCorrect ? 0 : 1,
          },
          update: isCorrect
            ? { testCorrectCount: { increment: 1 } }
            : { testWrongCount: { increment: 1 } },
        });

        const answeredCount = card.session.answeredCount + 1;
        const completed = answeredCount >= card.session.plannedCount;

        await tx.session.update({
          where: { id: card.session.id },
          data: {
            answeredCount,
            ...(completed ? { status: 'COMPLETED', isFull: true, finishedAt: now } : {}),
          },
        });

        const events: DomainEvent[] = [
          {
            eventType: isCorrect ? 'TEST_CORRECT' : 'TEST_WRONG',
            idempotencyKey: cardEventKey(isCorrect ? 'TEST_CORRECT' : 'TEST_WRONG', cardId),
            userId,
            sessionId: card.session.id,
            cardId,
            answer: 'TEST_OPTION',
            responseTimeMs: card.shownAt ? now.getTime() - card.shownAt.getTime() : null,
            timestamp: now,
          },
        ];

        if (completed) {
          events.push({
            eventType: 'SESSION_FINISHED',
            idempotencyKey: sessionEventKey('SESSION_FINISHED', card.session.id),
            userId,
            sessionId: card.session.id,
            cardId: null,
            answer: null,
            responseTimeMs: null,
            timestamp: now,
          });
        }

        let summary: CompletionSummary | null = null;
        if (completed) {
          summary = await this.applyCompletion(tx, {
            userId,
            sessionId: card.session.id,
            mode: 'TEST',
            timezone: card.session.user.timezone,
            now,
            economy,
            events,
          });
        }

        await this.deps.events.record(tx, events);

        return {
          accepted: true as const,
          completed,
          sessionId: card.session.id,
          summary,
        };
      }),
    );

    if (!result.accepted) {
      return { accepted: false };
    }

    if (result.completed && result.summary) {
      return {
        accepted: true,
        completed: true,
        sessionId: result.sessionId,
        summary: result.summary,
      };
    }

    const card = await this.currentCard(result.sessionId);
    if (!card) {
      return { accepted: false };
    }

    // Правильный вариант уже виден в вопросе теста, отдельного раскрытия не нужно.
    return { accepted: true, completed: false, card, reveal: null };
  }

  /** Досрочное завершение: ответы сохраняются, награда и стрик не начисляются (§4.2). */
  async abandonSession(userId: number): Promise<number | null> {
    const now = this.deps.clock.now();

    return withWriteRetry(() =>
      this.deps.prisma.$transaction(async (tx) => {
        const session = await tx.session.findFirst({
          where: { userId, status: 'ACTIVE' },
          select: { id: true },
        });

        if (!session) {
          return null;
        }

        const closed = await tx.session.updateMany({
          where: { id: session.id, status: 'ACTIVE' },
          data: { status: 'ABANDONED', finishedAt: now },
        });

        if (closed.count === 0) {
          return null;
        }

        await this.deps.events.record(tx, [
          {
            eventType: 'SESSION_ABANDONED',
            idempotencyKey: sessionEventKey('SESSION_ABANDONED', session.id),
            userId,
            sessionId: session.id,
            cardId: null,
            answer: null,
            responseTimeMs: null,
            timestamp: now,
          },
        ]);

        return session.id;
      }),
    );
  }
}

class ActiveSessionExistsError extends Error {}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as Prisma.PrismaClientKnownRequestError;
  return candidate?.code === 'P2002';
}
