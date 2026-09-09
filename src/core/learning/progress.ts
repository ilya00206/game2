export type AnswerKind = 'KNOW' | 'UNKNOWN';

export const LEVEL_NEW = 0;
export const LEVEL_UNFAMILIAR = 1;
export const LEVEL_FAMILIAR = 2;

export const REPEAT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const SCORE_MAX = 5;
const SCORE_MIN = -5;
const SCORE_UP = 1;
const SCORE_DOWN = 1.5;

export interface WordProgress {
  timesSeen: number;
  timesKnown: number;
  timesUnknown: number;
  currentScore: number;
  currentLevel: number;
  lastAnswer: AnswerKind | null;
  lastAnswerAt: Date | null;
  consecutiveKnown: number;
  consecutiveUnknown: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  firstLearnedAt: Date | null;
  timesSeenToLearn: number | null;
  nextReviewAt: Date | null;
}

export function emptyProgress(): WordProgress {
  return {
    timesSeen: 0,
    timesKnown: 0,
    timesUnknown: 0,
    currentScore: 0,
    currentLevel: LEVEL_NEW,
    lastAnswer: null,
    lastAnswerAt: null,
    consecutiveKnown: 0,
    consecutiveUnknown: 0,
    firstSeenAt: null,
    lastSeenAt: null,
    firstLearnedAt: null,
    timesSeenToLearn: null,
    nextReviewAt: null,
  };
}

/** Правила применяются по первому подошедшему, строго в этом порядке (§4.2). */
export function computeLevel(state: Pick<WordProgress, 'timesSeen' | 'consecutiveKnown' | 'currentScore'>): number {
  if (state.timesSeen === 0) {
    return LEVEL_NEW;
  }
  if (state.consecutiveKnown >= 3 && state.currentScore >= 2) {
    return LEVEL_FAMILIAR;
  }
  return LEVEL_UNFAMILIAR;
}

export function clampScore(score: number): number {
  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, score));
}

/**
 * Чистый переход прогресса слова после ответа.
 * Повторный «Знаю» сразу после «Не знаю» ставит слову суточный кулдаун (§4.2).
 */
export function applyAnswer(previous: WordProgress, answer: AnswerKind, now: Date): WordProgress {
  const wasUnknown = previous.lastAnswer === 'UNKNOWN';

  const next: WordProgress = {
    ...previous,
    timesSeen: previous.timesSeen + 1,
    lastAnswer: answer,
    lastAnswerAt: now,
    firstSeenAt: previous.firstSeenAt ?? now,
    lastSeenAt: now,
  };

  if (answer === 'KNOW') {
    next.timesKnown = previous.timesKnown + 1;
    next.consecutiveKnown = previous.consecutiveKnown + 1;
    next.consecutiveUnknown = 0;
    next.currentScore = clampScore(previous.currentScore + SCORE_UP);
  } else {
    next.timesUnknown = previous.timesUnknown + 1;
    next.consecutiveUnknown = previous.consecutiveUnknown + 1;
    next.consecutiveKnown = 0;
    next.currentScore = clampScore(previous.currentScore - SCORE_DOWN);
  }

  next.currentLevel = computeLevel(next);

  if (wasUnknown && answer === 'KNOW') {
    next.nextReviewAt = new Date(now.getTime() + REPEAT_COOLDOWN_MS);
  }

  // Фиксируется один раз и не очищается при последующем снижении уровня (§11.1).
  if (next.currentLevel === LEVEL_FAMILIAR && previous.firstLearnedAt === null) {
    next.firstLearnedAt = now;
    next.timesSeenToLearn = next.timesSeen;
  }

  return next;
}

export function isOnCooldown(nextReviewAt: Date | null, now: Date): boolean {
  return nextReviewAt !== null && nextReviewAt.getTime() > now.getTime();
}
