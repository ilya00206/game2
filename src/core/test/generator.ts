import { pickIndex, pickWeighted, type Rng } from '../random.js';
import { normalizeTranslation, type CategoryWord } from './normalize.js';
import {
  distanceSince,
  groupOf,
  isOnCooldown,
  questionWeight,
  QUESTION_COUNT,
  SLOT_PLAN,
  type SlotKind,
} from './weights.js';

export const OPTIONS_PER_QUESTION = 4;
const NO_REPEAT_IN_ROW_MIN_POOL = 2;
const MAX_REPEATS_MIN_POOL = 5;
const MAX_REPEATS_PER_TEST = 2;

export interface TestCandidate {
  wordId: number;
  categoryId: number;
  polish: string;
  russian: string;
  testCorrectCount: number;
  testWrongCount: number;
}

export interface GeneratedQuestion {
  wordId: number;
  categoryId: number;
  promptText: string;
  options: { wordId: number; label: string }[];
  correctOption: number;
}

export interface GenerateTestInput {
  candidates: TestCandidate[];
  wordsByCategory: Map<number, CategoryWord[]>;
  /** Показанные сегодня цели тестов, от старых к новым. */
  history: number[];
  rng: Rng;
  questionCount?: number;
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng.next() * (index + 1));
    const left = result[index] as T;
    const right = result[swap] as T;
    result[index] = right;
    result[swap] = left;
  }
  return result;
}

function matchesSlot(candidate: TestCandidate, slot: SlotKind): boolean {
  return slot === 'ANY' || groupOf(candidate) === slot;
}

/**
 * Выбор цели для слота: сначала кандидаты без cooldown нужной группы,
 * затем любая группа без cooldown, и лишь потом вынужденное нарушение cooldown (§4.3).
 */
function selectTarget(
  slot: SlotKind,
  candidates: TestCandidate[],
  history: number[],
  planCounts: Map<number, number>,
  categoryCounts: Map<number, number>,
  lastPicked: number | null,
  rng: Rng,
): TestCandidate | undefined {
  let allowed = candidates;

  if (candidates.length >= NO_REPEAT_IN_ROW_MIN_POOL && lastPicked !== null) {
    const filtered = allowed.filter((candidate) => candidate.wordId !== lastPicked);
    if (filtered.length > 0) {
      allowed = filtered;
    }
  }

  if (candidates.length >= MAX_REPEATS_MIN_POOL) {
    const filtered = allowed.filter(
      (candidate) => (planCounts.get(candidate.wordId) ?? 0) < MAX_REPEATS_PER_TEST,
    );
    if (filtered.length > 0) {
      allowed = filtered;
    }
  }

  const fresh = allowed.filter(
    (candidate) => !isOnCooldown(distanceSince(history, candidate.wordId)),
  );

  let pool = fresh.filter((candidate) => matchesSlot(candidate, slot));
  if (pool.length === 0) {
    pool = fresh;
  }

  if (pool.length === 0) {
    // Все на cooldown: берём слово с наибольшим расстоянием от прошлого показа.
    const distances = allowed.map((candidate) => ({
      candidate,
      distance: distanceSince(history, candidate.wordId) ?? Number.MAX_SAFE_INTEGER,
    }));
    const maxDistance = Math.max(...distances.map((entry) => entry.distance));
    pool = distances
      .filter((entry) => entry.distance === maxDistance)
      .map((entry) => entry.candidate);
  }

  if (pool.length === 0) {
    return undefined;
  }

  const categories = [...new Set(pool.map((candidate) => candidate.categoryId))];
  const minUsed = Math.min(...categories.map((id) => categoryCounts.get(id) ?? 0));
  const leastUsed = categories.filter((id) => (categoryCounts.get(id) ?? 0) === minUsed);
  const categoryId = leastUsed[pickIndex(rng, leastUsed.length)];

  const withinCategory = pool.filter((candidate) => candidate.categoryId === categoryId);

  return pickWeighted(rng, withinCategory, (candidate) =>
    questionWeight(candidate, distanceSince(history, candidate.wordId)),
  );
}

function buildOptions(
  target: TestCandidate,
  wordsByCategory: Map<number, CategoryWord[]>,
  rng: Rng,
): { options: { wordId: number; label: string }[]; correctOption: number } | null {
  const used = new Set([normalizeTranslation(target.russian)]);
  const available = (wordsByCategory.get(target.categoryId) ?? []).filter((word) => {
    if (word.wordId === target.wordId) {
      return false;
    }
    return !used.has(normalizeTranslation(word.russian));
  });

  const distractors: CategoryWord[] = [];
  const pool = [...available];

  while (distractors.length < OPTIONS_PER_QUESTION - 1 && pool.length > 0) {
    const index = pickIndex(rng, pool.length);
    const [picked] = pool.splice(index, 1);
    if (!picked) {
      break;
    }
    const normalized = normalizeTranslation(picked.russian);
    if (used.has(normalized)) {
      continue;
    }
    used.add(normalized);
    distractors.push(picked);
  }

  if (distractors.length < OPTIONS_PER_QUESTION - 1) {
    return null;
  }

  const options = shuffle(
    [
      { wordId: target.wordId, label: target.russian },
      ...distractors.map((word) => ({ wordId: word.wordId, label: word.russian })),
    ],
    rng,
  );

  return {
    options,
    correctOption: options.findIndex((option) => option.wordId === target.wordId),
  };
}

/** Все вопросы строятся заранее; порядок и снимки переводов фиксируются (§4.3). */
export function generateTest(input: GenerateTestInput): GeneratedQuestion[] {
  const total = input.questionCount ?? QUESTION_COUNT;
  const questions: GeneratedQuestion[] = [];

  const history = [...input.history];
  const planCounts = new Map<number, number>();
  const categoryCounts = new Map<number, number>();
  let lastPicked: number | null = null;

  for (let index = 0; index < total; index += 1) {
    const slot = SLOT_PLAN[index % SLOT_PLAN.length] as SlotKind;

    const target = selectTarget(
      slot,
      input.candidates,
      history,
      planCounts,
      categoryCounts,
      lastPicked,
      input.rng,
    );

    if (!target) {
      break;
    }

    const built = buildOptions(target, input.wordsByCategory, input.rng);
    if (!built) {
      break;
    }

    questions.push({
      wordId: target.wordId,
      categoryId: target.categoryId,
      promptText: target.polish,
      options: built.options,
      correctOption: built.correctOption,
    });

    history.push(target.wordId);
    planCounts.set(target.wordId, (planCounts.get(target.wordId) ?? 0) + 1);
    categoryCounts.set(target.categoryId, (categoryCounts.get(target.categoryId) ?? 0) + 1);
    lastPicked = target.wordId;
  }

  return questions;
}
