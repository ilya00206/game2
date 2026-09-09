import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { withWriteRetry } from '../../db/retry.js';
import { validateTemplate, type ContentKey } from '../../content/keys.js';
import { seedTextFor } from '../../content/seed.js';
import { SINGLETON_ID } from '../economy/config.js';

export const MAX_REASON_LENGTH = 500;

export const grantSchema = z.object({
  amount: z.number().int().positive(),
  reason: z.string().trim().min(1).max(MAX_REASON_LENGTH),
});

export const streakSchema = z.object({
  value: z.number().int().min(0),
  reason: z.string().trim().min(1).max(MAX_REASON_LENGTH),
});

export const currencyConfigSchema = z.object({
  icon: z.string().trim().min(1).max(16),
  nameOne: z.string().trim().min(1).max(32),
  nameFew: z.string().trim().min(1).max(32),
  nameMany: z.string().trim().min(1).max(32),
});

export const economyConfigSchema = z.object({
  flashcardReward: z.number().int().min(0),
  testReward: z.number().int().min(0),
  dailyLearningLimit: z.number().int().min(0),
  giftSmallPrice: z.number().int().min(0),
  giftSpecialPrice: z.number().int().min(0),
  shieldPrice: z.number().int().min(0),
});

export const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const MAX_MESSAGE_LENGTH = 3500;
export const messageSchema = z.string().trim().min(1).max(MAX_MESSAGE_LENGTH);

export type ReserveMessageResult =
  | { ok: true; telegramId: bigint; text: string }
  | { ok: false; reason: 'INVALID' | 'USER_NOT_FOUND' | 'ALREADY_SENT' };

export interface AdminUserRow {
  id: number;
  telegramId: bigint;
  firstName: string | null;
  username: string | null;
  currentStreak: number;
  maxStreak: number;
  currencyBalance: number;
  shields: number;
}

export type AdminActionResult =
  | { ok: true; alreadyApplied: boolean }
  | { ok: false; reason: 'INVALID' | 'USER_NOT_FOUND' };

