import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContentService } from '../src/content/service.js';
import { ReminderService } from '../src/core/reminders/reminderService.js';
import { collectDueReminders } from '../src/scheduler/reminders.js';
import type { ScheduleEntry } from '../src/scheduler/registry.js';
import { createTestDb, seedCategory, type TestDb } from './helpers/testDb.js';

const MINSK = 'Europe/Minsk';

function entry(overrides: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return {
    userId: 1,
    telegramId: 100n,
    timezone: MINSK,
    reminderHour: 10,
    ...overrides,
  };
}

describe('расписание напоминаний', () => {
  it('срабатывает ровно в выбранный час по локальному времени', () => {
    // 07:00 UTC = 10:00 в Минске.
    const due = collectDueReminders([entry()], new Date('2026-09-09T07:00:00.000Z'));

    expect(due).toHaveLength(1);
    expect(due[0]?.type).toBe('MORNING');
    expect(due[0]?.localDate).toBe('2026-09-09');
  });

  it('не срабатывает в другие минуты', () => {
    const due = collectDueReminders([entry()], new Date('2026-09-09T07:01:00.000Z'));
    expect(due).toEqual([]);
  });

  it('вечернее напоминание строго в 21:00 по локальному времени', () => {
    // 18:00 UTC = 21:00 в Минске.
    const due = collectDueReminders([entry()], new Date('2026-09-09T18:00:00.000Z'));

    expect(due).toHaveLength(1);
    expect(due[0]?.type).toBe('EVENING');
  });

  it('учитывает разные таймзоны пользователей', () => {
    const entries = [
      entry({ userId: 1, timezone: MINSK, reminderHour: 10 }),
      entry({ userId: 2, timezone: 'UTC', reminderHour: 10 }),
    ];

    const due = collectDueReminders(entries, new Date('2026-09-09T07:00:00.000Z'));
    expect(due.map((item) => item.entry.userId)).toEqual([1]);
  });

  it('холостой тик не находит задач', () => {
    expect(collectDueReminders([entry()], new Date('2026-09-09T03:33:00.000Z'))).toEqual([]);
  });
});

describe('доставка напоминаний', () => {
  let db: TestDb;
  let prisma: PrismaClient;
  let reminders: ReminderService;
  let userId: number;

  beforeEach(async () => {
    db = await createTestDb();
    prisma = db.prisma;

    const user = await prisma.user.create({
      data: { telegramId: 1n, timezone: MINSK, currentStreak: 4 },
      select: { id: true },
    });
    userId = user.id;

    reminders = new ReminderService({
      prisma,
      content: new ContentService(prisma, { next: () => 0 }),
    });
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it('резервирует доставку только один раз на локальную дату', async () => {
    expect(await reminders.reserve(userId, 'MORNING', '2026-09-09')).toBe(true);
    expect(await reminders.reserve(userId, 'MORNING', '2026-09-09')).toBe(false);

    expect(await prisma.reminderDelivery.count()).toBe(1);
  });

  it('утреннее и вечернее напоминания резервируются независимо', async () => {
    expect(await reminders.reserve(userId, 'MORNING', '2026-09-09')).toBe(true);
    expect(await reminders.reserve(userId, 'EVENING', '2026-09-09')).toBe(true);

    expect(await prisma.reminderDelivery.count()).toBe(2);
  });

  it('на следующую дату резервирование снова доступно', async () => {
    await reminders.reserve(userId, 'MORNING', '2026-09-09');
    expect(await reminders.reserve(userId, 'MORNING', '2026-09-10')).toBe(true);
  });

  it('отмечает время фактической отправки', async () => {
    await reminders.reserve(userId, 'MORNING', '2026-09-09');
    await reminders.markSent(userId, 'MORNING', '2026-09-09');

    const delivery = await prisma.reminderDelivery.findUniqueOrThrow({
      where: { idempotencyKey: `MORNING:${userId}:2026-09-09` },
    });
    expect(delivery.sentAt).not.toBeNull();
  });

  it('вечернее не отправляется, если день закрыт', async () => {
    await prisma.userDay.create({
      data: { userId, localDate: '2026-09-09', status: 'COMPLETED' },
    });

    expect(await reminders.shouldSendEvening(userId, '2026-09-09')).toBe(false);
  });

  it('вечернее не отправляется при досрочно закрытом дне', async () => {
    await prisma.userDay.create({
      data: { userId, localDate: '2026-09-09', status: 'EARLY' },
    });

    expect(await reminders.shouldSendEvening(userId, '2026-09-09')).toBe(false);
  });

  it('защищённый щитом день не подавляет вечернее напоминание', async () => {
    await prisma.userDay.create({
      data: { userId, localDate: '2026-09-09', status: 'SHIELDED' },
    });

    expect(await reminders.shouldSendEvening(userId, '2026-09-09')).toBe(true);
  });

  it('утреннее сообщение содержит стрик', async () => {
    const text = await reminders.buildMorning(userId, '2026-09-09');
    expect(text).toContain('4');
  });

  it('добавляет блок «Слово дня», если он задан на эту дату', async () => {
    const categoryId = await seedCategory(prisma, 'Chuvstva', 4);
    const word = await prisma.word.findFirstOrThrow({ where: { categoryId } });
    await prisma.word.update({
      where: { id: word.id },
      data: { polish: 'kocham', russian: 'любить' },
    });
    await prisma.wordOfDay.create({ data: { date: '2026-09-09', wordId: word.id } });

    const text = await reminders.buildMorning(userId, '2026-09-09');
    expect(text).toContain('Слово дня');
    expect(text).toContain('kocham');
    expect(text).toContain('любить');
  });

  it('без записи слова дня блок просто отсутствует', async () => {
    const text = await reminders.buildMorning(userId, '2026-09-09');
    expect(text).not.toContain('Слово дня');
  });
});
