import { DateTime } from 'luxon';

/** Источник времени; в тестах подменяется детерминированной реализацией (§11). */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function createFixedClock(iso: string): Clock {
  const fixed = new Date(iso);
  return { now: () => fixed };
}

/** Локальная дата пользователя в формате YYYY-MM-DD. */
export function toLocalDate(instant: Date, timezone: string): string {
  return DateTime.fromJSDate(instant, { zone: timezone }).toFormat('yyyy-MM-dd');
}

export function localHour(instant: Date, timezone: string): number {
  return DateTime.fromJSDate(instant, { zone: timezone }).hour;
}

export function localMinute(instant: Date, timezone: string): number {
  return DateTime.fromJSDate(instant, { zone: timezone }).minute;
}

export function addDaysToLocalDate(localDate: string, days: number): string {
  return DateTime.fromFormat(localDate, 'yyyy-MM-dd', { zone: 'utc' })
    .plus({ days })
    .toFormat('yyyy-MM-dd');
}

export function daysBetweenLocalDates(from: string, to: string): number {
  const start = DateTime.fromFormat(from, 'yyyy-MM-dd', { zone: 'utc' });
  const end = DateTime.fromFormat(to, 'yyyy-MM-dd', { zone: 'utc' });
  return Math.round(end.diff(start, 'days').days);
}

/** Границы локальных суток в UTC-моментах: [start, end). */
export function localDayRange(localDate: string, timezone: string): { start: Date; end: Date } {
  const start = DateTime.fromFormat(localDate, 'yyyy-MM-dd', { zone: timezone }).startOf('day');
  return { start: start.toJSDate(), end: start.plus({ days: 1 }).toJSDate() };
}

export function isValidTimezone(timezone: string): boolean {
  return DateTime.local().setZone(timezone).isValid;
}
