import { describe, expect, it } from 'vitest';
import {
  findStreakTitle,
  isStreakMilestone,
  STREAK_TITLES,
} from '../src/content/streakTitles.js';

describe('титулы и вехи стрика', () => {
  it('отдаёт титул только для точного значения из списка', () => {
    expect(findStreakTitle(7)).toBe('Умница-красавица');
    expect(findStreakTitle(30)).toBe('Pani Kochana');
    expect(findStreakTitle(8)).toBeUndefined();
  });

  it('хранит список отсортированным по возрастанию', () => {
    const values = STREAK_TITLES.map((entry) => entry.streak);
    expect([...values].sort((left, right) => left - right)).toEqual(values);
  });

  it('распознаёт вехи', () => {
    expect(isStreakMilestone(1)).toBe(true);
    expect(isStreakMilestone(100)).toBe(true);
    expect(isStreakMilestone(2)).toBe(false);
  });
});
