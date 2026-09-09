/** Реестр стабильных ключей и допустимых placeholders (§6). */
export const CONTENT_GROUPS = [
  'UI',
  'REMINDER',
  'PRAISE',
  'STREAK',
  'SURPRISE',
  'WORD_OF_DAY',
] as const;

export type ContentGroup = (typeof CONTENT_GROUPS)[number];

export interface ContentKeyDefinition {
  group: ContentGroup;
  placeholders: readonly string[];
}

export const CONTENT_KEYS = {
  'ui.menu.title': { group: 'UI', placeholders: [] },
  'ui.session.no_words': { group: 'UI', placeholders: [] },
  'ui.session.limit_reached': { group: 'UI', placeholders: ['currency'] },
  'ui.test.unavailable': { group: 'UI', placeholders: [] },
  'reminder.morning': { group: 'REMINDER', placeholders: ['streak'] },
  'reminder.evening': { group: 'REMINDER', placeholders: ['streak'] },
  'praise.session_finished': { group: 'PRAISE', placeholders: [] },
  'praise.test_finished': { group: 'PRAISE', placeholders: [] },
  'praise.session_perfect': { group: 'PRAISE', placeholders: [] },
  'streak.current': { group: 'STREAK', placeholders: ['streak'] },
  'streak.milestone': { group: 'STREAK', placeholders: ['streak'] },
  'streak.record': { group: 'STREAK', placeholders: ['streak'] },
  'streak.lost': { group: 'STREAK', placeholders: [] },
  'streak.shield_used': { group: 'STREAK', placeholders: [] },
  'streak.early_offer': { group: 'STREAK', placeholders: [] },
  'streak.early_activated': { group: 'STREAK', placeholders: [] },
  'surprise.random': { group: 'SURPRISE', placeholders: ['amount', 'currency'] },
  'word_of_day.intro': { group: 'WORD_OF_DAY', placeholders: [] },
} as const satisfies Record<string, ContentKeyDefinition>;

export type ContentKey = keyof typeof CONTENT_KEYS;

export function isContentKey(value: string): value is ContentKey {
  return Object.hasOwn(CONTENT_KEYS, value);
}

export function allowedPlaceholders(key: ContentKey): readonly string[] {
  return CONTENT_KEYS[key].placeholders;
}

const PLACEHOLDER_PATTERN = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

export function extractPlaceholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1] as string);
}

/** Неизвестный или пропущенный placeholder запрещает сохранение текста (§6). */
export function validateTemplate(key: ContentKey, text: string): string[] {
  const allowed = new Set(allowedPlaceholders(key));
  const used = new Set(extractPlaceholders(text));
  const errors: string[] = [];

  for (const placeholder of used) {
    if (!allowed.has(placeholder)) {
      errors.push(`неизвестный placeholder {${placeholder}}`);
    }
  }

  if (text.trim().length === 0) {
    errors.push('пустой текст запрещён');
  }

  return errors;
}
