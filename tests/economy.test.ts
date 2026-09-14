import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigService } from '../src/core/economy/config.js';
import { ShopService } from '../src/core/economy/shopService.js';
import { NoopEventSink } from '../src/core/events/sink.js';
import { SessionService } from '../src/core/learning/sessionService.js';
import { StreakManager } from '../src/core/streak/streakManager.js';
import type { Rng } from '../src/core/random.js';
import { createFixedClock, type Clock } from '../src/core/time.js';
import { createTestDb, seedCategory, type TestDb } from './helpers/testDb.js';

const MINSK = 'Europe/Minsk';
/** 2026-09-09 13:00 по Минску. */
const NOW = '2026-09-09T10:00:00.000Z';

/** Детерминированный RNG: значение выше порога сюрприза, чтобы он не срабатывал. */
const noSurpriseRng: Rng = { next: () => 0.99 };
const alwaysSurpriseRng: Rng = { next: () => 0.0 };

let db: TestDb;
let prisma: PrismaClient;
let userId: number;
let categoryId: number;

function makeSessions(clock: Clock, rng: Rng = noSurpriseRng): SessionService {
  return new SessionService({
    prisma,
    events: new NoopEventSink(),
    config: new ConfigService(prisma),
    clock,
    rng,
  });
}

/** Полностью проходит одну сессию карточек. */
async function completeSession(sessions: SessionService): Promise<void> {
  const started = await sessions.startFlashcardSession(userId, categoryId, 'PL_RU');
  if (!started.ok) {
    throw new Error(`сессия не создана: ${started.reason}`);
  }

  let cardId = started.card.cardId;
  for (;;) {
    const result = await sessions.answerCard(userId, cardId, 'KNOW', `a-${cardId}-${Date.now()}`);
    if (!result.accepted) {
      throw new Error('ответ не принят');
    }
    if (result.completed) {
      return;
    }
    cardId = result.card.cardId;
  }
}

beforeEach(async () => {
  db = await createTestDb();
  prisma = db.prisma;

  await prisma.economyConfig.create({ data: { id: 1 } });
  await prisma.currencyConfig.create({ data: { id: 1 } });

  const user = await prisma.user.create({
    data: { telegramId: 1n, timezone: MINSK },
    select: { id: true },
  });
  userId = user.id;
  categoryId = await seedCategory(prisma, 'Cvety', 12);
});

afterEach(async () => {
  await db.cleanup();
});

describe('награда за сессию', () => {
  it('начисляет 5 единиц за полностью пройденный план', async () => {
    await completeSession(makeSessions(createFixedClock(NOW)));

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.currencyBalance).toBe(5);

    const transaction = await prisma.currencyTransaction.findFirst({ where: { userId } });
    expect(transaction?.reason).toBe('SESSION_REWARD');
    expect(transaction?.balanceAfter).toBe(5);
  });

  it('не начисляет награду за досрочно завершённую сессию', async () => {
    const sessions = makeSessions(createFixedClock(NOW));
    const started = await sessions.startFlashcardSession(userId, categoryId, 'PL_RU');
    if (!started.ok) throw new Error('сессия не создана');

    await sessions.answerCard(userId, started.card.cardId, 'KNOW', 'a-1');
    await sessions.abandonSession(userId);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.currencyBalance).toBe(0);
    expect(user.currentStreak).toBe(0);
  });

  it('соблюдает дневной лимит и не делит награду на части', async () => {
    const sessions = makeSessions(createFixedClock(NOW));

    for (let index = 0; index < 4; index += 1) {
      await completeSession(sessions);
    }

    const afterLimit = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(afterLimit.currencyBalance).toBe(20);

    await completeSession(sessions);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.currencyBalance).toBe(20);

    // Сессия и стрик засчитываются даже без награды.
    const day = await prisma.userDay.findUniqueOrThrow({
      where: { userId_localDate: { userId, localDate: '2026-09-09' } },
    });
    expect(day.completedSessions).toBe(5);
    expect(day.status).toBe('COMPLETED');
  });

  it('начисляет награду за сессию ровно один раз', async () => {
    await completeSession(makeSessions(createFixedClock(NOW)));

    const rewards = await prisma.currencyTransaction.count({
      where: { userId, reason: 'SESSION_REWARD' },
    });
    expect(rewards).toBe(1);
  });
});

