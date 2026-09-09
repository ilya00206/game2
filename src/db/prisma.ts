import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { logger } from '../logger.js';

const BUSY_TIMEOUT_MS = 5000;

// Prisma 7 подключается к SQLite только через driver adapter.
const adapter = new PrismaBetterSqlite3({ url: env.DATABASE_URL });

// Ровно один PrismaClient на процесс (§2.2).
export const prisma = new PrismaClient({
  adapter,
  log: ['warn', 'error'],
});

export type { PrismaTransaction } from './types.js';
export { withWriteRetry } from './retry.js';

/** Включает и проверяет обязательные PRAGMA. Бросает ошибку, если режим не применился. */
export async function configureSqlite(): Promise<void> {
  await prisma.$executeRawUnsafe(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
  await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON;');

  const [journalMode] = await prisma.$queryRawUnsafe<{ journal_mode: string }[]>(
    'PRAGMA journal_mode;',
  );
  const [foreignKeys] = await prisma.$queryRawUnsafe<{ foreign_keys: number | bigint }[]>(
    'PRAGMA foreign_keys;',
  );

  const journal = journalMode?.journal_mode?.toLowerCase();
  if (journal !== 'wal') {
    throw new Error(`Ожидался journal_mode=WAL, получен "${journal ?? 'unknown'}"`);
  }
  if (Number(foreignKeys?.foreign_keys ?? 0) !== 1) {
    throw new Error('Ожидался foreign_keys=ON');
  }

  logger.info({ journalMode: journal, busyTimeoutMs: BUSY_TIMEOUT_MS }, 'SQLite настроен');
}

export async function assertDatabaseReachable(): Promise<void> {
  await prisma.$queryRawUnsafe('SELECT 1;');
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
