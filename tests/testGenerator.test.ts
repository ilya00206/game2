import { describe, expect, it } from 'vitest';
import { createSeededRng } from '../src/core/random.js';
import {
  generateTest,
  type GenerateTestInput,
  type TestCandidate,
} from '../src/core/test/generator.js';
import { isCategoryEligible, normalizeTranslation } from '../src/core/test/normalize.js';
import {
  distanceSince,
  freshnessOf,
  groupOf,
  isOnCooldown,
  smoothedAccuracy,
  QUESTION_COUNT,
} from '../src/core/test/weights.js';

function candidate(overrides: Partial<TestCandidate> & { wordId: number }): TestCandidate {
  return {
    categoryId: 1,
    polish: `pl-${overrides.wordId}`,
    russian: `ru-${overrides.wordId}`,
    testCorrectCount: 0,
    testWrongCount: 0,
    ...overrides,
  };
}

function categoryWords(categoryId: number, count: number, from = 1) {
  return Array.from({ length: count }, (_, index) => ({
    wordId: from + index,
    russian: `ru-${from + index}`,
  }));
}

function input(overrides: Partial<GenerateTestInput> = {}): GenerateTestInput {
  const candidates = overrides.candidates ?? [
    candidate({ wordId: 1 }),
    candidate({ wordId: 2 }),
    candidate({ wordId: 3 }),
    candidate({ wordId: 4 }),
    candidate({ wordId: 5 }),
    candidate({ wordId: 6 }),
  ];

  return {
    candidates,
    wordsByCategory: overrides.wordsByCategory ?? new Map([[1, categoryWords(1, 12)]]),
    history: overrides.history ?? [],
    rng: overrides.rng ?? createSeededRng(7),
    ...overrides,
  };
}

describe('веса и группы теста', () => {
  it('сглаживает точность для слова без попыток', () => {
    expect(smoothedAccuracy({ testCorrectCount: 0, testWrongCount: 0 })).toBe(0.5);
    expect(groupOf({ testCorrectCount: 0, testWrongCount: 0 })).toBe('MEDIUM');
  });

  it('относит частые ошибки к сложным, а уверенные ответы — к известным', () => {
    expect(groupOf({ testCorrectCount: 0, testWrongCount: 8 })).toBe('HARD');
    expect(groupOf({ testCorrectCount: 20, testWrongCount: 0 })).toBe('KNOWN');
  });

  it('считает расстояние от последнего показа', () => {
    expect(distanceSince([5, 3, 5, 1], 5)).toBe(2);
    expect(distanceSince([5, 3], 9)).toBeNull();
  });

  it('назначает freshness по расстоянию', () => {
    expect(freshnessOf(null)).toBe(1.3);
    expect(freshnessOf(12)).toBe(1.3);
    expect(freshnessOf(9)).toBe(1.0);
    expect(freshnessOf(8)).toBe(1.0);
    expect(freshnessOf(7)).toBe(0.5);
  });

  it('считает cooldown нарушенным при расстоянии меньше 8', () => {
    expect(isOnCooldown(7)).toBe(true);
    expect(isOnCooldown(8)).toBe(false);
    expect(isOnCooldown(null)).toBe(false);
  });
});

describe('пригодность категории', () => {
  it('требует 4 различных нормализованных перевода', () => {
    expect(isCategoryEligible(categoryWords(1, 4))).toBe(true);
    expect(isCategoryEligible(categoryWords(1, 3))).toBe(false);
  });

  it('считает переводы, отличающиеся регистром и пробелами, одинаковыми', () => {
    const words = [
      { wordId: 1, russian: 'кот' },
      { wordId: 2, russian: 'КОТ' },
      { wordId: 3, russian: '  кот  ' },
      { wordId: 4, russian: 'кот\tкот' },
    ];
    expect(isCategoryEligible(words)).toBe(false);
    expect(normalizeTranslation('  Кот   Дома ')).toBe('кот дома');
  });
});

