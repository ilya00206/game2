import { configureSqlite, disconnectPrisma, prisma } from './prisma.js';
import { runSeed } from './seed.js';
import { logger } from '../logger.js';

async function main(): Promise<void> {
  await configureSqlite();
  await runSeed(prisma);
}

main()
  .catch((error) => {
    logger.error({ err: error }, 'Seed завершился с ошибкой');
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
