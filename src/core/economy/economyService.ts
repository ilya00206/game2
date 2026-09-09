import type { PrismaTransaction } from '../../db/types.js';
import type { Rng } from '../random.js';
import { localDayRange } from '../time.js';
import type { EconomySettings, ShopItem } from './config.js';

export const REWARD_REASONS = ['SESSION_REWARD', 'TEST_REWARD'] as const;

export const SURPRISE_PROBABILITY = 0.1;
export const SURPRISE_MIN = 1;
export const SURPRISE_MAX = 3;

export type RewardResult =
  | { granted: true; amount: number; balanceAfter: number }
  | { granted: false; reason: 'ALREADY_REWARDED' | 'LIMIT_REACHED' };

export interface GrantRewardParams {
  userId: number;
  sessionId: number;
  mode: 'FLASHCARDS' | 'TEST';
  now: Date;
  timezone: string;
  localDate: string;
  economy: EconomySettings;
}

/** Награда неделима: не помещается в дневной лимит — не начисляется вовсе (§8). */
export async function grantSessionReward(
  tx: PrismaTransaction,
  params: GrantRewardParams,
): Promise<RewardResult> {
  const idempotencyKey = `SESSION_REWARD:${params.sessionId}`;

  const existing = await tx.currencyTransaction.findUnique({
    where: { idempotencyKey },
    select: { amount: true, balanceAfter: true },
  });

  if (existing) {
    return { granted: false, reason: 'ALREADY_REWARDED' };
  }

  const amount =
    params.mode === 'TEST' ? params.economy.testReward : params.economy.flashcardReward;

  const { start, end } = localDayRange(params.localDate, params.timezone);
  const earnedToday = await tx.currencyTransaction.aggregate({
    where: {
      userId: params.userId,
      reason: { in: [...REWARD_REASONS] },
      createdAt: { gte: start, lt: end },
    },
    _sum: { amount: true },
  });

  const alreadyEarned = earnedToday._sum.amount ?? 0;
  if (alreadyEarned + amount > params.economy.dailyLearningLimit) {
    return { granted: false, reason: 'LIMIT_REACHED' };
  }

  const user = await tx.user.update({
    where: { id: params.userId },
    data: { currencyBalance: { increment: amount } },
    select: { currencyBalance: true },
  });

  await tx.currencyTransaction.create({
    data: {
      idempotencyKey,
      userId: params.userId,
      amount,
      reason: params.mode === 'TEST' ? 'TEST_REWARD' : 'SESSION_REWARD',
      balanceAfter: user.currencyBalance,
      sessionId: params.sessionId,
      createdAt: params.now,
    },
  });

  await tx.session.update({
    where: { id: params.sessionId },
    data: { rewardedAt: params.now },
  });

  return { granted: true, amount, balanceAfter: user.currencyBalance };
}

export interface SurpriseResult {
  granted: boolean;
  amount: number;
  balanceAfter: number | null;
}

/** Не более одного сюрприза в сутки; сверх учебного дневного лимита (§6.4). */
export async function maybeGrantSurprise(
  tx: PrismaTransaction,
  params: { userId: number; localDate: string; now: Date; rng: Rng },
): Promise<SurpriseResult> {
  const idempotencyKey = `SURPRISE:${params.userId}:${params.localDate}`;

  const existing = await tx.currencyTransaction.findUnique({
    where: { idempotencyKey },
    select: { id: true },
  });

  if (existing) {
    return { granted: false, amount: 0, balanceAfter: null };
  }

  if (params.rng.next() >= SURPRISE_PROBABILITY) {
    return { granted: false, amount: 0, balanceAfter: null };
  }

  const span = SURPRISE_MAX - SURPRISE_MIN + 1;
  const amount = SURPRISE_MIN + Math.min(span - 1, Math.floor(params.rng.next() * span));

  const user = await tx.user.update({
    where: { id: params.userId },
    data: { currencyBalance: { increment: amount } },
    select: { currencyBalance: true },
  });

  await tx.currencyTransaction.create({
    data: {
      idempotencyKey,
      userId: params.userId,
      amount,
      reason: 'SURPRISE',
      balanceAfter: user.currencyBalance,
      createdAt: params.now,
    },
  });

  return { granted: true, amount, balanceAfter: user.currencyBalance };
}

export type PurchaseResult =
  | { ok: true; item: ShopItem; cost: number; balanceAfter: number }
  | { ok: false; reason: 'INSUFFICIENT_FUNDS' | 'ALREADY_PROCESSED' };

/** Баланс меняется условным UPDATE и не может уйти в минус (§11). */
export async function purchase(
  tx: PrismaTransaction,
  params: { userId: number; item: ShopItem; cost: number; requestId: string; now: Date },
): Promise<PurchaseResult> {
  const idempotencyKey = `PURCHASE:${params.userId}:${params.requestId}`;

  const existing = await tx.purchase.findUnique({
    where: { idempotencyKey },
    select: { id: true },
  });

  if (existing) {
    return { ok: false, reason: 'ALREADY_PROCESSED' };
  }

  const charged = await tx.user.updateMany({
    where: { id: params.userId, currencyBalance: { gte: params.cost } },
    data: { currencyBalance: { decrement: params.cost } },
  });

  if (charged.count === 0) {
    return { ok: false, reason: 'INSUFFICIENT_FUNDS' };
  }

  const user = await tx.user.findUniqueOrThrow({
    where: { id: params.userId },
    select: { currencyBalance: true },
  });

  const created = await tx.purchase.create({
    data: {
      idempotencyKey,
      userId: params.userId,
      item: params.item,
      cost: params.cost,
      createdAt: params.now,
    },
    select: { id: true },
  });

  await tx.currencyTransaction.create({
    data: {
      idempotencyKey: `${idempotencyKey}:SPEND`,
      userId: params.userId,
      amount: -params.cost,
      reason: 'PURCHASE',
      balanceAfter: user.currencyBalance,
      purchaseId: created.id,
      createdAt: params.now,
    },
  });

  if (params.item === 'SHIELD') {
    await tx.user.update({
      where: { id: params.userId },
      data: { shields: { increment: 1 } },
    });
  }

  return { ok: true, item: params.item, cost: params.cost, balanceAfter: user.currencyBalance };
}
