import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdminService } from '../src/core/admin/adminService.js';
import { ConfigService } from '../src/core/economy/config.js';
import { ContentService } from '../src/content/service.js';
import { createTestDb, seedCategory, type TestDb } from './helpers/testDb.js';

const ADMIN_TELEGRAM_ID = 999n;

let db: TestDb;
let prisma: PrismaClient;
let admin: AdminService;
let userId: number;

beforeEach(async () => {
  db = await createTestDb();
  prisma = db.prisma;
  admin = new AdminService(prisma);

  await prisma.economyConfig.create({ data: { id: 1 } });
  await prisma.currencyConfig.create({ data: { id: 1 } });

  const user = await prisma.user.create({
    data: { telegramId: 1n, currentStreak: 3, maxStreak: 9 },
    select: { id: true },
  });
  userId = user.id;
});

afterEach(async () => {
  await db.cleanup();
});

describe('список пользователей', () => {
  it('возвращает имя и username вместе с id', async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { firstName: 'Даша', username: 'dasha_test' },
    });

    const users = await admin.listUsers();
    const found = users.find((user) => user.id === userId);

    expect(found?.firstName).toBe('Даша');
    expect(found?.username).toBe('dasha_test');
  });

  it('getUser возвращает null для несуществующего пользователя', async () => {
    expect(await admin.getUser(999999)).toBeNull();
  });
});

describe('ручное начисление валюты', () => {
  it('увеличивает баланс и сохраняет причину', async () => {
    const result = await admin.grantCurrency({
      adminTelegramId: ADMIN_TELEGRAM_ID,
      userId,
      amount: 15,
      reason: 'за старание',
      requestId: 'req-1',
    });

    expect(result).toEqual({ ok: true, alreadyApplied: false });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.currencyBalance).toBe(15);

    const adjustment = await prisma.adminAdjustment.findFirstOrThrow({ where: { userId } });
    expect(adjustment.type).toBe('CURRENCY_GRANT');
    expect(adjustment.reason).toBe('за старание');
    expect(adjustment.value).toBe(15);
  });

  it('повтор с тем же requestId не начисляет дважды', async () => {
    const params = {
      adminTelegramId: ADMIN_TELEGRAM_ID,
      userId,
      amount: 15,
      reason: 'за старание',
      requestId: 'req-1',
    };

    await admin.grantCurrency(params);
    const repeat = await admin.grantCurrency(params);

    expect(repeat).toEqual({ ok: true, alreadyApplied: true });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.currencyBalance).toBe(15);
    expect(await prisma.adminAdjustment.count()).toBe(1);
  });

  it('не влияет на дневной лимит обучения', async () => {
    await admin.grantCurrency({
      adminTelegramId: ADMIN_TELEGRAM_ID,
      userId,
      amount: 50,
      reason: 'подарок',
      requestId: 'req-1',
    });

    const learning = await prisma.currencyTransaction.count({
      where: { userId, reason: { in: ['SESSION_REWARD', 'TEST_REWARD'] } },
    });
    expect(learning).toBe(0);
  });

  it('не обновляет стрик', async () => {
    await admin.grantCurrency({
      adminTelegramId: ADMIN_TELEGRAM_ID,
      userId,
      amount: 5,
      reason: 'подарок',
      requestId: 'req-1',
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.currentStreak).toBe(3);
  });

  it('отклоняет нулевую сумму и пустую причину', async () => {
    expect(
      await admin.grantCurrency({
        adminTelegramId: ADMIN_TELEGRAM_ID,
        userId,
        amount: 0,
        reason: 'ok',
        requestId: 'a',
      }),
    ).toEqual({ ok: false, reason: 'INVALID' });

    expect(
      await admin.grantCurrency({
        adminTelegramId: ADMIN_TELEGRAM_ID,
        userId,
        amount: 5,
        reason: '   ',
        requestId: 'b',
      }),
    ).toEqual({ ok: false, reason: 'INVALID' });
  });
});

