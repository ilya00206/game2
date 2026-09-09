import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigService } from '../src/core/economy/config.js';
import { NoopEventSink } from '../src/core/events/sink.js';
import { SessionService } from '../src/core/learning/sessionService.js';
import { createSeededRng } from '../src/core/random.js';
import { createFixedClock } from '../src/core/time.js';

const NOW = '2026-09-09T10:00:00.000Z';
const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');

let prisma: PrismaClient;
let directory: string;
let service: SessionService;
let userId: number;
let categoryId: number;

/** Комментарии убираются до разбиения: в них встречается точка с запятой. */
function migrationStatements(): string[] {
  const sql = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'))
    .join('\n');

  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function createService(): SessionService {
  return new SessionService({
    prisma,
    events: new NoopEventSink(),
    config: new ConfigService(prisma),
    clock: createFixedClock(NOW),
    rng: createSeededRng(123),
  });
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'kartochki-'));
  const url = join(directory, 'test.db');

  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
  for (const statement of migrationStatements()) {
    await prisma.$executeRawUnsafe(statement);
  }

  const user = await prisma.user.create({ data: { telegramId: 1n }, select: { id: true } });
  userId = user.id;

  const category = await prisma.category.create({
    data: { name: 'Цвета', ownerId: null },
    select: { id: true },
  });
  categoryId = category.id;

  await prisma.word.createMany({
    data: Array.from({ length: 12 }, (_, index) => ({
      categoryId,
      polish: `slowo${index}`,
      russian: `слово${index}`,
      ownerId: null,
    })),
  });

  service = createService();
});

