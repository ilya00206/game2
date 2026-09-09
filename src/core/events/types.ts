import type { PrismaTransaction } from '../../db/types.js';

export const EVENT_TYPES = [
  'CARD_KNOWN',
  'CARD_UNKNOWN',
  'TEST_CORRECT',
  'TEST_WRONG',
  'SESSION_FINISHED',
  'SESSION_ABANDONED',
  'SHIELD_USED',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface DomainEvent {
  eventType: EventType;
  idempotencyKey: string;
  userId: number;
  sessionId?: number | null;
  cardId?: number | null;
  answer?: string | null;
  responseTimeMs?: number | null;
  timestamp: Date;
}

/** Ключ строится как {EVENT_TYPE}:{scope} и формируется даже при NoopEventSink (§5.1). */
export function sessionEventKey(
  eventType: Extract<EventType, 'SESSION_FINISHED' | 'SESSION_ABANDONED'>,
  sessionId: number,
): string {
  return `${eventType}:${sessionId}`;
}

export function cardEventKey(
  eventType: Extract<EventType, 'CARD_KNOWN' | 'CARD_UNKNOWN' | 'TEST_CORRECT' | 'TEST_WRONG'>,
  cardId: number,
): string {
  return `${eventType}:${cardId}`;
}

export function shieldEventKey(userId: number, localDate: string): string {
  return `SHIELD_USED:${userId}:${localDate}`;
}

/** Записывает статистические события в той же транзакции, что и доменное изменение. */
export interface EventSink {
  record(tx: PrismaTransaction, events: DomainEvent[]): Promise<void>;
}