describe('возврат стрика', () => {
  it('меняет текущий стрик и не уменьшает рекорд', async () => {
    const result = await admin.restoreStreak({
      adminTelegramId: ADMIN_TELEGRAM_ID,
      userId,
      value: 5,
      reason: 'сбой связи',
      requestId: 'req-1',
    });

    expect(result).toEqual({ ok: true, alreadyApplied: false });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.currentStreak).toBe(5);
    expect(user.maxStreak).toBe(9);
  });

  it('не переписывает календарные статусы прошлых дней', async () => {
    await prisma.userDay.create({
      data: { userId, localDate: '2026-09-08', status: 'MISSED', streakAppliedAt: new Date() },
    });

    await admin.restoreStreak({
      adminTelegramId: ADMIN_TELEGRAM_ID,
      userId,
      value: 5,
      reason: 'сбой',
      requestId: 'req-1',
    });

    const day = await prisma.userDay.findUniqueOrThrow({
      where: { userId_localDate: { userId, localDate: '2026-09-08' } },
    });
    expect(day.status).toBe('MISSED');
  });

  it('идемпотентен по requestId', async () => {
    const params = {
      adminTelegramId: ADMIN_TELEGRAM_ID,
      userId,
      value: 5,
      reason: 'сбой',
      requestId: 'req-1',
    };

    await admin.restoreStreak(params);
    expect(await admin.restoreStreak(params)).toEqual({ ok: true, alreadyApplied: true });
    expect(await prisma.adminAdjustment.count()).toBe(1);
  });
});

describe('конфигурация в рантайме', () => {
  it('обновляет валюту и сразу отражается после инвалидации кэша', async () => {
    const config = new ConfigService(prisma);
    expect((await config.currency()).nameOne).toBe('солнышко');

    await admin.updateCurrencyConfig(
      { icon: '⭐', nameOne: 'звезда', nameFew: 'звезды', nameMany: 'звёзд' },
      userId,
    );
    config.invalidateCurrency();

    expect((await config.currency()).icon).toBe('⭐');
    expect((await config.currency()).nameOne).toBe('звезда');
  });

  it('отклоняет пустые значения валюты', async () => {
    const ok = await admin.updateCurrencyConfig(
      { icon: '', nameOne: 'a', nameFew: 'b', nameMany: 'c' },
      userId,
    );
    expect(ok).toBe(false);
  });

  it('обновляет поле экономики и отклоняет отрицательное значение', async () => {
    expect(await admin.updateEconomyField('dailyLearningLimit', 30, userId)).toBe(true);
    expect(await admin.updateEconomyField('dailyLearningLimit', -1, userId)).toBe(false);

    const config = new ConfigService(prisma);
    expect((await config.economy()).dailyLearningLimit).toBe(30);
  });
});

describe('управление текстами', () => {
  beforeEach(async () => {
    await prisma.contentText.create({
      data: { key: 'streak.lost', variant: 0, group: 'STREAK', text: 'Ничего страшного', isSeed: true },
    });
  });

  it('добавляет вариант с номером max + 1', async () => {
    const result = await admin.addTextVariant('streak.lost', 'STREAK', 'Новый текст', userId);
    expect(result).toEqual({ ok: true, variant: 1 });
  });

  it('запрещает неизвестный placeholder', async () => {
    const result = await admin.addTextVariant('streak.lost', 'STREAK', 'Текст {unknown}', userId);
    expect(result.ok).toBe(false);
  });

  it('запрещает пустой текст', async () => {
    const result = await admin.addTextVariant('streak.lost', 'STREAK', '   ', userId);
    expect(result.ok).toBe(false);
  });

  it('переключает активность варианта', async () => {
    await admin.toggleTextVariant('streak.lost', 0);
    const row = await prisma.contentText.findUniqueOrThrow({
      where: { key_variant: { key: 'streak.lost', variant: 0 } },
    });
    expect(row.isActive).toBe(false);
  });

  it('восстанавливает seed-текст и не трогает пользовательские варианты', async () => {
    await admin.updateTextVariant('streak.lost', 0, 'Изменено вручную', userId);
    await admin.addTextVariant('streak.lost', 'STREAK', 'Мой вариант', userId);

    await admin.restoreSeedVariant('streak.lost', 0);

    const seed = await prisma.contentText.findUniqueOrThrow({
      where: { key_variant: { key: 'streak.lost', variant: 0 } },
    });
    const custom = await prisma.contentText.findUniqueOrThrow({
      where: { key_variant: { key: 'streak.lost', variant: 1 } },
    });

    expect(seed.text).toContain('Ничего страшного');
    expect(custom.text).toBe('Мой вариант');
  });

  it('изменение через админку видно сразу после инвалидации', async () => {
    const content = new ContentService(prisma, { next: () => 0 });
    expect(await content.render('streak.lost', userId)).toBe('Ничего страшного');

    await admin.updateTextVariant('streak.lost', 0, 'Новый текст', userId);
    content.invalidate('streak.lost');

    expect(await content.render('streak.lost', userId)).toBe('Новый текст');
  });
});

