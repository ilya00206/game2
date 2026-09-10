/*
  Warnings:

  - You are about to drop the column `wordId` on the `WordOfDay` table. All the data in the column will be lost.
  - Added the required column `polish` to the `WordOfDay` table without a default value. This is not possible if the table is not empty.
  - Added the required column `russian` to the `WordOfDay` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WordOfDay" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "polish" TEXT NOT NULL,
    "russian" TEXT NOT NULL
);
INSERT INTO "new_WordOfDay" ("date", "id") SELECT "date", "id" FROM "WordOfDay";
DROP TABLE "WordOfDay";
ALTER TABLE "new_WordOfDay" RENAME TO "WordOfDay";
CREATE UNIQUE INDEX "WordOfDay_date_key" ON "WordOfDay"("date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
