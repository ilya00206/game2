import type { ContentKey } from '../content/keys.js';

export type PendingInput =
  | { kind: 'ADD_WORD'; categoryId: number }
  | { kind: 'NEW_CATEGORY' }
  | { kind: 'ADMIN_GRANT'; targetUserId: number }
  | { kind: 'ADMIN_STREAK'; targetUserId: number }
  | { kind: 'ADMIN_CURRENCY' }
  | { kind: 'ADMIN_ECONOMY'; field: string }
  | { kind: 'ADMIN_TEXT_EDIT'; key: ContentKey; variant: number }
  | { kind: 'ADMIN_TEXT_ADD'; key: ContentKey }
  | { kind: 'ADMIN_WORD_OF_DAY' }
  | { kind: 'ADMIN_MESSAGE'; targetUserId: number };

/** Разобранное действие ждёт подтверждения; requestId берётся с кнопки подтверждения. */
export type PendingConfirm =
  | { kind: 'ADMIN_GRANT'; targetUserId: number; amount: number; reason: string }
  | { kind: 'ADMIN_STREAK'; targetUserId: number; value: number; reason: string }
  | { kind: 'ADMIN_MESSAGE'; targetUserId: number; text: string };

const TTL_MS = 10 * 60 * 1000;

/**
 * Незавершённый ввод хранится только в памяти: одна реплика, и после рестарта
 * достаточно начать заново — прогресс и сессии от этого не зависят.
 */
export class PendingInputStore {
  private readonly entries = new Map<number, { value: PendingInput; expiresAt: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  set(userId: number, value: PendingInput): void {
    this.entries.set(userId, { value, expiresAt: this.now() + TTL_MS });
  }

  get(userId: number): PendingInput | undefined {
    const entry = this.entries.get(userId);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(userId);
      return undefined;
    }
    return entry.value;
  }

  clear(userId: number): void {
    this.entries.delete(userId);
  }
}

export const pendingInput = new PendingInputStore();

class PendingConfirmStore {
  private readonly entries = new Map<number, { value: PendingConfirm; expiresAt: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  set(userId: number, value: PendingConfirm): void {
    this.entries.set(userId, { value, expiresAt: this.now() + TTL_MS });
  }

  get(userId: number): PendingConfirm | undefined {
    const entry = this.entries.get(userId);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(userId);
      return undefined;
    }
    return entry.value;
  }

  clear(userId: number): void {
    this.entries.delete(userId);
  }
}

export const pendingConfirm = new PendingConfirmStore();