describe('разовое сообщение пользователю', () => {
  it('резервирует сообщение и возвращает адресата', async () => {
    const result = await admin.reserveMessage({
      adminTelegramId: ADMIN_TELEGRAM_ID,
      userId,
      text: '  Привет ❤️  ',
      requestId: 'req-1',
    });

    expect(result).toEqual({ ok: true, telegramId: 1n, text: 'Привет ❤️' });

    const stored = await prisma.adminMessage.findFirstOrThrow({ where: { userId } });
    expect(stored.text).toBe('Привет ❤️');
    expect(stored.sentAt).toBeNull();
  });

  it('повтор с тем же requestId не отправляет второй раз', async () => {
    const params = {
      adminTelegramId: ADMIN_TELEGRAM_ID,
      userId,
      text: 'Привет',
      requestId: 'req-1',
    };

    expect((await admin.reserveMessage(params)).ok).toBe(true);
    expect(await admin.reserveMessage(params)).toEqual({ ok: false, reason: 'ALREADY_SENT' });

    expect(await prisma.adminMessage.count()).toBe(1);
  });

  it('разные нажатия создают разные сообщения', async () => {
    await admin.reserveMessage({
      adminTelegramId: ADMIN_TELEGRAM_ID,
      userId,
      text: 'Первое',
      requestId: 'req-1',
    });
    await admin.reserveMessage({
      adminTelegramId: ADMIN_TELEGRAM_ID,
      userId,
      text: 'Второе',
      requestId: 'req-2',
    });

    expect(await prisma.adminMessage.count()).toBe(2);
  });

  it('отклоняет пустой текст и неизвестного пользователя', async () => {
    expect(
      await admin.reserveMessage({
        adminTelegramId: ADMIN_TELEGRAM_ID,
        userId,
        text: '   ',
        requestId: 'a',
      }),
    ).toEqual({ ok: false, reason: 'INVALID' });

    expect(
      await admin.reserveMessage({
        adminTelegramId: ADMIN_TELEGRAM_ID,
        userId: 9999,
        text: 'Привет',
        requestId: 'b',
      }),
    ).toEqual({ ok: false, reason: 'USER_NOT_FOUND' });
  });

  it('отмечает фактическую отправку', async () => {
    await admin.reserveMessage({
      adminTelegramId: ADMIN_TELEGRAM_ID,
      userId,
      text: 'Привет',
      requestId: 'req-1',
    });

    await admin.markMessageSent(userId, 'req-1');

    const stored = await prisma.adminMessage.findFirstOrThrow({ where: { userId } });
    expect(stored.sentAt).not.toBeNull();
  });
});

describe('слово дня и контент', () => {
  it('назначает и заменяет слово дня на дату, слово может быть любым', async () => {
    expect(await admin.setWordOfDay('2026-09-10', 'kocham', 'люблю')).toEqual({ ok: true });
    expect(await admin.setWordOfDay('2026-09-10', 'nieznane', 'незнакомое')).toEqual({
      ok: true,
    });

    const entries = await prisma.wordOfDay.findMany({ where: { date: '2026-09-10' } });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.polish).toBe('nieznane');
    expect(entries[0]?.russian).toBe('незнакомое');
  });

  it('отклоняет неверную дату и пустое слово', async () => {
    expect(await admin.setWordOfDay('10-09-2026', 'kot', 'кот')).toEqual({
      ok: false,
      reason: 'INVALID_DATE',
    });
    expect(await admin.setWordOfDay('2026-09-10', '', 'кот')).toEqual({
      ok: false,
      reason: 'INVALID_WORD',
    });
  });

  it('деактивация категории админом каскадно выключает слова и сохраняет строки', async () => {
    const categoryId = await seedCategory(prisma, 'Cvety', 5);

    expect(await admin.setCategoryActive(categoryId, false)).toBe(true);

    const words = await prisma.word.findMany({ where: { categoryId } });
    expect(words).toHaveLength(5);
    expect(words.every((word) => !word.isActive)).toBe(true);
  });

  it('реактивация категории не включает слова автоматически', async () => {
    const categoryId = await seedCategory(prisma, 'Cvety', 3);
    await admin.setCategoryActive(categoryId, false);
    await admin.setCategoryActive(categoryId, true);

    const category = await prisma.category.findUniqueOrThrow({ where: { id: categoryId } });
    const words = await prisma.word.findMany({ where: { categoryId } });

    expect(category.isActive).toBe(true);
    expect(words.every((word) => !word.isActive)).toBe(true);
  });
});
