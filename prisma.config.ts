import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// В Prisma 7 URL подключения задаётся здесь, а не в schema.prisma.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx src/db/seedCli.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
