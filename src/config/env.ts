import 'dotenv/config';
import { z } from 'zod';

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

const telegramIdList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  )
  .pipe(z.array(z.string().regex(/^\d+$/, 'Telegram ID должен быть целым числом')))
  .transform((ids) => ids.map((id) => BigInt(id)));

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(logLevels).default('info'),
    TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN обязателен'),
    DATABASE_URL: z.string().startsWith('file:', 'DATABASE_URL должен быть file:-путём SQLite'),
    ADMIN_TELEGRAM_ID: z
      .string()
      .regex(/^\d+$/, 'ADMIN_TELEGRAM_ID должен быть целым числом')
      .transform((value) => BigInt(value)),
    ALLOWED_TELEGRAM_IDS: telegramIdList,
    EVENT_LOG_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && value.ALLOWED_TELEGRAM_IDS.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['ALLOWED_TELEGRAM_IDS'],
        message: 'В production список разрешённых Telegram ID не может быть пустым',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Некорректная конфигурация окружения — ${details}`);
  }

  return parsed.data;
}

export const env = loadEnv();
