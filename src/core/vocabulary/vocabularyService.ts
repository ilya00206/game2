import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { withWriteRetry } from '../../db/retry.js';

export const MAX_TEXT_LENGTH = 100;

export const wordInputSchema = z.object({
  polish: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  russian: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
});

export const categoryNameSchema = z.string().trim().min(1).max(MAX_TEXT_LENGTH);

export type AddWordResult =
  | { ok: true; wordId: number }
  | { ok: false; reason: 'INVALID' | 'DUPLICATE' | 'CATEGORY_NOT_FOUND' };

export type CreateCategoryResult =
  | { ok: true; categoryId: number }
  | { ok: false; reason: 'INVALID' | 'DUPLICATE' };

export type DeactivateResult = { ok: true } | { ok: false; reason: 'NOT_FOUND' | 'FORBIDDEN' };

export interface OwnedCategory {
  id: number;
  name: string;
  activeWords: number;
}

export interface OwnedWord {
  id: number;
  polish: string;
  russian: string;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Пользовательский контент общий для всех: добавление в любую активную категорию, деактивация только своего (§3.3, §4.4). */
export class VocabularyService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Слово можно добавить в любую активную категорию; оно принадлежит добавившему пользователю. */
  async addWord(userId: number, categoryId: number, polish: string, russian: string): Promise<AddWordResult> {
    const parsed = wordInputSchema.safeParse({ polish, russian });
    if (!parsed.success) {
      return { ok: false, reason: 'INVALID' };
    }

    const category = await this.prisma.category.findFirst({
      where: {
        id: categoryId,
        isActive: true,
      },
      select: { id: true },
    });

    if (!category) {
      return { ok: false, reason: 'CATEGORY_NOT_FOUND' };
    }

    try {
      const word = await withWriteRetry(() =>
        this.prisma.word.create({
          data: {
            categoryId,
            polish: parsed.data.polish,
            russian: parsed.data.russian,
            ownerId: userId,
          },
          select: { id: true },
        }),
      );
      return { ok: true, wordId: word.id };
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { ok: false, reason: 'DUPLICATE' };
      }
      throw error;
    }
  }

  async createCategory(userId: number, name: string): Promise<CreateCategoryResult> {
    const parsed = categoryNameSchema.safeParse(name);
    if (!parsed.success) {
      return { ok: false, reason: 'INVALID' };
    }

    const existing = await this.prisma.category.findFirst({
      where: { name: parsed.data, ownerId: userId },
      select: { id: true },
    });

    if (existing) {
      return { ok: false, reason: 'DUPLICATE' };
    }

    const category = await withWriteRetry(() =>
      this.prisma.category.create({
        data: { name: parsed.data, ownerId: userId },
        select: { id: true },
      }),
    );

    return { ok: true, categoryId: category.id };
  }

  async listOwnCategories(userId: number): Promise<OwnedCategory[]> {
    const categories = await this.prisma.category.findMany({
      where: { ownerId: userId, isActive: true },
      select: {
        id: true,
        name: true,
        _count: { select: { words: { where: { isActive: true, ownerId: userId } } } },
      },
      orderBy: { name: 'asc' },
    });

    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      activeWords: category._count.words,
    }));
  }

  async listOwnWords(userId: number, limit = 30): Promise<OwnedWord[]> {
    return this.prisma.word.findMany({
      where: { ownerId: userId, isActive: true },
      select: { id: true, polish: true, russian: true },
      orderBy: { id: 'desc' },
      take: limit,
    });
  }

  async deactivateWord(userId: number, wordId: number): Promise<DeactivateResult> {
    const word = await this.prisma.word.findUnique({
      where: { id: wordId },
      select: { ownerId: true },
    });

    if (!word) {
      return { ok: false, reason: 'NOT_FOUND' };
    }
    if (word.ownerId !== userId) {
      return { ok: false, reason: 'FORBIDDEN' };
    }

    await withWriteRetry(() =>
      this.prisma.word.update({ where: { id: wordId }, data: { isActive: false } }),
    );

    return { ok: true };
  }

  /** Деактивация категории каскадно деактивирует её слова в одной транзакции (§3.4). */
  async deactivateCategory(userId: number, categoryId: number): Promise<DeactivateResult> {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { ownerId: true },
    });

    if (!category) {
      return { ok: false, reason: 'NOT_FOUND' };
    }
    if (category.ownerId !== userId) {
      return { ok: false, reason: 'FORBIDDEN' };
    }

    await withWriteRetry(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.category.update({ where: { id: categoryId }, data: { isActive: false } });
        await tx.word.updateMany({ where: { categoryId }, data: { isActive: false } });
      }),
    );

    return { ok: true };
  }
}

const SEPARATORS = /\s[-—–]\s|[-—–]/;

/** Разбирает ввод вида «kot - кот». */
export function parseWordInput(raw: string): { polish: string; russian: string } | null {
  const parts = raw.split(SEPARATORS);
  if (parts.length < 2) {
    return null;
  }

  const polish = parts[0]?.trim() ?? '';
  const russian = parts.slice(1).join('-').trim();

  if (polish.length === 0 || russian.length === 0) {
    return null;
  }

  return { polish, russian };
}
