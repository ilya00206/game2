import { randomInt } from 'node:crypto';

/** Генератор случайности как зависимость — для воспроизводимых тестов (§11). */
export interface Rng {
  /** Число в диапазоне [0, 1). */
  next(): number;
}

export const cryptoRng: Rng = {
  next: () => randomInt(0, 2 ** 31) / 2 ** 31,
};

/** Детерминированный генератор (mulberry32) для тестов. */
export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next: () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export function pickIndex(rng: Rng, length: number): number {
  return Math.min(length - 1, Math.floor(rng.next() * length));
}

/** Выбор элемента пропорционально весу. */
export function pickWeighted<T>(rng: Rng, items: T[], weightOf: (item: T) => number): T | undefined {
  if (items.length === 0) {
    return undefined;
  }

  const weights = items.map((item) => Math.max(weightOf(item), 0));
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  if (total <= 0) {
    return items[pickIndex(rng, items.length)];
  }

  let threshold = rng.next() * total;
  for (let index = 0; index < items.length; index += 1) {
    threshold -= weights[index] ?? 0;
    if (threshold <= 0) {
      return items[index];
    }
  }

  return items[items.length - 1];
}
