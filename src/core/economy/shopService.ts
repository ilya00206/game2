import type { PrismaClient } from '@prisma/client';
import { withWriteRetry } from '../../db/retry.js';
import type { Clock } from '../time.js';
import type { ConfigService, ShopItem } from './config.js';
import { purchase, type PurchaseResult } from './economyService.js';

export interface ShopServiceDeps {
  prisma: PrismaClient;
  config: ConfigService;
  clock: Clock;
}

export const SHOP_ITEM_TITLES: Record<ShopItem, string> = {
  GIFT_SMALL: '🎁 Маленький подарок',
  GIFT_SPECIAL: '💝 Особый подарок',
  SHIELD: '🛡️ Щит на стрик',
  WISH: '✨ Желание от тебя',
};

export class ShopService {
  constructor(private readonly deps: ShopServiceDeps) {}

  async prices(): Promise<Record<ShopItem, number>> {
    const economy = await this.deps.config.economy();
    return {
      GIFT_SMALL: economy.giftSmallPrice,
      GIFT_SPECIAL: economy.giftSpecialPrice,
      SHIELD: economy.shieldPrice,
      WISH: economy.wishPrice,
    };
  }

  async buy(userId: number, item: ShopItem, requestId: string): Promise<PurchaseResult> {
    const cost = await this.deps.config.priceOf(item);
    const now = this.deps.clock.now();

    return withWriteRetry(() =>
      this.deps.prisma.$transaction((tx) => purchase(tx, { userId, item, cost, requestId, now })),
    );
  }

  async state(userId: number): Promise<{ balance: number; shields: number }> {
    const user = await this.deps.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { currencyBalance: true, shields: true },
    });

    return { balance: user.currencyBalance, shields: user.shields };
  }
}
