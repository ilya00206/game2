import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Интеграционные тесты поднимают отдельную SQLite-базу на каждый случай.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