describe('стрик за полные сессии', () => {
  it('увеличивает серию один раз в день', async () => {
    const sessions = makeSessions(createFixedClock(NOW));

    await completeSession(sessions);
    const first = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(first.currentStreak).toBe(1);
    expect(first.maxStreak).toBe(1);

    await completeSession(sessions);
    const second = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(second.currentStreak).toBe(1);

    const day = await prisma.userDay.findUniqueOrThrow({
      where: { userId_localDate: { userId, localDate: '2026-09-09' } },
    });
    expect(day.completedSessions).toBe(2);
    expect(day.streakAppliedAt).not.toBeNull();
  });

  it('продолжает серию на следующий день', async () => {
    await completeSession(makeSessions(createFixedClock(NOW)));
    await completeSession(makeSessions(createFixedClock('2026-09-10T10:00:00.000Z')));

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.currentStreak).toBe(2);
    expect(user.maxStreak).toBe(2);
  });

  it('расходует щит за пропущенный день', async () => {
    await completeSession(makeSessions(createFixedClock(NOW)));
    await prisma.user.update({ where: { id: userId }, data: { shields: 1 } });

    // Пропущен 10-е число, занимаемся 11-го.
    await completeSession(makeSessions(createFixedClock('2026-09-11T10:00:00.000Z')));

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.shields).toBe(0);
    expect(user.currentStreak).toBe(2);

    const shielded = await prisma.userDay.findUniqueOrThrow({
      where: { userId_localDate: { userId, localDate: '2026-09-10' } },
    });
    expect(shielded.status).toBe('SHIELDED');
    expect(shielded.shieldConsumed).toBe(true);
  });

  it('без щита серия обрывается и начинается заново с 1', async () => {
    await completeSession(makeSessions(createFixedClock(NOW)));
    await completeSession(makeSessions(createFixedClock('2026-09-12T10:00:00.000Z')));

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.currentStreak).toBe(1);
    expect(user.maxStreak).toBe(1);

    const missed = await prisma.userDay.findMany({
      where: { userId, status: 'MISSED' },
      orderBy: { localDate: 'asc' },
    });
    expect(missed.map((row) => row.localDate)).toEqual(['2026-09-10', '2026-09-11']);
  });

  it('завершение до полуночи относится к текущей локальной дате', async () => {
    // 20:59 UTC = 23:59 в Минске.
    await completeSession(makeSessions(createFixedClock('2026-09-09T20:59:00.000Z')));

    const day = await prisma.userDay.findFirst({ where: { userId } });
    expect(day?.localDate).toBe('2026-09-09');
  });

  it('завершение после полуночи относится к следующей локальной дате', async () => {
    // 21:05 UTC = 00:05 следующего дня в Минске.
    await completeSession(makeSessions(createFixedClock('2026-09-09T21:05:00.000Z')));

    const day = await prisma.userDay.findFirst({ where: { userId } });
    expect(day?.localDate).toBe('2026-09-10');
  });
});

describe('сюрприз', () => {
  it('начисляется не более одного раза в сутки', async () => {
    const sessions = makeSessions(createFixedClock(NOW), alwaysSurpriseRng);

    await completeSession(sessions);
    await completeSession(sessions);

    const surprises = await prisma.currencyTransaction.count({
      where: { userId, reason: 'SURPRISE' },
    });
    expect(surprises).toBe(1);
  });

  it('не начисляется, когда не выпал', async () => {
    await completeSession(makeSessions(createFixedClock(NOW), noSurpriseRng));

    const surprises = await prisma.currencyTransaction.count({
      where: { userId, reason: 'SURPRISE' },
    });
    expect(surprises).toBe(0);
  });
});

