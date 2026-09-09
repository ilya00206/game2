import { z } from 'zod';

export const SESSION_MODES = ['FLASHCARDS', 'TEST'] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

export const SESSION_STATUSES = ['ACTIVE', 'COMPLETED', 'ABANDONED'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const DIRECTIONS = ['PL_RU', 'RU_PL'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const CARD_ANSWERS = ['KNOW', 'UNKNOWN', 'TEST_OPTION'] as const;
export type CardAnswer = (typeof CARD_ANSWERS)[number];

/** Значения, которые SQLite хранит как TEXT, проверяются здесь на границах (§9). */
export const sessionModeSchema = z.enum(SESSION_MODES);
export const sessionStatusSchema = z.enum(SESSION_STATUSES);
export const directionSchema = z.enum(DIRECTIONS);
export const cardAnswerSchema = z.enum(CARD_ANSWERS);

export const testOptionSchema = z.object({
  wordId: z.number().int().positive(),
  label: z.string().min(1),
});

/** Ровно 4 варианта; порядок соответствует кнопкам (§4.3). */
export const testOptionsSchema = z.array(testOptionSchema).length(4);

export type TestOption = z.infer<typeof testOptionSchema>;

export function serializeOptions(options: TestOption[]): string {
  return JSON.stringify(testOptionsSchema.parse(options));
}

export function parseOptions(raw: string | null): TestOption[] | null {
  if (raw === null) {
    return null;
  }
  return testOptionsSchema.parse(JSON.parse(raw));
}
