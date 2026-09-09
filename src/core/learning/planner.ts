import { pickWeighted, type Rng } from '../random.js';
import { isOnCooldown, LEVEL_FAMILIAR, LEVEL_NEW, LEVEL_UNFAMILIAR } from './progress.js';

export const MAX_SESSION_CARDS = 10;

export interface PlanCandidate {
  wordId: number;
  currentLevel: number;
  timesUnknown: number;
  consecutiveUnknown: number;
  nextReviewAt: Date | null;
}

/** base + штрафы за трудность; новые и трудные слова встречаются чаще (§4.2). */
export function wordWeight(candidate: PlanCandidate): number {
  const base =
    candidate.currentLevel === LEVEL_NEW ? 6 : candidate.currentLevel === LEVEL_UNFAMILIAR ? 3 : 1;

  return (
    base +
    Math.min(candidate.timesUnknown, 5) * 0.4 +
    Math.min(candidate.consecutiveUnknown, 3) * 0.6
  );
}

/**
 * Взвешенная выборка без повторов. Фильтр по nextReviewAt мягкий: если слов
 * без кулдауна не хватает, слоты добираются словами на кулдауне в порядке
 * возрастания nextReviewAt (§4.2).
 */
export function buildSessionPlan(
  candidates: PlanCandidate[],
  rng: Rng,
  now: Date,
  limit: number = MAX_SESSION_CARDS,
): number[] {
  const available = [...candidates.filter((item) => !isOnCooldown(item.nextReviewAt, now))];
  const cooling = candidates
    .filter((item) => isOnCooldown(item.nextReviewAt, now))
    .sort((left, right) => (left.nextReviewAt?.getTime() ?? 0) - (right.nextReviewAt?.getTime() ?? 0));

  const plan: number[] = [];

  while (plan.length < limit && available.length > 0) {
    const picked = pickWeighted(rng, available, wordWeight);
    if (!picked) {
      break;
    }
    plan.push(picked.wordId);
    available.splice(available.indexOf(picked), 1);
  }

  for (const candidate of cooling) {
    if (plan.length >= limit) {
      break;
    }
    plan.push(candidate.wordId);
  }

  return plan;
}

export interface CategorySummaryInput {
  currentLevel: number;
  lastAnswer: string | null;
  timesKnown: number;
}

export interface CategorySummary {
  total: number;
  passed: number;
  learned: number;
  remaining: number;
  toRepeat: number;
}

/** Саммари считается по всем активным словам и кулдаун не учитывает (§4.2.1). */
export function summarizeCategory(words: CategorySummaryInput[]): CategorySummary {
  const total = words.length;
  const passed = words.filter((word) => word.timesKnown > 0).length;
  const learned = words.filter((word) => word.currentLevel === LEVEL_FAMILIAR).length;
  const toRepeat = words.filter((word) => word.lastAnswer === 'UNKNOWN').length;

  return { total, passed, learned, remaining: total - learned, toRepeat };
}
