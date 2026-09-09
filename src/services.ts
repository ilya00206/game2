import { ContentService } from './content/service.js';
import { AdminService } from './core/admin/adminService.js';
import { ConfigService } from './core/economy/config.js';
import { ShopService } from './core/economy/shopService.js';
import { createEventSink } from './core/events/sink.js';
import type { EventSink } from './core/events/types.js';
import { SessionService } from './core/learning/sessionService.js';
import { ReminderService } from './core/reminders/reminderService.js';
import { StatsService } from './core/stats/statsService.js';
import { StreakManager } from './core/streak/streakManager.js';
import { VocabularyService } from './core/vocabulary/vocabularyService.js';
import { cryptoRng, type Rng } from './core/random.js';
import { systemClock, type Clock } from './core/time.js';
import { env } from './config/env.js';
import { prisma } from './db/prisma.js';
import type { PrismaClient } from '@prisma/client';

/** Контейнер зависимостей: Clock и RNG внедряются ради тестируемости (§11). */
export interface Services {
  prisma: PrismaClient;
  content: ContentService;
  config: ConfigService;
  events: EventSink;
  sessions: SessionService;
  streaks: StreakManager;
  shop: ShopService;
  reminders: ReminderService;
  vocabulary: VocabularyService;
  stats: StatsService;
  admin: AdminService;
  clock: Clock;
  rng: Rng;
  adminTelegramId: bigint;
}

export function createServices(overrides: Partial<Services> = {}): Services {
  const client = overrides.prisma ?? prisma;
  const clock = overrides.clock ?? systemClock;
  const rng = overrides.rng ?? cryptoRng;
  const events = overrides.events ?? createEventSink(env.EVENT_LOG_ENABLED);
  const config = overrides.config ?? new ConfigService(client);
  const content = overrides.content ?? new ContentService(client, rng);

  return {
    prisma: client,
    content,
    config,
    events,
    sessions:
      overrides.sessions ?? new SessionService({ prisma: client, events, config, clock, rng }),
    streaks: overrides.streaks ?? new StreakManager({ prisma: client, events, clock }),
    shop: overrides.shop ?? new ShopService({ prisma: client, config, clock }),
    reminders: overrides.reminders ?? new ReminderService({ prisma: client, content }),
    vocabulary: overrides.vocabulary ?? new VocabularyService(client),
    stats: overrides.stats ?? new StatsService({ prisma: client, clock }),
    admin: overrides.admin ?? new AdminService(client),
    clock,
    rng,
    adminTelegramId: overrides.adminTelegramId ?? env.ADMIN_TELEGRAM_ID,
  };
}
