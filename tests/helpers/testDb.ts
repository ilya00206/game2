import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');

/** Комментарии убираются до разбиения: в них встречается точка с запятой. */
function migrationStatements(): string[] {
  const sql = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'))
    .join('\n');

  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

export interface TestDb {
  prisma: PrismaClient;
  cleanup: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const directory = mkdtempSync(join(tmpdir(), 'kartochki-'));
  const prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: join(directory, 'test.db') }),
  });

  for (const statement of migrationStatements()) {
    await prisma.$executeRawUnsafe(statement);
  }

  return {
    prisma,
    cleanup: async () => {
      await prisma.$disconnect();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export async function seedCategory(
  prisma: PrismaClient,
  name: string,
  wordCount: number,
): Promise<number> {
  const category = await prisma.category.create({
    data: { name, ownerId: null },
    select: { id: true },
  });

  await prisma.word.createMany({
    data: Array.from({ length: wordCount }, (_, index) => ({
      categoryId: category.id,
      polish: `${name}-pl-${index}`,
      russian: `${name}-ru-${index}`,
      ownerId: null,
    })),
  });

  return category.id;
}
