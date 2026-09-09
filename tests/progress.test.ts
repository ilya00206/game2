import { describe, expect, it } from 'vitest';
import {
  applyAnswer,
  computeLevel,
  emptyProgress,
  isOnCooldown,
  LEVEL_FAMILIAR,
  LEVEL_NEW,
  LEVEL_UNFAMILIAR,
  REPEAT_COOLDOWN_MS,
} from '../src/core/learning/progress.js';

const NOW = new Date('2026-09-09T10:00:00.000Z');

function knowTimes(count: number) {
  let progress = emptyProgress();
  for (let index = 0; index < count; index += 1) {
    progress = applyAnswer(progress, 'KNOW', NOW);
  }
  return progress;
}

describe('прогресс слова', () => {
  it('новое слово имеет уровень 0', () => {
    expect(computeLevel({ timesSeen: 0, consecutiveKnown: 9, currentScore: 9 })).toBe(LEVEL_NEW);
  });

  it('становится знакомым только при 3 подряд «Знаю» и score >= 2', () => {
    expect(knowTimes(2).currentLevel).toBe(LEVEL_UNFAMILIAR);
    expect(knowTimes(3).currentLevel).toBe(LEVEL_FAMILIAR);
  });

  it('«Знаю» увеличивает счётчики и ограничивает score сверху', () => {
    const progress = knowTimes(7);
    expect(progress.timesSeen).toBe(7);
    expect(progress.timesKnown).toBe(7);
    expect(progress.currentScore).toBe(5);
    expect(progress.consecutiveUnknown).toBe(0);
  });

  it('«Не знаю» снижает score на 1.5 и обнуляет серию «Знаю»', () => {
    const progress = applyAnswer(knowTimes(3), 'UNKNOWN', NOW);
    expect(progress.currentScore).toBe(1.5);
    expect(progress.consecutiveKnown).toBe(0);
    expect(progress.consecutiveUnknown).toBe(1);
    expect(progress.currentLevel).toBe(LEVEL_UNFAMILIAR);
  });

  it('ограничивает score снизу значением -5', () => {
    let progress = emptyProgress();
    for (let index = 0; index < 10; index += 1) {
      progress = applyAnswer(progress, 'UNKNOWN', NOW);
    }
    expect(progress.currentScore).toBe(-5);
  });

  it('ставит суточный кулдаун при «Знаю» сразу после «Не знаю»', () => {
    const afterUnknown = applyAnswer(emptyProgress(), 'UNKNOWN', NOW);
    const repeated = applyAnswer(afterUnknown, 'KNOW', NOW);

    expect(repeated.nextReviewAt?.getTime()).toBe(NOW.getTime() + REPEAT_COOLDOWN_MS);
    expect(isOnCooldown(repeated.nextReviewAt, NOW)).toBe(true);
    expect(isOnCooldown(repeated.nextReviewAt, new Date(NOW.getTime() + REPEAT_COOLDOWN_MS))).toBe(
      false,
    );
  });

  it('не ставит кулдаун при обычном «Знаю»', () => {
    expect(applyAnswer(emptyProgress(), 'KNOW', NOW).nextReviewAt).toBeNull();
  });

  it('фиксирует момент изучения один раз и не сбрасывает его', () => {
    const learned = knowTimes(3);
    expect(learned.firstLearnedAt).toEqual(NOW);
    expect(learned.timesSeenToLearn).toBe(3);

    const later = new Date(NOW.getTime() + 60_000);
    const degraded = applyAnswer(learned, 'UNKNOWN', later);
    expect(degraded.currentLevel).toBe(LEVEL_UNFAMILIAR);
    expect(degraded.firstLearnedAt).toEqual(NOW);
    expect(degraded.timesSeenToLearn).toBe(3);
  });
});
