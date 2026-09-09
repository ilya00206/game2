import { ALLOWED_UPDATES, createBot } from './bot/index.js';
import { CALLBACK } from './bot/keyboards.js';
import { env } from './config/env.js';
import { assertDatabaseReachable, configureSqlite, disconnectPrisma, prisma } from './db/prisma.js';
import { runSeed } from './db/seed.js';
import { logger } from './logger.js';
import { schedulerRegistry } from './scheduler/registry.js';
import { startScheduler } from './scheduler/index.js';
import { createServices } from './services.js';
import { InlineKeyboard } from 'grammy';

async function main(): Promise<void> {
  await assertDatabaseReachable();
  await configureSqlite();
  await runSeed(prisma);
  await schedulerRegistry.load(prisma);

  const services = createServices();
  const bot = createBot(services);

  const startKeyboard = new InlineKeyboard().text('▶️ Начать обучение', CALLBACK.menuLearn);
  const scheduler = startScheduler(services, async (telegramId, text) => {
    await bot.api.sendMessage(telegramId.toString(), text, {
      parse_mode: 'HTML',
      reply_markup: startKeyboard,
    });
  });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'Завершение работы');

    scheduler.stop();
    await bot.stop().catch((error) => logger.error({ err: error }, 'Ошибка остановки бота'));
    await disconnectPrisma().catch((error) => logger.error({ err: error }, 'Ошибка закрытия БД'));
    process.exit(0);
  };

  process.once('SIGINT', (signal) => void shutdown(signal));
  process.once('SIGTERM', (signal) => void shutdown(signal));

  logger.info(
    { env: env.NODE_ENV, eventLog: env.EVENT_LOG_ENABLED, users: schedulerRegistry.size() },
    'Запуск long polling',
  );

  await bot.start({ allowed_updates: [...ALLOWED_UPDATES] });
}

main().catch(async (error) => {
  logger.fatal({ err: error }, 'Критическая ошибка запуска');
  await disconnectPrisma().catch(() => undefined);
  process.exit(1);
});