afterEach(async () => {
  await prisma.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

describe('сессия карточек', () => {
  it('фиксирует план из 10 уникальных карточек', async () => {
    const started = await service.startFlashcardSession(userId, categoryId, 'PL_RU');
    expect(started.ok).toBe(true);

    const cards = await prisma.sessionCard.findMany({
      where: { sessionId: started.ok ? started.sessionId : 0 },
      select: { wordId: true, promptText: true },
    });

    expect(cards).toHaveLength(10);
    expect(new Set(cards.map((card) => card.wordId)).size).toBe(10);
    expect(cards.every((card) => card.promptText.startsWith('slowo'))).toBe(true);
  });

  it('сохраняет снимок русского слова в режиме RU_PL', async () => {
    const started = await service.startFlashcardSession(userId, categoryId, 'RU_PL');
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    expect(started.card.promptText.startsWith('слово')).toBe(true);
  });

  it('не создаёт вторую активную сессию', async () => {
    await service.startFlashcardSession(userId, categoryId, 'PL_RU');
    const second = await service.startFlashcardSession(userId, categoryId, 'PL_RU');

    expect(second).toEqual({ ok: false, reason: 'ACTIVE_SESSION_EXISTS' });
    expect(await prisma.session.count({ where: { status: 'ACTIVE' } })).toBe(1);
  });

  it('два параллельных запуска создают ровно одну активную сессию', async () => {
    const results = await Promise.allSettled([
      createService().startFlashcardSession(userId, categoryId, 'PL_RU'),
      createService().startFlashcardSession(userId, categoryId, 'PL_RU'),
    ]);

    const created = results.filter(
      (result) => result.status === 'fulfilled' && result.value.ok,
    );
    expect(created).toHaveLength(1);
    expect(await prisma.session.count({ where: { status: 'ACTIVE' } })).toBe(1);
  });

  it('сокращает план до числа доступных слов', async () => {
    await prisma.word.updateMany({ where: { categoryId }, data: { isActive: false } });
    await prisma.word.updateMany({
      where: { categoryId, polish: { in: ['slowo0', 'slowo1', 'slowo2'] } },
      data: { isActive: true },
    });

    const started = await service.startFlashcardSession(userId, categoryId, 'PL_RU');
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const session = await prisma.session.findUnique({
      where: { id: started.sessionId },
      select: { plannedCount: true },
    });
    expect(session?.plannedCount).toBe(3);
  });

  it('запрещает сессию в категории без активных слов', async () => {
    await prisma.word.updateMany({ where: { categoryId }, data: { isActive: false } });
    const started = await service.startFlashcardSession(userId, categoryId, 'PL_RU');
    expect(started).toEqual({ ok: false, reason: 'NO_WORDS' });
  });

  it('принимает ответ один раз и игнорирует повторный callback', async () => {
    const started = await service.startFlashcardSession(userId, categoryId, 'PL_RU');
    if (!started.ok) throw new Error('сессия не создана');

    const first = await service.answerCard(userId, started.card.cardId, 'KNOW', 'action-1');
    const duplicate = await service.answerCard(userId, started.card.cardId, 'KNOW', 'action-2');

    expect(first.accepted).toBe(true);
    expect(duplicate.accepted).toBe(false);

    const progress = await prisma.userWord.findFirst({ where: { userId } });
    expect(progress?.timesSeen).toBe(1);
    expect(progress?.timesKnown).toBe(1);

    const session = await prisma.session.findUnique({
      where: { id: started.sessionId },
      select: { answeredCount: true },
    });
    expect(session?.answeredCount).toBe(1);
  });

  it('закрывает сессию после ответа на последнюю карточку', async () => {
    const started = await service.startFlashcardSession(userId, categoryId, 'PL_RU');
    if (!started.ok) throw new Error('сессия не создана');

    let card = started.card;
    for (let index = 0; index < 10; index += 1) {
      const result = await service.answerCard(userId, card.cardId, 'KNOW', `action-${index}`);
      expect(result.accepted).toBe(true);
      if (result.accepted && !result.completed) {
        card = result.card;
      }
    }

    const session = await prisma.session.findUnique({
      where: { id: started.sessionId },
      select: { status: true, isFull: true, answeredCount: true, finishedAt: true },
    });

    expect(session?.status).toBe('COMPLETED');
    expect(session?.isFull).toBe(true);
    expect(session?.answeredCount).toBe(10);
    expect(session?.finishedAt).not.toBeNull();
  });

  it('досрочное завершение сохраняет ответы и не начисляет полноту', async () => {
    const started = await service.startFlashcardSession(userId, categoryId, 'PL_RU');
    if (!started.ok) throw new Error('сессия не создана');

    await service.answerCard(userId, started.card.cardId, 'UNKNOWN', 'action-1');
    await service.abandonSession(userId);

    const session = await prisma.session.findUnique({
      where: { id: started.sessionId },
      select: { status: true, isFull: true, answeredCount: true },
    });

    expect(session?.status).toBe('ABANDONED');
    expect(session?.isFull).toBe(false);
    expect(session?.answeredCount).toBe(1);
  });

  it('деактивация слова не ломает активную сессию', async () => {
    const started = await service.startFlashcardSession(userId, categoryId, 'PL_RU');
    if (!started.ok) throw new Error('сессия не создана');

    await prisma.word.updateMany({ where: { categoryId }, data: { isActive: false } });

    const card = await service.currentCard(started.sessionId);
    expect(card?.cardId).toBe(started.card.cardId);

    const result = await service.answerCard(userId, started.card.cardId, 'KNOW', 'action-1');
    expect(result.accepted).toBe(true);
  });

  it('«Не знаю» возвращает правильный перевод для раскрытия', async () => {
    const started = await service.startFlashcardSession(userId, categoryId, 'PL_RU');
    if (!started.ok) throw new Error('сессия не создана');

    const result = await service.answerCard(userId, started.card.cardId, 'UNKNOWN', 'action-1');
    if (!result.accepted || result.completed) throw new Error('ответ не принят');

    expect(result.reveal).not.toBeNull();
    expect(result.reveal?.promptText).toBe(started.card.promptText);
    expect(result.reveal?.translationText.length).toBeGreaterThan(0);
  });

  it('«Знаю» не показывает экран раскрытия', async () => {
    const started = await service.startFlashcardSession(userId, categoryId, 'PL_RU');
    if (!started.ok) throw new Error('сессия не создана');

    const result = await service.answerCard(userId, started.card.cardId, 'KNOW', 'action-1');
    if (!result.accepted || result.completed) throw new Error('ответ не принят');

    expect(result.reveal).toBeNull();
  });

  it('перевод для раскрытия соответствует направлению сессии', async () => {
    const startedRu = await service.startFlashcardSession(userId, categoryId, 'RU_PL');
    if (!startedRu.ok) throw new Error('сессия не создана');

    const result = await service.answerCard(userId, startedRu.card.cardId, 'UNKNOWN', 'action-1');
    if (!result.accepted || result.completed) throw new Error('ответ не принят');

    // В режиме RU_PL показывается русское слово, перевод должен быть польским.
    expect(result.reveal?.promptText.startsWith('слово')).toBe(true);
    expect(result.reveal?.translationText.startsWith('slowo')).toBe(true);
  });

  it('саммари категории считается по активным словам', async () => {
    const started = await service.startFlashcardSession(userId, categoryId, 'PL_RU');
    if (!started.ok) throw new Error('сессия не создана');

    await service.answerCard(userId, started.card.cardId, 'UNKNOWN', 'action-1');

    const summary = await service.categorySummary(userId, categoryId);
    expect(summary.total).toBe(12);
    expect(summary.passed).toBe(0);
    expect(summary.learned).toBe(0);
    expect(summary.remaining).toBe(12);
    expect(summary.toRepeat).toBe(1);
  });

  it('не показывает чужой пользовательский контент', async () => {
    const other = await prisma.user.create({ data: { telegramId: 2n }, select: { id: true } });
    await prisma.category.create({ data: { name: 'Личное', ownerId: other.id } });

    const categories = await service.listCategories(userId);
    expect(categories.map((item) => item.name)).toEqual(['Цвета']);
  });

  it('при EVENT_LOG_ENABLED=false не создаёт ни одной строки Event', async () => {
    const started = await service.startFlashcardSession(userId, categoryId, 'PL_RU');
    if (!started.ok) throw new Error('сессия не создана');

    await service.answerCard(userId, started.card.cardId, 'KNOW', 'action-1');
    await service.abandonSession(userId);

    expect(await prisma.event.count()).toBe(0);
  });
});