export type WordOfDayResult =
  | { ok: true }
  | { ok: false; reason: 'INVALID_DATE' | 'WORD_NOT_FOUND' };

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export class AdminService {
  constructor(private readonly prisma: PrismaClient) {}

  async listUsers(limit = 20): Promise<AdminUserRow[]> {
    return this.prisma.user.findMany({
      select: {
        id: true,
        telegramId: true,
        firstName: true,
        username: true,
        currentStreak: true,
        maxStreak: true,
        currencyBalance: true,
        shields: true,
      },
      orderBy: { id: 'asc' },
      take: limit,
    });
  }

  async getUser(userId: number): Promise<AdminUserRow | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        telegramId: true,
        firstName: true,
        username: true,
        currentStreak: true,
        maxStreak: true,
        currencyBalance: true,
        shields: true,
      },
    });
  }

  /**
   * Резервирует разовое сообщение до вызова Telegram (§5.1).
   * Повтор с тем же `requestId` не отправляет второй раз.
   */
  async reserveMessage(params: {
    adminTelegramId: bigint;
    userId: number;
    text: string;
    requestId: string;
  }): Promise<ReserveMessageResult> {
    const parsed = messageSchema.safeParse(params.text);
    if (!parsed.success) {
      return { ok: false, reason: 'INVALID' };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: { telegramId: true },
    });

    if (!user) {
      return { ok: false, reason: 'USER_NOT_FOUND' };
    }

    const idempotencyKey = `ADMIN_MESSAGE:${params.userId}:${params.requestId}`;

    try {
      await withWriteRetry(() =>
        this.prisma.adminMessage.create({
          data: {
            idempotencyKey,
            adminTelegramId: params.adminTelegramId,
            userId: params.userId,
            text: parsed.data,
          },
        }),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { ok: false, reason: 'ALREADY_SENT' };
      }
      throw error;
    }

    return { ok: true, telegramId: user.telegramId, text: parsed.data };
  }

  async markMessageSent(userId: number, requestId: string): Promise<void> {
    await this.prisma.adminMessage
      .update({
        where: { idempotencyKey: `ADMIN_MESSAGE:${userId}:${requestId}` },
        data: { sentAt: new Date() },
      })
      .catch(() => undefined);
  }

  /**
   * Ручное начисление: не влияет на дневной лимит и стрик, идемпотентно
   * по `ADMIN_GRANT:{userId}:{requestId}` (§3.1).
   */
  async grantCurrency(params: {
    adminTelegramId: bigint;
    userId: number;
    amount: number;
    reason: string;
    requestId: string;
  }): Promise<AdminActionResult> {
    const parsed = grantSchema.safeParse({ amount: params.amount, reason: params.reason });
    if (!parsed.success) {
      return { ok: false, reason: 'INVALID' };
    }

    const idempotencyKey = `ADMIN_GRANT:${params.userId}:${params.requestId}`;

    try {
      await withWriteRetry(() =>
        this.prisma.$transaction(async (tx) => {
          const user = await tx.user.update({
            where: { id: params.userId },
            data: { currencyBalance: { increment: parsed.data.amount } },
            select: { currencyBalance: true },
          });

          await tx.currencyTransaction.create({
            data: {
              idempotencyKey,
              userId: params.userId,
              amount: parsed.data.amount,
              reason: 'ADMIN',
              balanceAfter: user.currencyBalance,
            },
          });

          await tx.adminAdjustment.create({
            data: {
              idempotencyKey,
              adminTelegramId: params.adminTelegramId,
              userId: params.userId,
              type: 'CURRENCY_GRANT',
              value: parsed.data.amount,
              reason: parsed.data.reason,
            },
          });
        }),
      );

      return { ok: true, alreadyApplied: false };
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { ok: true, alreadyApplied: true };
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return { ok: false, reason: 'USER_NOT_FOUND' };
      }
      throw error;
    }
  }

  /** Возврат стрика не уменьшает `maxStreak` и не переписывает статусы дней (§3.2). */
  async restoreStreak(params: {
    adminTelegramId: bigint;
    userId: number;
    value: number;
    reason: string;
    requestId: string;
  }): Promise<AdminActionResult> {
    const parsed = streakSchema.safeParse({ value: params.value, reason: params.reason });
    if (!parsed.success) {
      return { ok: false, reason: 'INVALID' };
    }

    const idempotencyKey = `STREAK_RESTORE:${params.userId}:${params.requestId}`;

    try {
      await withWriteRetry(() =>
        this.prisma.$transaction(async (tx) => {
          const user = await tx.user.findUniqueOrThrow({
            where: { id: params.userId },
            select: { maxStreak: true },
          });

          await tx.user.update({
            where: { id: params.userId },
            data: {
              currentStreak: parsed.data.value,
              maxStreak: Math.max(user.maxStreak, parsed.data.value),
            },
          });

          await tx.adminAdjustment.create({
            data: {
              idempotencyKey,
              adminTelegramId: params.adminTelegramId,
              userId: params.userId,
              type: 'STREAK_RESTORE',
              value: parsed.data.value,
              reason: parsed.data.reason,
            },
          });
        }),
      );

      return { ok: true, alreadyApplied: false };
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { ok: true, alreadyApplied: true };
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return { ok: false, reason: 'USER_NOT_FOUND' };
      }
      throw error;
    }
  }

  async updateCurrencyConfig(
    values: z.infer<typeof currencyConfigSchema>,
    adminUserId: number,
  ): Promise<boolean> {
    const parsed = currencyConfigSchema.safeParse(values);
    if (!parsed.success) {
      return false;
    }

    await this.prisma.currencyConfig.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...parsed.data, updatedById: adminUserId },
      update: { ...parsed.data, updatedById: adminUserId },
    });

    return true;
  }

  async updateEconomyField(
    field: keyof z.infer<typeof economyConfigSchema>,
    value: number,
    adminUserId: number,
  ): Promise<boolean> {
    if (!Number.isInteger(value) || value < 0) {
      return false;
    }

    await this.prisma.economyConfig.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, [field]: value, updatedById: adminUserId },
      update: { [field]: value, updatedById: adminUserId },
    });

    return true;
  }

  /** Реактивация категории не включает слова автоматически (§4.8). */
  async setCategoryActive(categoryId: number, isActive: boolean): Promise<boolean> {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!category) {
      return false;
    }

    await withWriteRetry(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.category.update({ where: { id: categoryId }, data: { isActive } });
        if (!isActive) {
          await tx.word.updateMany({ where: { categoryId }, data: { isActive: false } });
        }
      }),
    );

    return true;
  }

  async setWordActive(wordId: number, isActive: boolean): Promise<boolean> {
    const word = await this.prisma.word.findUnique({
      where: { id: wordId },
      select: { id: true },
    });
    if (!word) {
      return false;
    }

    await this.prisma.word.update({ where: { id: wordId }, data: { isActive } });
    return true;
  }

  async listTextVariants(key: ContentKey) {
    return this.prisma.contentText.findMany({
      where: { key },
      select: { id: true, variant: true, text: true, isActive: true, isSeed: true },
      orderBy: { variant: 'asc' },
    });
  }

  /** Номер варианта назначается автоматически: max + 1 (§2). */
  async addTextVariant(
    key: ContentKey,
    group: string,
    text: string,
    adminUserId: number,
  ): Promise<{ ok: true; variant: number } | { ok: false; errors: string[] }> {
    const errors = validateTemplate(key, text);
    if (errors.length > 0) {
      return { ok: false, errors };
    }

    const last = await this.prisma.contentText.findFirst({
      where: { key },
      select: { variant: true },
      orderBy: { variant: 'desc' },
    });

    const variant = (last?.variant ?? -1) + 1;

    await this.prisma.contentText.create({
      data: { key, variant, group, text, isSeed: false, updatedById: adminUserId },
    });

    return { ok: true, variant };
  }

  async updateTextVariant(
    key: ContentKey,
    variant: number,
    text: string,
    adminUserId: number,
  ): Promise<{ ok: true } | { ok: false; errors: string[] }> {
    const errors = validateTemplate(key, text);
    if (errors.length > 0) {
      return { ok: false, errors };
    }

    await this.prisma.contentText.update({
      where: { key_variant: { key, variant } },
      data: { text, updatedById: adminUserId },
    });

    return { ok: true };
  }

  async toggleTextVariant(key: ContentKey, variant: number): Promise<boolean> {
    const row = await this.prisma.contentText.findUnique({
      where: { key_variant: { key, variant } },
      select: { isActive: true },
    });
    if (!row) {
      return false;
    }

    await this.prisma.contentText.update({
      where: { key_variant: { key, variant } },
      data: { isActive: !row.isActive },
    });

    return true;
  }

  /** Возвращает seed-вариант к исходному тексту; пользовательские варианты не трогает (§2). */
  async restoreSeedVariant(key: ContentKey, variant: number): Promise<boolean> {
    const text = seedTextFor(key, variant);
    if (!text) {
      return false;
    }

    await this.prisma.contentText.upsert({
      where: { key_variant: { key, variant } },
      create: { key, variant, group: 'UI', text, isSeed: true, isActive: true },
      update: { text, isActive: true },
    });

    return true;
  }

  async setWordOfDay(date: string, polish: string): Promise<WordOfDayResult> {
    if (!localDateSchema.safeParse(date).success) {
      return { ok: false, reason: 'INVALID_DATE' };
    }

    const word = await this.prisma.word.findFirst({
      where: { polish, isActive: true },
      select: { id: true },
    });

    if (!word) {
      return { ok: false, reason: 'WORD_NOT_FOUND' };
    }

    await this.prisma.wordOfDay.upsert({
      where: { date },
      create: { date, wordId: word.id },
      update: { wordId: word.id },
    });

    return { ok: true };
  }

  async removeWordOfDay(date: string): Promise<boolean> {
    const deleted = await this.prisma.wordOfDay.deleteMany({ where: { date } });
    return deleted.count > 0;
  }

  async listWordOfDay(fromDate: string, limit = 10) {
    return this.prisma.wordOfDay.findMany({
      where: { date: { gte: fromDate } },
      select: { date: true, word: { select: { polish: true, russian: true } } },
      orderBy: { date: 'asc' },
      take: limit,
    });
  }
}
