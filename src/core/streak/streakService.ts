import type { PrismaTransaction } from '../../db/types.js';
import { shieldEventKey, type DomainEvent } from '../events/types.js';
import { toLocalDate } from '../time.js';
import { MAX_RECONCILE_DAYS, reconcileDays, type DayStatus } from './reconcile.js';

export interface StreakOutcome {
  today: string;
  previousStreak: number;
  currentStreak: number;
  maxStreak: number;
  isNewRecord: boolean;
  increasedToday: boolean;
  shieldedDates: string[];
  missedDates: string[];
  completedSessionsToday: number;
  events: DomainEvent[];
}

export interface ApplyStreakParams {
  userId: number;
  timezone: string;
  now: Date;
  /** true — засчитать сегодняшнюю полностью пройденную сессию. */
  registerCompletedSession: boolean;
}

/**
 * Сверяет необработанные даты и применяет их к серии одной транзакцией.
 * Идемпотентность обеспечивает `UserDay.streakAppliedAt` (§3.2).
 */
export async function applyStreak(
  tx: PrismaTransaction,
  params: ApplyStreakParams,
): Promise<StreakOutcome> {
  const today = toLocalDate(params.now, params.timezone);

  const user = await tx.user.findUniqueOrThrow({
    where: { id: params.userId },
    select: { currentStreak: true, maxStreak: true, shields: true },
  });

  if (params.registerCompletedSession) {
    await registerCompletedSession(tx, params.userId, today);
  }

  const rows = await tx.userDay.findMany({
    where: { userId: params.userId, localDate: { lte: today } },
    select: { localDate: true, status: true, streakAppliedAt: true, completedSessions: true },
    orderBy: { localDate: 'desc' },
    take: MAX_RECONCILE_DAYS + 1,
  });

  const result = reconcileDays({
    today,
    days: rows.map((row) => ({
      localDate: row.localDate,
      status: row.status as DayStatus,
      applied: row.streakAppliedAt !== null,
    })),
    currentStreak: user.currentStreak,
    maxStreak: user.maxStreak,
    shields: user.shields,
  });

  const created = result.mutations.filter((mutation) => mutation.create);
  if (created.length > 0) {
    await tx.userDay.createMany({
      data: created.map((mutation) => ({
        userId: params.userId,
        localDate: mutation.localDate,
        status: mutation.status,
        completedSessions: 0,
        shieldConsumed: mutation.consumesShield,
        streakAppliedAt: params.now,
      })),
    });
  }

  const existing = result.mutations.filter((mutation) => !mutation.create);
  if (existing.length > 0) {
    await tx.userDay.updateMany({
      where: {
        userId: params.userId,
        localDate: { in: existing.map((mutation) => mutation.localDate) },
        streakAppliedAt: null,
      },
      data: { streakAppliedAt: params.now },
    });
  }

  if (
    result.currentStreak !== user.currentStreak ||
    result.maxStreak !== user.maxStreak ||
    result.shields !== user.shields
  ) {
    await tx.user.update({
      where: { id: params.userId },
      data: {
        currentStreak: result.currentStreak,
        maxStreak: result.maxStreak,
        shields: result.shields,
      },
    });
  }

  const completedSessionsToday =
    rows.find((row) => row.localDate === today)?.completedSessions ?? 0;

  return {
    today,
    previousStreak: user.currentStreak,
    currentStreak: result.currentStreak,
    maxStreak: result.maxStreak,
    isNewRecord: result.maxStreak > user.maxStreak,
    increasedToday: result.streakIncreasedOn.includes(today),
    shieldedDates: result.shieldedDates,
    missedDates: result.missedDates,
    completedSessionsToday,
    events: result.shieldedDates.map((localDate) => ({
      eventType: 'SHIELD_USED' as const,
      idempotencyKey: shieldEventKey(params.userId, localDate),
      userId: params.userId,
      sessionId: null,
      cardId: null,
      answer: null,
      responseTimeMs: null,
      timestamp: params.now,
    })),
  };
}

/** Бронь EARLY на сегодня считается использованной, но повторно стрик не увеличивает. */
async function registerCompletedSession(
  tx: PrismaTransaction,
  userId: number,
  today: string,
): Promise<void> {
  const existing = await tx.userDay.findUnique({
    where: { userId_localDate: { userId, localDate: today } },
    select: { status: true },
  });

  if (!existing) {
    await tx.userDay.create({
      data: { userId, localDate: today, status: 'COMPLETED', completedSessions: 1 },
    });
    return;
  }

  await tx.userDay.update({
    where: { userId_localDate: { userId, localDate: today } },
    data: { status: 'COMPLETED', completedSessions: { increment: 1 } },
  });
}

export type EarlyStreakResult =
  | { ok: true; localDate: string }
  | { ok: false; reason: 'NOT_ENOUGH_SESSIONS' | 'ALREADY_BOOKED' };

export const EARLY_STREAK_REQUIRED_SESSIONS = 3;

/** Бронь строго на следующую локальную дату; одновременно допускается только одна (§3.2). */
export async function bookEarlyStreak(
  tx: PrismaTransaction,
  params: { userId: number; today: string; tomorrow: string },
): Promise<EarlyStreakResult> {
  const todayRow = await tx.userDay.findUnique({
    where: { userId_localDate: { userId: params.userId, localDate: params.today } },
    select: { completedSessions: true },
  });

  if ((todayRow?.completedSessions ?? 0) < EARLY_STREAK_REQUIRED_SESSIONS) {
    return { ok: false, reason: 'NOT_ENOUGH_SESSIONS' };
  }

  const future = await tx.userDay.findFirst({
    where: { userId: params.userId, status: 'EARLY', localDate: { gt: params.today } },
    select: { localDate: true },
  });

  if (future) {
    return { ok: false, reason: 'ALREADY_BOOKED' };
  }

  const existingTomorrow = await tx.userDay.findUnique({
    where: { userId_localDate: { userId: params.userId, localDate: params.tomorrow } },
    select: { status: true },
  });

  if (existingTomorrow) {
    return { ok: false, reason: 'ALREADY_BOOKED' };
  }

  await tx.userDay.create({
    data: { userId: params.userId, localDate: params.tomorrow, status: 'EARLY' },
  });

  return { ok: true, localDate: params.tomorrow };
}
