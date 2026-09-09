import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

const base = {
  TELEGRAM_BOT_TOKEN: 'token',
  DATABASE_URL: 'file:./dev.db',
  ADMIN_TELEGRAM_ID: '123456789',
};

describe('валидация окружения', () => {
  it('разбирает список разрешённых ID', () => {
    const env = loadEnv({ ...base, ALLOWED_TELEGRAM_IDS: '111,222' });
    expect(env.ALLOWED_TELEGRAM_IDS).toEqual([111n, 222n]);
  });

  it('по умолчанию отключает event log', () => {
    expect(loadEnv({ ...base }).EVENT_LOG_ENABLED).toBe(false);
  });

  it('разрешает пустой whitelist вне production', () => {
    const env = loadEnv({ ...base, NODE_ENV: 'development', ALLOWED_TELEGRAM_IDS: '' });
    expect(env.ALLOWED_TELEGRAM_IDS).toEqual([]);
  });

  it('запрещает пустой whitelist в production', () => {
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'production', ALLOWED_TELEGRAM_IDS: '' }),
    ).toThrowError(/ALLOWED_TELEGRAM_IDS/);
  });

  it('требует корректный DATABASE_URL', () => {
    expect(() => loadEnv({ ...base, DATABASE_URL: 'postgres://x' })).toThrowError(/DATABASE_URL/);
  });

  it('требует числовой ADMIN_TELEGRAM_ID', () => {
    expect(() => loadEnv({ ...base, ADMIN_TELEGRAM_ID: 'abc' })).toThrowError(
      /ADMIN_TELEGRAM_ID/,
    );
  });
});
