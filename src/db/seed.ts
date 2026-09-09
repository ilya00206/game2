import type { PrismaClient } from '@prisma/client';
import { SEED_CONTENT_TEXTS } from '../content/seed.js';
import { SINGLETON_ID } from '../core/economy/config.js';
import { logger } from '../logger.js';
import { SEED_CATEGORIES } from './seedData.js';

export interface SeedResult {
  categoriesCreated: number;
  wordsCreated: number;
  textsCreated: number;
  configsCreated: number;
}

/**
 * Идемпотентный посев при старте (§2.1): добавляет недостающее и никогда
 * не перезаписывает существующие строки, включая правки админа.
 */
export async function runSeed(prisma: PrismaClient): Promise<SeedResult> {
  const result: SeedResult = {
    categoriesCreated: 0,
    wordsCreated: 0,
    textsCreated: 0,
    configsCreated: 0,
  };

  const currency = await prisma.currencyConfig.findUnique({ where: { id: SINGLETON_ID } });
  if (!currency) {
    await prisma.currencyConfig.create({ data: { id: SINGLETON_ID } });
    result.configsCreated += 1;
  }

  const economy = await prisma.economyConfig.findUnique({ where: { id: SINGLETON_ID } });
  if (!economy) {
    await prisma.economyConfig.create({ data: { id: SINGLETON_ID } });
    result.configsCreated += 1;
  }

  for (const seedCategory of SEED_CATEGORIES) {
    // Уникальность системных записей (ownerId = null) контролируется здесь:
    // в SQLite NULL в уникальном индексе не совпадает с другим NULL (§9).
    const existing = await prisma.category.findFirst({
      where: { name: seedCategory.name, ownerId: null },
      select: { id: true },
    });

    let categoryId: number;
    if (existing) {
      categoryId = existing.id;
    } else {
      const created = await prisma.category.create({
        data: { name: seedCategory.name, ownerId: null },
        select: { id: true },
      });
      categoryId = created.id;
      result.categoriesCreated += 1;
    }

    const existingWords = await prisma.word.findMany({
      where: { categoryId, ownerId: null },
      select: { polish: true },
    });
    const knownPolish = new Set(existingWords.map((word) => word.polish));

    const missing = seedCategory.words
      .filter((word) => !knownPolish.has(word.polish))
      .map((word) => ({
        categoryId,
        polish: word.polish,
        russian: word.russian,
        ownerId: null,
      }));

    if (missing.length > 0) {
      await prisma.word.createMany({ data: missing });
      result.wordsCreated += missing.length;
    }
  }

  const existingTexts = await prisma.contentText.findMany({
    select: { key: true, variant: true },
  });
  const existingKeys = new Set(existingTexts.map((text) => `${text.key}:${text.variant}`));

  const missingTexts = SEED_CONTENT_TEXTS.filter(
    (text) => !existingKeys.has(`${text.key}:${text.variant}`),
  ).map((text) => ({
    key: text.key,
    variant: text.variant,
    group: text.group,
    text: text.text,
    isSeed: true,
    isActive: true,
  }));

  if (missingTexts.length > 0) {
    await prisma.contentText.createMany({ data: missingTexts });
    result.textsCreated = missingTexts.length;
  }

  logger.info(result, 'Seed завершён');
  return result;
}
