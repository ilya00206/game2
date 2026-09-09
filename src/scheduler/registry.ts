import type { PrismaClient } from '@prisma/client';

export interface ScheduleEntry {
  userId: number;
  telegramId: bigint;
  timezone: string;
  reminderHour: number;
}

/**
 * Реестр в памяти: холостой минутный тик не должен обращаться к БД (§2.2).
 * Обновляется сразу после создания пользователя или изменения настройки.
 */
class SchedulerRegistry {
  private readonly entries = new Map<number, ScheduleEntry>();

  async load(prisma: PrismaClient): Promise<void> {
    const users = await prisma.user.findMany({
      select: { id: true, telegramId: true, timezone: true, reminderHour: true },
    });

    this.entries.clear();
    for (const user of users) {
      this.entries.set(user.id, {
        userId: user.id,
        telegramId: user.telegramId,
        timezone: user.timezone,
        reminderHour: user.reminderHour,
      });
    }
  }

  upsert(entry: ScheduleEntry): void {
    this.entries.set(entry.userId, entry);
  }

  updateReminderHour(userId: number, reminderHour: number): void {
    const entry = this.entries.get(userId);
    if (entry) {
      this.entries.set(userId, { ...entry, reminderHour });
    }
  }

  all(): ScheduleEntry[] {
    return [...this.entries.values()];
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

export const schedulerRegistry = new SchedulerRegistry();
