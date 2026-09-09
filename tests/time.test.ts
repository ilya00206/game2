import { describe, expect, it } from 'vitest';
import {
  addDaysToLocalDate,
  createFixedClock,
  daysBetweenLocalDates,
  isValidTimezone,
  localHour,
  toLocalDate,
} from '../src/core/time.js';

const MINSK = 'Europe/Minsk';

describe('локальное время пользователя', () => {
  it('относит момент до полуночи к предыдущей локальной дате', () => {
    // 2026-09-09T20:59:00Z = 23:59 в Минске (UTC+3)
    const clock = createFixedClock('2026-09-09T20:59:00.000Z');
    expect(toLocalDate(clock.now(), MINSK)).toBe('2026-09-09');
    expect(localHour(clock.now(), MINSK)).toBe(23);
  });

  it('относит момент после полуночи к следующей локальной дате', () => {
    const clock = createFixedClock('2026-09-09T21:05:00.000Z');
    expect(toLocalDate(clock.now(), MINSK)).toBe('2026-09-10');
    expect(localHour(clock.now(), MINSK)).toBe(0);
  });

  it('не зависит от таймзоны процесса', () => {
    const instant = new Date('2026-09-09T21:30:00.000Z');
    expect(toLocalDate(instant, 'UTC')).toBe('2026-09-09');
    expect(toLocalDate(instant, MINSK)).toBe('2026-09-10');
  });

  it('считает арифметику локальных дат', () => {
    expect(addDaysToLocalDate('2026-09-09', 1)).toBe('2026-09-10');
    expect(addDaysToLocalDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetweenLocalDates('2026-09-09', '2026-09-12')).toBe(3);
  });

  it('валидирует IANA-таймзону', () => {
    expect(isValidTimezone(MINSK)).toBe(true);
    expect(isValidTimezone('Nowhere/Nothing')).toBe(false);
  });
});