describe('магазин', () => {
  function makeShop(): ShopService {
    return new ShopService({
      prisma,
      config: new ConfigService(prisma),
      clock: createFixedClock(NOW),
    });
  }

  it('покупка щита списывает валюту и увеличивает счётчик щитов', async () => {
    await prisma.user.update({ where: { id: userId }, data: { currencyBalance: 30 } });

    const result = await makeShop().buy(userId, 'SHIELD', 'req-1');
    expect(result).toMatchObject({ ok: true, cost: 25, balanceAfter: 5 });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.shields).toBe(1);
    expect(user.currencyBalance).toBe(5);
  });

  it('покупка желания от тебя списывает 500 валюты', async () => {
    await prisma.user.update({ where: { id: userId }, data: { currencyBalance: 500 } });

    const result = await makeShop().buy(userId, 'WISH', 'req-wish');
    expect(result).toMatchObject({ ok: true, item: 'WISH', cost: 500, balanceAfter: 0 });
  });

  it('не позволяет уйти в минус', async () => {
    await prisma.user.update({ where: { id: userId }, data: { currencyBalance: 10 } });

    const result = await makeShop().buy(userId, 'SHIELD', 'req-1');
    expect(result).toEqual({ ok: false, reason: 'INSUFFICIENT_FUNDS' });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.currencyBalance).toBe(10);
  });

  it('две параллельные покупки при балансе на одну дают ровно одну успешную', async () => {
    await prisma.user.update({ where: { id: userId }, data: { currencyBalance: 25 } });

    const results = await Promise.all([
      makeShop().buy(userId, 'SHIELD', 'req-1'),
      makeShop().buy(userId, 'SHIELD', 'req-2'),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.currencyBalance).toBe(0);
    expect(user.shields).toBe(1);
    expect(await prisma.purchase.count()).toBe(1);
  });

  it('повторный запрос с тем же requestId не списывает дважды', async () => {
    await prisma.user.update({ where: { id: userId }, data: { currencyBalance: 100 } });
    const shop = makeShop();

    await shop.buy(userId, 'SHIELD', 'req-1');
    const repeat = await shop.buy(userId, 'SHIELD', 'req-1');

    expect(repeat).toEqual({ ok: false, reason: 'ALREADY_PROCESSED' });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.currencyBalance).toBe(75);
    expect(user.shields).toBe(1);
  });
});

describe('досрочный стрик', () => {
  it('доступен только после трёх полных сессий', async () => {
    const clock = createFixedClock(NOW);
    const sessions = makeSessions(clock);
    const streaks = new StreakManager({ prisma, events: new NoopEventSink(), clock });

    await completeSession(sessions);
    expect(await streaks.bookEarly(userId)).toEqual({
      ok: false,
      reason: 'NOT_ENOUGH_SESSIONS',
    });

    await completeSession(sessions);
    await completeSession(sessions);

    expect(await streaks.bookEarly(userId)).toEqual({ ok: true, localDate: '2026-09-10' });
    expect(await streaks.bookEarly(userId)).toEqual({ ok: false, reason: 'ALREADY_BOOKED' });
  });

  it('бронь увеличивает серию при наступлении даты без расхода щита', async () => {
    const sessions = makeSessions(createFixedClock(NOW));
    const streaks = new StreakManager({
      prisma,
      events: new NoopEventSink(),
      clock: createFixedClock(NOW),
    });

    for (let index = 0; index < 3; index += 1) {
      await completeSession(sessions);
    }
    await streaks.bookEarly(userId);

    const next = new StreakManager({
      prisma,
      events: new NoopEventSink(),
      clock: createFixedClock('2026-09-10T10:00:00.000Z'),
    });
    const outcome = await next.reconcile(userId);

    expect(outcome.currentStreak).toBe(2);
    expect(outcome.shieldedDates).toEqual([]);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.shields).toBe(0);
    expect(user.currentStreak).toBe(2);
  });
});
