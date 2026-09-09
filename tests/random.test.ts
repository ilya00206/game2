import { describe, expect, it } from 'vitest';
import { createSeededRng, pickWeighted } from '../src/core/random.js';

describe('генератор случайности', () => {
  it('детерминирован при одинаковом seed', () => {
    const first = createSeededRng(42);
    const second = createSeededRng(42);
    const left = [first.next(), first.next(), first.next()];
    const right = [second.next(), second.next(), second.next()];
    expect(left).toEqual(right);
  });

  it('возвращает значения в диапазоне [0, 1)', () => {
    const rng = createSeededRng(7);
    for (let index = 0; index < 100; index += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('выбирает элементы пропорционально весу', () => {
    const rng = createSeededRng(1);
    const counts = { heavy: 0, light: 0 };

    for (let index = 0; index < 2000; index += 1) {
      const picked = pickWeighted(rng, ['heavy', 'light'] as const, (item) =>
        item === 'heavy' ? 9 : 1,
      );
      if (picked) {
        counts[picked] += 1;
      }
    }

    expect(counts.heavy).toBeGreaterThan(counts.light * 3);
  });

  it('возвращает undefined на пустом списке', () => {
    expect(pickWeighted(createSeededRng(1), [], () => 1)).toBeUndefined();
  });
});
