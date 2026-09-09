import type { PrismaClient } from '@prisma/client';

/** Клиент внутри интерактивной транзакции. */
export type PrismaTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
