import type { PrismaClient } from '@prisma/client';
import { CONTENT_CACHE_TTL_MS, TtlCache } from '../cache.js';
import type { CurrencyForms } from './currency.js';

export interface EconomySettings {
  flashcardReward: number;
  testReward: number;
  dailyLearningLimit: number;
  giftSmallPrice: number;
  giftSpecialPrice: number;
  shieldPrice: number;
  wishPrice: number;
}

export const SHOP_ITEMS = ['GIFT_SMALL', 'GIFT_SPECIAL', 'SHIELD', 'WISH'] as const;
export type ShopItem = (typeof SHOP_ITEMS)[number];

export const SINGLETON_ID = 1;

const CURRENCY_CACHE_KEY = 'currency';
const ECONOMY_CACHE_KEY = 'economy';

/** Синглтон-конфиги валюты и экономики с TTL-кэшем и немедленной инвалидацией (§4.1). */
export class ConfigService {
  private readonly currencyCache = new TtlCache<CurrencyForms>(CONTENT_CACHE_TTL_MS);
  private readonly economyCache = new TtlCache<EconomySettings>(CONTENT_CACHE_TTL_MS);

  constructor(private readonly prisma: PrismaClient) {}

  async currency(): Promise<CurrencyForms> {
    const cached = this.currencyCache.get(CURRENCY_CACHE_KEY);
    if (cached) {
      return cached;
    }

    const row = await this.prisma.currencyConfig.findUnique({
      where: { id: SINGLETON_ID },
      select: { icon: true, nameOne: true, nameFew: true, nameMany: true },
    });

    const value: CurrencyForms = row ?? {
      icon: '☀️',
      nameOne: 'солнышко',
      nameFew: 'солнышка',
      nameMany: 'солнышек',
    };

    this.currencyCache.set(CURRENCY_CACHE_KEY, value);
    return value;
  }

  async economy(): Promise<EconomySettings> {
    const cached = this.economyCache.get(ECONOMY_CACHE_KEY);
    if (cached) {
      return cached;
    }

    const row = await this.prisma.economyConfig.findUnique({
      where: { id: SINGLETON_ID },
      select: {
        flashcardReward: true,
        testReward: true,
        dailyLearningLimit: true,
        giftSmallPrice: true,
        giftSpecialPrice: true,
        shieldPrice: true,
        wishPrice: true,
      },
    });

    const value: EconomySettings = row ?? {
      flashcardReward: 5,
      testReward: 10,
      dailyLearningLimit: 20,
      giftSmallPrice: 120,
      giftSpecialPrice: 350,
      shieldPrice: 25,
      wishPrice: 500,
    };

    this.economyCache.set(ECONOMY_CACHE_KEY, value);
    return value;
  }

  async priceOf(item: ShopItem): Promise<number> {
    const economy = await this.economy();
    switch (item) {
      case 'GIFT_SMALL':
        return economy.giftSmallPrice;
      case 'GIFT_SPECIAL':
        return economy.giftSpecialPrice;
      case 'SHIELD':
        return economy.shieldPrice;
      case 'WISH':
        return economy.wishPrice;
    }
  }

  invalidateCurrency(): void {
    this.currencyCache.clear();
  }

  invalidateEconomy(): void {
    this.economyCache.clear();
  }
}
