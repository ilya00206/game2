import { describe, expect, it } from 'vitest';
import { createSeededRng } from '../src/core/random.js';
import {
  buildSessionPlan,
  summarizeCategory,
  wordWeight,
  type PlanCandidate,
} from '../src/core/learning/planner.js';

const NOW = new Date('2026-09-09T10:00:00.000Z');

function candidate(overrides: Partial<PlanCandidate> & { wordId: number }): PlanCandidate {
  return {
    currentLevel: 1,
    timesUnknown: 0,
    consecutiveUnknown: 0,
    nextReviewAt: null,
    ...overrides,
  };
}

function makeCandidates(count: number, from = 1): PlanCandidate[] {
  return Array.from({ length: count }, (_, index) => candidate({ wordId: from + index }));
}

describe('вес слова', () => {
  it('даёт новым словам больший базовый вес', () => {
    expect(wordWeight(candidate({ wordId: 1, currentLevel: 0 }))).toBe(6);
    expect(wordWeight(candidate({ wordId: 2, currentLevel: 1 }))).toBe(3);
    expect(wordWeight(candidate({ wordId: 3, currentLevel: 2 }))).toBe(1);
  });

  it('ограничивает вклад трудности', () => {
    const weight = wordWeight(
      candidate({ wordId: 1, currentLevel: 2, timesUnknown: 99, consecutiveUnknown: 99 }),
    );
    expect(weight).toBeCloseTo(1 + 5 * 0.4 + 3 * 0.6, 5);
  });
});

describe('план обычной сессии', () => {
  it('берёт не более 10 уникальных слов', () => {
    const plan = buildSessionPlan(makeCandidates(25), createSeededRng(1), NOW);
    expect(plan).toHaveLength(10);
    expect(new Set(plan).size).toBe(10);
  });

  it('сокращается до числа доступных слов без повторов', () => {
    const plan = buildSessionPlan(makeCandidates(4), createSeededRng(2), NOW);
    expect(plan).toHaveLength(4);
    expect(new Set(plan).size).toBe(4);
  });

  it('возвращает пустой план, если активных слов нет', () => {
    expect(buildSessionPlan([], createSeededRng(3), NOW)).toEqual([]);
  });

  it('исключает слова на кулдауне, пока хватает свободных', () => {
    const cooling = candidate({
      wordId: 999,
      nextReviewAt: new Date(NOW.getTime() + 60_000),
    });
    const plan = buildSessionPlan([...makeCandidates(10), cooling], createSeededRng(4), NOW);

    expect(plan).toHaveLength(10);
    expect(plan).not.toContain(999);
  });

  it('добирает слова на кулдауне по возрастанию nextReviewAt', () => {
    const cooling = [
      candidate({ wordId: 30, nextReviewAt: new Date(NOW.getTime() + 3 * 3600_000) }),
      candidate({ wordId: 10, nextReviewAt: new Date(NOW.getTime() + 1 * 3600_000) }),
      candidate({ wordId: 20, nextReviewAt: new Date(NOW.getTime() + 2 * 3600_000) }),
    ];
    const plan = buildSessionPlan([candidate({ wordId: 1 }), ...cooling], createSeededRng(5), NOW);

    expect(plan).toEqual([1, 10, 20, 30]);
  });

  it('создаёт сессию, даже если все слова на кулдауне', () => {
    const cooling = [
      candidate({ wordId: 2, nextReviewAt: new Date(NOW.getTime() + 2 * 3600_000) }),
      candidate({ wordId: 1, nextReviewAt: new Date(NOW.getTime() + 1 * 3600_000) }),
    ];
    expect(buildSessionPlan(cooling, createSeededRng(6), NOW)).toEqual([1, 2]);
  });

  it('истёкший кулдаун возвращает слово в обычную выборку', () => {
    const expired = candidate({ wordId: 7, nextReviewAt: new Date(NOW.getTime() - 1000) });
    expect(buildSessionPlan([expired], createSeededRng(7), NOW)).toEqual([7]);
  });
});

describe('саммари категории', () => {
  it('считает всего, пройдено, выучено, осталось и нужно повторить', () => {
    const summary = summarizeCategory([
      { currentLevel: 2, lastAnswer: 'KNOW', timesKnown: 5 },
      { currentLevel: 2, lastAnswer: 'KNOW', timesKnown: 3 },
      { currentLevel: 1, lastAnswer: 'UNKNOWN', timesKnown: 1 },
      { currentLevel: 0, lastAnswer: null, timesKnown: 0 },
    ]);

    expect(summary).toEqual({ total: 4, passed: 3, learned: 2, remaining: 2, toRepeat: 1 });
  });

  it('слово без ответов не попадает в «нужно повторить» и «пройдено»', () => {
    const summary = summarizeCategory([{ currentLevel: 0, lastAnswer: null, timesKnown: 0 }]);
    expect(summary).toEqual({ total: 1, passed: 0, learned: 0, remaining: 1, toRepeat: 0 });
  });

  it('слово с последним «Не знаю» остаётся пройденным', () => {
    const summary = summarizeCategory([{ currentLevel: 1, lastAnswer: 'UNKNOWN', timesKnown: 2 }]);
    expect(summary.passed).toBe(1);
    expect(summary.toRepeat).toBe(1);
  });
});
