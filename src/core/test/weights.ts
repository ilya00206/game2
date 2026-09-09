export const QUESTION_COUNT = 10;
export const COOLDOWN_QUESTIONS = 7;
/** Минимально допустимая дистанция после cooldown в 7 вопросов. */
export const MIN_DISTANCE = COOLDOWN_QUESTIONS + 1;

export const HARD_THRESHOLD = 0.45;
export const KNOWN_THRESHOLD = 0.75;

export type DifficultyGroup = 'HARD' | 'MEDIUM' | 'KNOWN';
export type SlotKind = DifficultyGroup | 'ANY';

/** Обязательный состав теста 4/3/2/1 (§4.3). */
export const SLOT_PLAN: SlotKind[] = [
  'HARD',
  'HARD',
  'HARD',
  'HARD',
  'MEDIUM',
  'MEDIUM',
  'MEDIUM',
  'KNOWN',
  'KNOWN',
  'ANY',
];

export interface TestStats {
  testCorrectCount: number;
  testWrongCount: number;
}

/** Сглаженная точность, чтобы новые для теста слова не считались крайними. */
export function smoothedAccuracy(stats: TestStats): number {
  const attempts = stats.testCorrectCount + stats.testWrongCount;
  return (stats.testCorrectCount + 1) / (attempts + 2);
}

export function difficultyOf(accuracy: number): number {
  return 0.5 + 2 * (1 - accuracy);
}

export function uncertaintyOf(accuracy: number): number {
  return 1 + 2 * (4 * accuracy * (1 - accuracy));
}

export function groupOf(stats: TestStats): DifficultyGroup {
  const accuracy = smoothedAccuracy(stats);
  if (accuracy < HARD_THRESHOLD) {
    return 'HARD';
  }
  if (accuracy < KNOWN_THRESHOLD) {
    return 'MEDIUM';
  }
  return 'KNOWN';
}

/**
 * Расстояние в вопросах с прошлого показа слова целью.
 * `null` — слово сегодня целью не было.
 */
export function distanceSince(history: number[], wordId: number): number | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index] === wordId) {
      return history.length - index;
    }
  }
  return null;
}

export function freshnessOf(distance: number | null): number {
  if (distance === null || distance >= 10) {
    return 1.3;
  }
  if (distance >= MIN_DISTANCE) {
    return 1.0;
  }
  return 0.5;
}

export function isOnCooldown(distance: number | null): boolean {
  return distance !== null && distance < MIN_DISTANCE;
}

export function questionWeight(stats: TestStats, distance: number | null): number {
  const accuracy = smoothedAccuracy(stats);
  return difficultyOf(accuracy) * freshnessOf(distance) * uncertaintyOf(accuracy);
}
