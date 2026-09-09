-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "telegramId" BIGINT NOT NULL,
    "currencyBalance" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "maxStreak" INTEGER NOT NULL DEFAULT 0,
    "shields" INTEGER NOT NULL DEFAULT 0,
    "reminderHour" INTEGER NOT NULL DEFAULT 10,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Minsk',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Category" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "ownerId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Category_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Word" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "categoryId" INTEGER NOT NULL,
    "polish" TEXT NOT NULL,
    "russian" TEXT NOT NULL,
    "transcription" TEXT,
    "example" TEXT,
    "ownerId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Word_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Word_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserWord" (
    "userId" INTEGER NOT NULL,
    "wordId" INTEGER NOT NULL,
    "firstSeenAt" DATETIME,
    "lastSeenAt" DATETIME,
    "timesSeen" INTEGER NOT NULL DEFAULT 0,
    "timesKnown" INTEGER NOT NULL DEFAULT 0,
    "timesUnknown" INTEGER NOT NULL DEFAULT 0,
    "currentScore" REAL NOT NULL DEFAULT 0,
    "currentLevel" INTEGER NOT NULL DEFAULT 0,
    "lastAnswer" TEXT,
    "lastAnswerAt" DATETIME,
    "consecutiveKnown" INTEGER NOT NULL DEFAULT 0,
    "consecutiveUnknown" INTEGER NOT NULL DEFAULT 0,
    "testSeenCount" INTEGER NOT NULL DEFAULT 0,
    "testCorrectCount" INTEGER NOT NULL DEFAULT 0,
    "testWrongCount" INTEGER NOT NULL DEFAULT 0,
    "firstLearnedAt" DATETIME,
    "timesSeenToLearn" INTEGER,
    "nextReviewAt" DATETIME,

    PRIMARY KEY ("userId", "wordId"),
    CONSTRAINT "UserWord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserWord_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "categoryId" INTEGER,
    "direction" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "plannedCount" INTEGER NOT NULL,
    "answeredCount" INTEGER NOT NULL DEFAULT 0,
    "isFull" BOOLEAN NOT NULL DEFAULT false,
    "rewardedAt" DATETIME,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Session_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionCard" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "wordId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "promptText" TEXT NOT NULL,
    "options" TEXT,
    "correctOption" INTEGER,
    "selectedOption" INTEGER,
    "answerActionId" TEXT,
    "answer" TEXT,
    "isCorrect" BOOLEAN,
    "shownAt" DATETIME,
    "answeredAt" DATETIME,
    CONSTRAINT "SessionCard_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SessionCard_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SessionCard_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserDay" (
    "userId" INTEGER NOT NULL,
    "localDate" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "completedSessions" INTEGER NOT NULL DEFAULT 0,
    "shieldConsumed" BOOLEAN NOT NULL DEFAULT false,
    "streakAppliedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("userId", "localDate"),
    CONSTRAINT "UserDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProcessedTelegramUpdate" (
    "updateId" BIGINT NOT NULL PRIMARY KEY,
    "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ReminderDelivery" (
    "idempotencyKey" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "reservedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    CONSTRAINT "ReminderDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Event" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "idempotencyKey" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "sessionId" INTEGER,
    "cardId" INTEGER,
    "answer" TEXT,
    "responseTimeMs" INTEGER,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Event_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Event_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "SessionCard" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "idempotencyKey" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "item" TEXT NOT NULL,
    "cost" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CurrencyTransaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "idempotencyKey" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "sessionId" INTEGER,
    "purchaseId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CurrencyTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CurrencyTransaction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CurrencyTransaction_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AdminAdjustment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "idempotencyKey" TEXT NOT NULL,
    "adminTelegramId" BIGINT NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminAdjustment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WordOfDay" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "wordId" INTEGER NOT NULL,
    CONSTRAINT "WordOfDay_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserContentState" (
    "userId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "lastVariant" INTEGER NOT NULL,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("userId", "key"),
    CONSTRAINT "UserContentState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContentText" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "variant" INTEGER NOT NULL,
    "group" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSeed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" INTEGER
);

-- CreateTable
CREATE TABLE "CurrencyConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "icon" TEXT NOT NULL DEFAULT '☀️',
    "nameOne" TEXT NOT NULL DEFAULT 'солнышко',
    "nameFew" TEXT NOT NULL DEFAULT 'солнышка',
    "nameMany" TEXT NOT NULL DEFAULT 'солнышек',
    "updatedAt" DATETIME NOT NULL,
    "updatedById" INTEGER
);

-- CreateTable
CREATE TABLE "EconomyConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "flashcardReward" INTEGER NOT NULL DEFAULT 5,
    "testReward" INTEGER NOT NULL DEFAULT 10,
    "dailyLearningLimit" INTEGER NOT NULL DEFAULT 20,
    "giftSmallPrice" INTEGER NOT NULL DEFAULT 120,
    "giftSpecialPrice" INTEGER NOT NULL DEFAULT 350,
    "shieldPrice" INTEGER NOT NULL DEFAULT 25,
    "updatedAt" DATETIME NOT NULL,
    "updatedById" INTEGER
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE INDEX "Category_ownerId_isActive_idx" ON "Category"("ownerId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_ownerId_key" ON "Category"("name", "ownerId");

-- CreateIndex
CREATE INDEX "Word_categoryId_isActive_idx" ON "Word"("categoryId", "isActive");

-- CreateIndex
CREATE INDEX "Word_ownerId_isActive_idx" ON "Word"("ownerId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Word_categoryId_polish_ownerId_key" ON "Word"("categoryId", "polish", "ownerId");

-- CreateIndex
CREATE INDEX "UserWord_userId_currentLevel_idx" ON "UserWord"("userId", "currentLevel");

-- CreateIndex
CREATE INDEX "UserWord_userId_nextReviewAt_idx" ON "UserWord"("userId", "nextReviewAt");

-- CreateIndex
CREATE INDEX "Session_userId_status_idx" ON "Session"("userId", "status");

-- CreateIndex
CREATE INDEX "Session_userId_startedAt_idx" ON "Session"("userId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SessionCard_answerActionId_key" ON "SessionCard"("answerActionId");

-- CreateIndex
CREATE INDEX "SessionCard_sessionId_wordId_idx" ON "SessionCard"("sessionId", "wordId");

-- CreateIndex
CREATE INDEX "SessionCard_wordId_shownAt_idx" ON "SessionCard"("wordId", "shownAt");

-- CreateIndex
CREATE UNIQUE INDEX "SessionCard_sessionId_position_key" ON "SessionCard"("sessionId", "position");

-- CreateIndex
CREATE INDEX "UserDay_userId_status_idx" ON "UserDay"("userId", "status");

-- CreateIndex
CREATE INDEX "ProcessedTelegramUpdate_processedAt_idx" ON "ProcessedTelegramUpdate"("processedAt");

-- CreateIndex
CREATE INDEX "ReminderDelivery_userId_localDate_idx" ON "ReminderDelivery"("userId", "localDate");

-- CreateIndex
CREATE UNIQUE INDEX "Event_idempotencyKey_key" ON "Event"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Event_userId_timestamp_idx" ON "Event"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "Event_userId_eventType_timestamp_idx" ON "Event"("userId", "eventType", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_idempotencyKey_key" ON "Purchase"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Purchase_userId_createdAt_idx" ON "Purchase"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CurrencyTransaction_idempotencyKey_key" ON "CurrencyTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CurrencyTransaction_userId_createdAt_idx" ON "CurrencyTransaction"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminAdjustment_idempotencyKey_key" ON "AdminAdjustment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AdminAdjustment_userId_createdAt_idx" ON "AdminAdjustment"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WordOfDay_date_key" ON "WordOfDay"("date");

-- CreateIndex
CREATE INDEX "ContentText_key_isActive_idx" ON "ContentText"("key", "isActive");

-- CreateIndex
CREATE INDEX "ContentText_group_isActive_idx" ON "ContentText"("group", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ContentText_key_variant_key" ON "ContentText"("key", "variant");

-- Единственная ACTIVE-сессия на пользователя; частичный индекс не выражается в Prisma DSL (§4.2).
CREATE UNIQUE INDEX "Session_userId_active_key" ON "Session"("userId") WHERE "status" = 'ACTIVE';
