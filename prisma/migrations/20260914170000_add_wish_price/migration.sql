-- Add the price for the "Wish from you" shop item.
ALTER TABLE "EconomyConfig" ADD COLUMN "wishPrice" INTEGER NOT NULL DEFAULT 500;