describe('генерация теста', () => {
  it('создаёт 10 вопросов по 4 варианта', () => {
    const questions = generateTest(input());

    expect(questions).toHaveLength(QUESTION_COUNT);
    for (const question of questions) {
      expect(question.options).toHaveLength(4);
      expect(question.correctOption).toBeGreaterThanOrEqual(0);
      expect(question.correctOption).toBeLessThan(4);
      expect(question.options[question.correctOption]?.wordId).toBe(question.wordId);
    }
  });

  it('все варианты из категории цели и различны после нормализации', () => {
    const questions = generateTest(input());

    for (const question of questions) {
      const labels = question.options.map((option) => normalizeTranslation(option.label));
      expect(new Set(labels).size).toBe(4);

      const categoryWordIds = new Set(categoryWords(1, 12).map((word) => word.wordId));
      for (const option of question.options) {
        expect(categoryWordIds.has(option.wordId)).toBe(true);
      }
    }
  });

  it('не повторяет цель два раза подряд', () => {
    const questions = generateTest(input());

    for (let index = 1; index < questions.length; index += 1) {
      expect(questions[index]?.wordId).not.toBe(questions[index - 1]?.wordId);
    }
  });

  it('при пуле из 5+ целей не показывает слово больше двух раз', () => {
    const questions = generateTest(input());
    const counts = new Map<number, number>();

    for (const question of questions) {
      counts.set(question.wordId, (counts.get(question.wordId) ?? 0) + 1);
    }

    for (const count of counts.values()) {
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it('при достаточном пуле соблюдает cooldown в 7 вопросов', () => {
    const candidates = Array.from({ length: 12 }, (_, index) =>
      candidate({ wordId: index + 1 }),
    );
    const questions = generateTest(input({ candidates }));

    const seen: number[] = [];
    for (const question of questions) {
      const distance = distanceSince(seen, question.wordId);
      expect(isOnCooldown(distance)).toBe(false);
      seen.push(question.wordId);
    }
  });

  it('учитывает историю показов текущего дня', () => {
    const candidates = Array.from({ length: 12 }, (_, index) =>
      candidate({ wordId: index + 1 }),
    );
    const questions = generateTest(input({ candidates, history: [1, 2, 3] }));

    // Слово 3 показано последним, поэтому не может открыть новый тест.
    expect(questions[0]?.wordId).not.toBe(3);
  });

  it('распределяет вопросы между категориями', () => {
    const candidates = [
      candidate({ wordId: 1, categoryId: 1 }),
      candidate({ wordId: 2, categoryId: 1 }),
      candidate({ wordId: 3, categoryId: 1 }),
      candidate({ wordId: 11, categoryId: 2, russian: 'ru-11' }),
      candidate({ wordId: 12, categoryId: 2, russian: 'ru-12' }),
      candidate({ wordId: 13, categoryId: 2, russian: 'ru-13' }),
    ];
    const wordsByCategory = new Map([
      [1, categoryWords(1, 8, 1)],
      [2, categoryWords(2, 8, 11)],
    ]);

    const questions = generateTest(input({ candidates, wordsByCategory }));
    const categories = new Set(questions.map((question) => question.categoryId));

    expect(categories.size).toBe(2);
  });

  it('не зависает при единственной доступной цели и разрешает повторы', () => {
    const questions = generateTest(
      input({ candidates: [candidate({ wordId: 1 })] }),
    );

    expect(questions).toHaveLength(QUESTION_COUNT);
    expect(new Set(questions.map((question) => question.wordId))).toEqual(new Set([1]));
  });

  it('возвращает пустой список, если в категории мало вариантов', () => {
    const questions = generateTest(
      input({
        candidates: [candidate({ wordId: 1 })],
        wordsByCategory: new Map([[1, categoryWords(1, 3)]]),
      }),
    );

    expect(questions).toEqual([]);
  });

  it('детерминирован при одинаковом seed', () => {
    const left = generateTest(input({ rng: createSeededRng(42) }));
    const right = generateTest(input({ rng: createSeededRng(42) }));

    expect(left.map((question) => question.wordId)).toEqual(
      right.map((question) => question.wordId),
    );
  });
});
