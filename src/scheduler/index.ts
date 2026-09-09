import cron from 'node-cron';
import type { Services } from '../services.js';
import { logger } from '../logger.js';
import { localHour, localMinute, toLocalDate } from '../core/time.js';
import { schedulerRegistry } from './registry.js';
import { collectDueReminders, deliverReminder, type ReminderSender } from './reminders.js';

const PROCESSED_UPDATE_TTL_DAYS = 7;
const CLEANUP_BATCH_SIZE = 500;
const CLEANUP_HOUR_UTC = 3;
const RECONCILE_HOUR = 0;
const RECONCILE_MINUTE = 5;

/** Удаляет старые записи пакетами, чтобы не держать долгую блокировку (§2.2). */
export async function cleanupProcessedUpdates(services: Services): Promise<number> {
  const threshold = new Date(
    services.clock.now().getTime() - PROCESSED_UPDATE_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  let removed = 0;
  for (;;) {
    const batch = await services.prisma.processedTelegramUpdate.findMany({
      where: { processedAt: { lt: threshold } },
      select: { updateId: true },
      take: CLEANUP_BATCH_SIZE,
    });

    if (batch.length === 0) {
      break;
    }

    const result = await services.prisma.processedTelegramUpdate.deleteMany({
      where: { updateId: { in: batch.map((row) => row.updateId) } },
    });
    removed += result.count;

    if (batch.length < CLEANUP_BATCH_SIZE) {
      break;
    }
  }

  return removed;
}

export interface SchedulerHandle {
  stop(): void;
}

/**
 * Ежеминутный тик сравнивает время в памяти; при отсутствии задач
 * выполняет 0 запросов к БД и 0 вызовов Telegram API (§2.2).
 */
export function startScheduler(services: Services, send: ReminderSender): SchedulerHandle {
  let lastCleanupDate: string | null = null;
  const lastReconciled = new Map<number, string>();

  const task = cron.schedule('* * * * *', () => {
    void runTick();
  });

  async function runTick(): Promise<void> {
    const now = services.clock.now();
    const entries = schedulerRegistry.all();

    // Сравнение времени идёт по реестру в памяти: холостой тик не трогает БД (§2.2).
    const due = entries.filter((entry) => {
      if (
        localHour(now, entry.timezone) !== RECONCILE_HOUR ||
        localMinute(now, entry.timezone) !== RECONCILE_MINUTE
      ) {
        return false;
      }
      return lastReconciled.get(entry.userId) !== toLocalDate(now, entry.timezone);
    });

    for (const entry of due) {
      lastReconciled.set(entry.userId, toLocalDate(now, entry.timezone));
      try {
        await services.streaks.reconcile(entry.userId);
      } catch (error) {
        logger.error({ err: error, userId: entry.userId }, 'Ошибка сверки стрика');
      }
    }

    for (const reminder of collectDueReminders(entries, now)) {
      try {
        await deliverReminder(services, send, reminder);
      } catch (error) {
        logger.error(
          { err: error, userId: reminder.entry.userId, type: reminder.type },
          'Ошибка отправки напоминания',
        );
      }
    }

    const utcDate = toLocalDate(now, 'utc');
    if (now.getUTCHours() === CLEANUP_HOUR_UTC && lastCleanupDate !== utcDate) {
      lastCleanupDate = utcDate;
      try {
        const removed = await cleanupProcessedUpdates(services);
        if (removed > 0) {
          logger.info({ removed }, 'Очищены старые ProcessedTelegramUpdate');
        }
      } catch (error) {
        logger.error({ err: error }, 'Ошибка очистки ProcessedTelegramUpdate');
      }
    }
  }

  return {
    stop: () => {
      task.stop();
    },
  };
}
