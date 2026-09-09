import type { PrismaClient } from '@prisma/client';
import { CONTENT_CACHE_TTL_MS, TtlCache } from '../core/cache.js';
import { cryptoRng, pickIndex, type Rng } from '../core/random.js';
import { logger } from '../logger.js';
import type { ContentKey } from './keys.js';
import { CONTENT_KEYS } from './keys.js';
import { seedTextFor } from './seed.js';

export type TemplateParams = Record<string, string | number>;

interface ContentVariant {
  variant: number;
  text: string;
}

/** Экранирование динамических значений перед отправкой в Telegram HTML (§6). */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderTemplate(template: string, params: TemplateParams): string {
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : escapeHtml(String(value));
  });
}

export class ContentService {
  private readonly cache = new TtlCache<ContentVariant[]>(CONTENT_CACHE_TTL_MS);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly rng: Rng = cryptoRng,
  ) {}

  invalidate(key?: ContentKey): void {
    if (key) {
      this.cache.invalidate(key);
    } else {
      this.cache.clear();
    }
  }

  private async activeVariants(key: ContentKey): Promise<ContentVariant[]> {
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    try {
      const rows = await this.prisma.contentText.findMany({
        where: { key, isActive: true },
        select: { variant: true, text: true },
        orderBy: { variant: 'asc' },
      });
      this.cache.set(key, rows);
      return rows;
    } catch (error) {
      // Логируем только ключ, без содержимого сообщения (§6).
      logger.error({ key, err: error }, 'Не удалось прочитать текст, используется seed');
      return [];
    }
  }

  /**
   * Возвращает готовый текст: случайный активный вариант, исключая показанный
   * этому пользователю последним, если активных вариантов больше одного (§2).
   */
  async render(key: ContentKey, userId: number | null, params: TemplateParams = {}): Promise<string> {
    const variants = await this.activeVariants(key);

    if (variants.length === 0) {
      return renderTemplate(seedTextFor(key), params);
    }

    let candidates = variants;

    if (variants.length > 1 && userId !== null) {
      const state = await this.prisma.userContentState.findUnique({
        where: { userId_key: { userId, key } },
        select: { lastVariant: true },
      });

      if (state) {
        const filtered = variants.filter((item) => item.variant !== state.lastVariant);
        if (filtered.length > 0) {
          candidates = filtered;
        }
      }
    }

    const chosen = candidates[pickIndex(this.rng, candidates.length)];
    if (!chosen) {
      return renderTemplate(seedTextFor(key), params);
    }

    if (userId !== null) {
      await this.prisma.userContentState.upsert({
        where: { userId_key: { userId, key } },
        create: { userId, key, lastVariant: chosen.variant },
        update: { lastVariant: chosen.variant },
      });
    }

    return renderTemplate(chosen.text, params);
  }

  groupOf(key: ContentKey): string {
    return CONTENT_KEYS[key].group;
  }
}
