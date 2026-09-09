import type { PrismaTransaction } from '../../db/types.js';
import type { DomainEvent, EventSink } from './types.js';

/** Первая версия: события формируются, но не пишутся — 0 SQL-запросов (§5). */
export class NoopEventSink implements EventSink {
  async record(_tx: PrismaTransaction, _events: DomainEvent[]): Promise<void> {
    // намеренно пусто
  }
}

/** Готов к включению через EVENT_LOG_ENABLED; пишет события пакетно. */
export class PrismaEventSink implements EventSink {
  async record(tx: PrismaTransaction, events: DomainEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    await tx.event.createMany({
      data: events.map((event) => ({
        idempotencyKey: event.idempotencyKey,
        userId: event.userId,
        eventType: event.eventType,
        sessionId: event.sessionId ?? null,
        cardId: event.cardId ?? null,
        answer: event.answer ?? null,
        responseTimeMs: event.responseTimeMs ?? null,
        timestamp: event.timestamp,
      })),
    });
  }
}

export function createEventSink(eventLogEnabled: boolean): EventSink {
  return eventLogEnabled ? new PrismaEventSink() : new NoopEventSink();
}
