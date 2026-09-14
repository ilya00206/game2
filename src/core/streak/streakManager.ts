import type { PrismaClient } from '@prisma/client';
import type { EventSink } from '../events/types.js';
import { addDaysToLocalDate, toLocalDate, type Clock } from '../time.js';
import { withWriteRetry } from '../../db/retry.js';
import { applyStreak, bookEarlyStreak, type EarlyStreakResult, type StreakOutcome } from './streakService.js';

export interface StreakManagerDeps {
  prisma: PrismaClient;
  events: EventSink;
  clock: Clock;
}

export class StreakManager {
  constructor(private readonly deps: StreakManagerDeps) {}

  /** Сверка без регистрации сессии: перед показом стрика, покупкой и напоминанием (§3.2). */
  async reconcile(userId: number): Promise<StreakOutcome> {
    const now = this.deps.clock.now();
    const user = await this.deps.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });

    return withWriteRetry(() =>
      this.deps.prisma.$transaction(async (tx) => {
        const outcome = await applyStreak(tx, {
          userId,
          timezone: user.timezone,
          now,
          registerCompletedSession: false,
        });

        await this.deps.events.record(tx, outcome.events);
        return outcome;
      }),
    );
  }

  async bookEarly(userId: number): Promise<EarlyStreakResult> {
    const now = this.deps.clock.now();
    const user = await this.deps.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });

    const today = toLocalDate(now, user.timezone);

    return withWriteRetry(() =>
      this.deps.prisma.$transaction((tx) =>
        bookEarlyStreak(tx, { userId, today, tomorrow: addDaysToLocalDate(today, 1) }),
      ),
    );
  }

  /** Есть ли уже действующая бронь `EARLY` на будущую дату (для отображения в меню). */
  async hasEarlyBooking(userId: number): Promise<boolean> {
    const now = this.deps.clock.now();
    const user = await this.deps.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });
    const today = toLocalDate(now, user.timezone);

    const future = await this.deps.prisma.userDay.findFirst({
      where: { userId, status: 'EARLY', localDate: { gt: today } },
      select: { localDate: true },
    });

    return future !== null;
  }
}
