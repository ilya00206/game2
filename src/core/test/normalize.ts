/** trim + нижний регистр + схлопывание пробелов (§4.3). */
export function normalizeTranslation(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export const MIN_CATEGORY_WORDS = 4;

export interface CategoryWord {
  wordId: number;
  russian: string;
}

/** Категория участвует в тесте только при 4 различных нормализованных переводах. */
export function isCategoryEligible(words: CategoryWord[]): boolean {
  const distinct = new Set(words.map((word) => normalizeTranslation(word.russian)));
  return distinct.size >= MIN_CATEGORY_WORDS;
}
