export const DAY_STATUSES = ['COMPLETED', 'EARLY', 'SHIELDED', 'MISSED'] as const;
export type DayStatus = (typeof DAY_STATUSES)[number];

/** Дальше этого горизонта серия считается оборванной, чтобы проход был ограничен. */
export const MAX_RECONCILE_DAYS = 400;

export interface DayInput {
  localDate: string;
  status: DayStatus;
  applied: boolean;
}

export interface DayMutation {
  localDate: string;
  status: DayStatus;
  create: boolean;
  consumesShield: boolean;
}

export interface ReconcileInput {
  today: string;
  days: DayInput[];
  currentStreak: number;
  maxStreak: number;
  shields: number;
}

export interface ReconcileResult {
  currentStreak: number;
  maxStreak: number;
  shields: number;
  mutations: DayMutation[];
  shieldedDates: string[];
  missedDates: string[];
  streakIncreasedOn: string[];
}

function toUtcDate(localDate: string): Date {
  return new Date(`${localDate}T00:00:00.000Z`);
}

function toLocalDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(localDate: string, days: number): string {
  const date = toUtcDate(localDate);
  date.setUTCDate(date.getUTCDate() + days);
  return toLocalDateString(date);
}

function diffDays(from: string, to: string): number {
  return Math.round((toUtcDate(to).getTime() - toUtcDate(from).getTime()) / 86_400_000);
}

/**
 * Последовательно сверяет необработанные даты до текущей включительно (§3.2).
 * Порядок правил фиксирован, текущий день без активности пропущенным не считается.
 */
export function reconcileDays(input: ReconcileInput): ReconcileResult {
  const byDate = new Map(input.days.map((day) => [day.localDate, day]));

  let currentStreak = input.currentStreak;
  let maxStreak = input.maxStreak;
  let shields = input.shields;

  const mutations: DayMutation[] = [];
  const shieldedDates: string[] = [];
  const missedDates: string[] = [];
  const streakIncreasedOn: string[] = [];

  const applied = input.days.filter((day) => day.applied).map((day) => day.localDate);
  const pending = input.days.filter((day) => !day.applied).map((day) => day.localDate);

  let start: string;
  if (applied.length > 0) {
    start = addDays(applied.reduce((left, right) => (left > right ? left : right)), 1);
  } else if (pending.length > 0) {
    start = pending.reduce((left, right) => (left < right ? left : right));
  } else {
    start = input.today;
  }

  if (start > input.today) {
    return {
      currentStreak,
      maxStreak,
      shields,
      mutations,
      shieldedDates,
      missedDates,
      streakIncreasedOn,
    };
  }

  // Очень длительный перерыв обрывает серию без поштучного прохода по датам.
  if (diffDays(start, input.today) > MAX_RECONCILE_DAYS) {
    currentStreak = 0;
    start = input.today;
  }

  for (let date = start; date <= input.today; date = addDays(date, 1)) {
    const record = byDate.get(date);

    if (record?.applied) {
      continue;
    }

    if (!record) {
      if (date === input.today) {
        continue;
      }

      if (shields > 0) {
        shields -= 1;
        shieldedDates.push(date);
        mutations.push({ localDate: date, status: 'SHIELDED', create: true, consumesShield: true });
      } else {
        currentStreak = 0;
        missedDates.push(date);
        mutations.push({ localDate: date, status: 'MISSED', create: true, consumesShield: false });
      }
      continue;
    }

    switch (record.status) {
      case 'COMPLETED':
      case 'EARLY':
        currentStreak += 1;
        streakIncreasedOn.push(date);
        break;
      case 'SHIELDED':
        break;
      case 'MISSED':
        currentStreak = 0;
        missedDates.push(date);
        break;
    }

    mutations.push({
      localDate: date,
      status: record.status,
      create: false,
      consumesShield: false,
    });

    maxStreak = Math.max(maxStreak, currentStreak);
  }

  maxStreak = Math.max(maxStreak, currentStreak);

  return {
    currentStreak,
    maxStreak,
    shields,
    mutations,
    shieldedDates,
    missedDates,
    streakIncreasedOn,
  };
}
