import type { Services } from '../services.js';
import { logger } from '../logger.js';
import { localHour, localMinute, toLocalDate } from '../core/time.js';
import { EVENING_REMINDER_HOUR, type ReminderType } from '../core/reminders/reminderService.js';
import type { ScheduleEntry } from './registry.js';

/** Отправка выполняется только после коммита резервирования (§5.1). */
export type ReminderSender = (telegramId: bigint, text: string) => Promise<void>;

export interface DueReminder {
  entry: ScheduleEntry;
  type: ReminderType;
  localDate: string;
}

/** Чистая проверка по времени: выполняется в памяти, без запросов к БД (§2.2). */
export function collectDueReminders(entries: ScheduleEntry[], now: Date): DueReminder[] {
  const due: DueReminder[] = [];

  for (const entry of entries) {
    if (localMinute(now, entry.timezone) !== 0) {
      continue;
    }

    const hour = localHour(now, entry.timezone);
    const localDate = toLocalDate(now, entry.timezone);

    if (hour === entry.reminderHour) {
      due.push({ entry, type: 'MORNING', localDate });
    }

    if (hour === EVENING_REMINDER_HOUR) {
      due.push({ entry, type: 'EVENING', localDate });
    }
  }

  return due;
}

export async function deliverReminder(
  services: Services,
  send: ReminderSender,
  due: DueReminder,
): Promise<void> {
  const { reminders, streaks } = services;
  const { entry, type, localDate } = due;

  await streaks.reconcile(entry.userId);

  if (type === 'EVENING' && !(await reminders.shouldSendEvening(entry.userId, localDate))) {
    return;
  }

  if (!(await reminders.reserve(entry.userId, type, localDate))) {
    return;
  }

  const text =
    type === 'MORNING'
      ? await reminders.buildMorning(entry.userId, localDate)
      : await reminders.buildEvening(entry.userId);

  await send(entry.telegramId, text);
  await reminders.markSent(entry.userId, type, localDate);

  logger.info({ userId: entry.userId, type, localDate }, 'Напоминание отправлено');
}
