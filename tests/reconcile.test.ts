import { describe, expect, it } from 'vitest';
import {
  MAX_RECONCILE_DAYS,
  reconcileDays,
  type DayInput,
  type ReconcileInput,
} from '../src/core/streak/reconcile.js';

function input(overrides: Partial<ReconcileInput> & { today: string }): ReconcileInput {
  return {
    days: [],
    currentStreak: 0,
    maxStreak: 0,
    shields: 0,
    ...overrides,
  };
}

function day(localDate: string, status: DayInput['status'], applied = false): DayInput {
  return { localDate, status, applied };
}

describe('сверка дней стрика', () => {
  it('засчитывает завершённый сегодняшний день', () => {
    const result = reconcileDays(
      input({ today: '2026-09-09', days: [day('2026-09-09', 'COMPLETED')] }),
    );

    expect(result.currentStreak).toBe(1);
    expect(result.maxStreak).toBe(1);
    expect(result.streakIncreasedOn).toEqual(['2026-09-09']);
  });

  it('не увеличивает стрик повторно для уже применённого дня', () => {
    const result = reconcileDays(
      input({
        today: '2026-09-09',
        days: [day('2026-09-09', 'COMPLETED', true)],
        currentStreak: 5,
        maxStreak: 5,
      }),
    );

    expect(result.currentStreak).toBe(5);
    expect(result.mutations).toEqual([]);
  });

  it('не помечает текущий день без активности пропущенным', () => {
    const result = reconcileDays(
      input({
        today: '2026-09-10',
        days: [day('2026-09-09', 'COMPLETED', true)],
        currentStreak: 3,
        maxStreak: 3,
      }),
    );

    expect(result.currentStreak).toBe(3);
    expect(result.missedDates).toEqual([]);
    expect(result.mutations).toEqual([]);
  });

  it('обрывает серию на пропущенном дне без щита', () => {
    const result = reconcileDays(
      input({
        today: '2026-09-11',
        days: [day('2026-09-09', 'COMPLETED', true)],
        currentStreak: 7,
        maxStreak: 7,
      }),
    );

    expect(result.currentStreak).toBe(0);
    expect(result.missedDates).toEqual(['2026-09-10']);
    expect(result.maxStreak).toBe(7);
  });

  it('щит защищает пропущенный день и расходуется по одному', () => {
    const result = reconcileDays(
      input({
        today: '2026-09-12',
        days: [day('2026-09-09', 'COMPLETED', true)],
        currentStreak: 4,
        maxStreak: 4,
        shields: 2,
      }),
    );

    expect(result.shieldedDates).toEqual(['2026-09-10', '2026-09-11']);
    expect(result.shields).toBe(0);
    expect(result.currentStreak).toBe(4);
    expect(result.missedDates).toEqual([]);
  });

  it('при нехватке щитов серия обрывается один раз', () => {
    const result = reconcileDays(
      input({
        today: '2026-09-13',
        days: [day('2026-09-09', 'COMPLETED', true)],
        currentStreak: 4,
        maxStreak: 9,
        shields: 1,
      }),
    );

    expect(result.shieldedDates).toEqual(['2026-09-10']);
    expect(result.missedDates).toEqual(['2026-09-11', '2026-09-12']);
    expect(result.currentStreak).toBe(0);
    expect(result.maxStreak).toBe(9);
  });

  it('после обрыва первая полная сессия начинает серию с 1', () => {
    const result = reconcileDays(
      input({
        today: '2026-09-12',
        days: [day('2026-09-09', 'COMPLETED', true), day('2026-09-12', 'COMPLETED')],
        currentStreak: 6,
        maxStreak: 6,
      }),
    );

    expect(result.missedDates).toEqual(['2026-09-10', '2026-09-11']);
    expect(result.currentStreak).toBe(1);
  });

  it('EARLY увеличивает серию при наступлении забронированной даты', () => {
    const result = reconcileDays(
      input({
        today: '2026-09-10',
        days: [day('2026-09-09', 'COMPLETED', true), day('2026-09-10', 'EARLY')],
        currentStreak: 2,
        maxStreak: 2,
      }),
    );

    expect(result.currentStreak).toBe(3);
    expect(result.streakIncreasedOn).toEqual(['2026-09-10']);
  });

  it('EARLY применяется раньше щита', () => {
    const result = reconcileDays(
      input({
        today: '2026-09-11',
        days: [day('2026-09-09', 'COMPLETED', true), day('2026-09-10', 'EARLY')],
        currentStreak: 2,
        maxStreak: 2,
        shields: 1,
      }),
    );

    expect(result.currentStreak).toBe(3);
    expect(result.shields).toBe(1);
    expect(result.shieldedDates).toEqual([]);
  });

  it('SHIELDED сохраняет серию без увеличения', () => {
    const result = reconcileDays(
      input({
        today: '2026-09-10',
        days: [day('2026-09-10', 'SHIELDED')],
        currentStreak: 5,
        maxStreak: 5,
      }),
    );

    expect(result.currentStreak).toBe(5);
    expect(result.streakIncreasedOn).toEqual([]);
  });

  it('обновляет личный рекорд', () => {
    const result = reconcileDays(
      input({
        today: '2026-09-09',
        days: [day('2026-09-09', 'COMPLETED')],
        currentStreak: 9,
        maxStreak: 9,
      }),
    );

    expect(result.currentStreak).toBe(10);
    expect(result.maxStreak).toBe(10);
  });

  it('очень длительный перерыв обрывает серию без поштучного прохода', () => {
    const result = reconcileDays(
      input({
        today: '2028-09-09',
        days: [day('2026-09-09', 'COMPLETED', true)],
        currentStreak: 50,
        maxStreak: 50,
      }),
    );

    expect(result.currentStreak).toBe(0);
    expect(result.mutations.length).toBeLessThanOrEqual(MAX_RECONCILE_DAYS);
    expect(result.maxStreak).toBe(50);
  });

  it('ничего не делает, если всё уже обработано', () => {
    const result = reconcileDays(
      input({
        today: '2026-09-09',
        days: [day('2026-09-09', 'COMPLETED', true)],
        currentStreak: 1,
        maxStreak: 1,
      }),
    );

    expect(result.mutations).toEqual([]);
    expect(result.currentStreak).toBe(1);
  });
});
