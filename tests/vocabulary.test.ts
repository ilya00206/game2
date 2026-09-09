import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseWordInput,
  VocabularyService,
} from '../src/core/vocabulary/vocabularyService.js';
import { ConfigService } from '../src/core/economy/config.js';
import { NoopEventSink } from '../src/core/events/sink.js';
import { SessionService } from '../src/core/learning/sessionService.js';
import { createSeededRng } from '../src/core/random.js';
import { createFixedClock } from '../src/core/time.js';
import { createTestDb, seedCategory, type TestDb } from './helpers/testDb.js';

let db: TestDb;
let prisma: PrismaClient;
let vocabulary: VocabularyService;
let userId: number;
let otherUserId: number;
let systemCategoryId: number;

describe('разбор ввода слова', () => {
  it('понимает разные виды дефиса', () => {
    expect(parseWordInput('kot - кот')).toEqual({ polish: 'kot', russian: 'кот' });
    expect(parseWordInput('kot — кот')).toEqual({ polish: 'kot', russian: 'кот' });
    expect(parseWordInput('kot-кот')).toEqual({ polish: 'kot', russian: 'кот' });
  });

  it('обрезает лишние пробелы', () => {
    expect(parseWordInput('  dom   -   дом  ')).toEqual({ polish: 'dom', russian: 'дом' });
  });

  it('отклоняет ввод без разделителя', () => {
    expect(parseWordInput('kot кот')).toBeNull();
    expect(parseWordInput('kot -')).toBeNull();
  });
});

describe('пользовательский словарь', () => {
  beforeEach(async () => {
    db = await createTestDb();
    prisma = db.prisma;
    vocabulary = new VocabularyService(prisma);

    const user = await prisma.user.create({ data: { telegramId: 1n }, select: { id: true } });
    userId = user.id;
    const other = await prisma.user.create({ data: { telegramId: 2n }, select: { id: true } });
    otherUserId = other.id;

    systemCategoryId = await seedCategory(prisma, 'Cvety', 4);
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it('добавляет слово в системную категорию с владельцем-пользователем', async () => {
    const result = await vocabulary.addWord(userId, systemCategoryId, 'kot', 'кот');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const word = await prisma.word.findUniqueOrThrow({ where: { id: result.wordId } });
    expect(word.ownerId).toBe(userId);
    expect(word.categoryId).toBe(systemCategoryId);
    expect(word.isActive).toBe(true);
  });

  it('запрещает дубликат слова в одной категории у одного владельца', async () => {
    await vocabulary.addWord(userId, systemCategoryId, 'kot', 'кот');
    const duplicate = await vocabulary.addWord(userId, systemCategoryId, 'kot', 'кошка');

    expect(duplicate).toEqual({ ok: false, reason: 'DUPLICATE' });
  });

  it('разные пользователи могут добавить одно и то же слово', async () => {
    await vocabulary.addWord(userId, systemCategoryId, 'kot', 'кот');
    const other = await vocabulary.addWord(otherUserId, systemCategoryId, 'kot', 'кот');

    expect(other.ok).toBe(true);
  });

  it('отклоняет пустой и слишком длинный ввод', async () => {
    expect(await vocabulary.addWord(userId, systemCategoryId, '  ', 'кот')).toEqual({
      ok: false,
      reason: 'INVALID',
    });
    expect(await vocabulary.addWord(userId, systemCategoryId, 'a'.repeat(101), 'кот')).toEqual({
      ok: false,
      reason: 'INVALID',
    });
  });

  it('не добавляет слово в чужую категорию', async () => {
    const foreign = await vocabulary.createCategory(otherUserId, 'Личное');
    if (!foreign.ok) throw new Error('категория не создана');

    const result = await vocabulary.addWord(userId, foreign.categoryId, 'kot', 'кот');
    expect(result).toEqual({ ok: false, reason: 'CATEGORY_NOT_FOUND' });
  });

  it('создаёт собственную категорию и запрещает её дубликат', async () => {
    const created = await vocabulary.createCategory(userId, 'Моя тема');
    expect(created.ok).toBe(true);

    const duplicate = await vocabulary.createCategory(userId, 'Моя тема');
    expect(duplicate).toEqual({ ok: false, reason: 'DUPLICATE' });
  });

  it('деактивация категории каскадно выключает её слова и сохраняет строки', async () => {
    const created = await vocabulary.createCategory(userId, 'Моя тема');
    if (!created.ok) throw new Error('категория не создана');

    await vocabulary.addWord(userId, created.categoryId, 'kot', 'кот');
    await vocabulary.addWord(userId, created.categoryId, 'dom', 'дом');

    expect(await vocabulary.deactivateCategory(userId, created.categoryId)).toEqual({ ok: true });

    const category = await prisma.category.findUniqueOrThrow({
      where: { id: created.categoryId },
    });
    expect(category.isActive).toBe(false);

    const words = await prisma.word.findMany({ where: { categoryId: created.categoryId } });
    expect(words).toHaveLength(2);
    expect(words.every((word) => !word.isActive)).toBe(true);
  });

  it('не позволяет деактивировать чужой контент', async () => {
    const foreign = await vocabulary.createCategory(otherUserId, 'Личное');
    if (!foreign.ok) throw new Error('категория не создана');

    expect(await vocabulary.deactivateCategory(userId, foreign.categoryId)).toEqual({
      ok: false,
      reason: 'FORBIDDEN',
    });

    const added = await vocabulary.addWord(otherUserId, foreign.categoryId, 'kot', 'кот');
    if (!added.ok) throw new Error('слово не добавлено');

    expect(await vocabulary.deactivateWord(userId, added.wordId)).toEqual({
      ok: false,
      reason: 'FORBIDDEN',
    });
  });

  it('деактивированное слово не попадает в новые сессии', async () => {
    const created = await vocabulary.createCategory(userId, 'Моя тема');
    if (!created.ok) throw new Error('категория не создана');

    const first = await vocabulary.addWord(userId, created.categoryId, 'kot', 'кот');
    await vocabulary.addWord(userId, created.categoryId, 'dom', 'дом');
    if (!first.ok) throw new Error('слово не добавлено');

    await vocabulary.deactivateWord(userId, first.wordId);

    const sessions = new SessionService({
      prisma,
      events: new NoopEventSink(),
      config: new ConfigService(prisma),
      clock: createFixedClock('2026-09-09T10:00:00.000Z'),
      rng: createSeededRng(1),
    });

    const started = await sessions.startFlashcardSession(userId, created.categoryId, 'PL_RU');
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const cards = await prisma.sessionCard.findMany({
      where: { sessionId: started.sessionId },
      select: { wordId: true },
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.wordId).not.toBe(first.wordId);
  });

  it('показывает только собственные категории и слова', async () => {
    await vocabulary.createCategory(userId, 'Моя тема');
    await vocabulary.createCategory(otherUserId, 'Чужая тема');
    await vocabulary.addWord(userId, systemCategoryId, 'kot', 'кот');
    await vocabulary.addWord(otherUserId, systemCategoryId, 'pies', 'собака');

    const categories = await vocabulary.listOwnCategories(userId);
    const words = await vocabulary.listOwnWords(userId);

    expect(categories.map((item) => item.name)).toEqual(['Моя тема']);
    expect(words.map((item) => item.polish)).toEqual(['kot']);
  });
});
