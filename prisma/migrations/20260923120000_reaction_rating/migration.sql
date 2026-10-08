-- CreateTable
CREATE TABLE "ReactionRatingSettings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "channels" JSONB NOT NULL DEFAULT '[]',
    "excludeOwnMessages" BOOLEAN NOT NULL DEFAULT true,
    "excludeBots" BOOLEAN NOT NULL DEFAULT true,
    "includeThreads" BOOLEAN NOT NULL DEFAULT false,
    "excludedUsernames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "reportChannelId" TEXT,
    "reportChannelName" TEXT,
    "weeklyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "weeklyDay" INTEGER NOT NULL DEFAULT 1,
    "reportHour" INTEGER NOT NULL DEFAULT 12,
    "monthlyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "topN" INTEGER NOT NULL DEFAULT 10,
    "mentionUsers" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "lastWeeklyPostKey" TEXT,
    "lastMonthlyPostPeriod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReactionRatingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReactionRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "messageTs" TIMESTAMP(3) NOT NULL,
    "period" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReactionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReactionMonthlyResult" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "entries" JSONB NOT NULL,
    "participants" INTEGER NOT NULL,
    "messages" INTEGER NOT NULL,
    "winnerUsernames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "announcedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReactionMonthlyResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReactionRatingSettings_workspaceId_key" ON "ReactionRatingSettings"("workspaceId");

-- CreateIndex
CREATE INDEX "ReactionRecord_workspaceId_period_idx" ON "ReactionRecord"("workspaceId", "period");

-- CreateIndex
CREATE INDEX "ReactionRecord_workspaceId_roomId_messageTs_idx" ON "ReactionRecord"("workspaceId", "roomId", "messageTs");

-- CreateIndex
CREATE UNIQUE INDEX "ReactionRecord_workspaceId_messageId_username_key" ON "ReactionRecord"("workspaceId", "messageId", "username");

-- CreateIndex
CREATE UNIQUE INDEX "ReactionMonthlyResult_workspaceId_period_key" ON "ReactionMonthlyResult"("workspaceId", "period");

-- AddForeignKey
ALTER TABLE "ReactionRatingSettings" ADD CONSTRAINT "ReactionRatingSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "WorkspaceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReactionRecord" ADD CONSTRAINT "ReactionRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "WorkspaceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReactionMonthlyResult" ADD CONSTRAINT "ReactionMonthlyResult_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "WorkspaceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

