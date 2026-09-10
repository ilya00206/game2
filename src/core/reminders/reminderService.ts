import type { PrismaClient } from '@prisma/client';
import type { ContentService } from '../../content/service.js';
import { escapeHtml } from '../../content/service.js';
import { withWriteRetry } from '../../db/retry.js';

export const REMINDER_TYPES = ['MORNING', 'EVENING'] as const;
export type ReminderType = (typeof REMINDER_TYPES)[number];

export const EVENING_REMINDER_HOUR = 21;

export function reminderKey(type: ReminderType, userId: number, localDate: string): string {
  return `${type}:${userId}:${localDate}`;
}

export interface ReminderServiceDeps {
  prisma: PrismaClient;
  content: ContentService;
}

export class ReminderService {
  constructor(private readonly deps: ReminderServiceDeps) {}

  /**
   * Резервирует доставку до вызова Telegram: семантика at-most-once (§9).
   * `false` — на эту локальную дату уже резервировали.
   */
  async reserve(userId: number, type: ReminderType, localDate: string): Promise<boolean> {
    const idempotencyKey = reminderKey(type, userId, localDate);

    try {
      await withWriteRetry(() =>
        this.deps.prisma.reminderDelivery.create({
          data: { idempotencyKey, userId, type, localDate },
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async markSent(userId: number, type: ReminderType, localDate: string): Promise<void> {
    await this.deps.prisma.reminderDelivery
      .update({
        where: { idempotencyKey: reminderKey(type, userId, localDate) },
        data: { sentAt: new Date() },
      })
      .catch(() => undefined);
  }

  /** Приятность + саммари + блок «Слово дня», если он задан на эту дату (§6.1). */
  async buildMorning(userId: number, localDate: string): Promise<string> {
    const user = await this.deps.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { currentStreak: true },
    });

    const blocks = [
      await this.deps.content.render('reminder.morning', userId, {
        streak: user.currentStreak,
      }),
    ];

    const wordOfDay = await this.deps.prisma.wordOfDay.findUnique({
      where: { date: localDate },
      select: { polish: true, russian: true },
    });

    if (wordOfDay) {
      const intro = await this.deps.content.render('word_of_day.intro', userId);
      blocks.push(
        `❤️ Слово дня: <b>${escapeHtml(wordOfDay.polish)}</b> — ${escapeHtml(wordOfDay.russian)}\n${intro}`,
      );
    }

    return blocks.join('\n\n');
  }

  /** Вечернее напоминание не отправляется, если день уже закрыт (§3.2). */
  async shouldSendEvening(userId: number, localDate: string): Promise<boolean> {
    const day = await this.deps.prisma.userDay.findUnique({
      where: { userId_localDate: { userId, localDate } },
      select: { status: true },
    });

    return day?.status !== 'COMPLETED' && day?.status !== 'EARLY';
  }

  async buildEvening(userId: number): Promise<string> {
    const user = await this.deps.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { currentStreak: true },
    });

    return this.deps.content.render('reminder.evening', userId, {
      streak: user.currentStreak,
    });
  }
}
