import pino from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';
const isProduction = process.env.NODE_ENV === 'production';

// Секреты, тексты личных сообщений и callback payload логировать запрещено (§11).
export const logger = pino({
  level,
  base: undefined,
  redact: {
    paths: ['token', 'TELEGRAM_BOT_TOKEN', '*.token', 'text', '*.text'],
    censor: '[redacted]',
  },
  ...(isProduction ? {} : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
});
