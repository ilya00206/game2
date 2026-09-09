-- CreateTable
CREATE TABLE "AdminMessage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "idempotencyKey" TEXT NOT NULL,
    "adminTelegramId" BIGINT NOT NULL,
    "userId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    CONSTRAINT "AdminMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminMessage_idempotencyKey_key" ON "AdminMessage"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AdminMessage_userId_createdAt_idx" ON "AdminMessage"("userId", "createdAt");
