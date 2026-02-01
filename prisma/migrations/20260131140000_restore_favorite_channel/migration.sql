-- CreateTable
CREATE TABLE "FavoriteChannel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FavoriteChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FavoriteChannel_userId_workspaceId_idx" ON "FavoriteChannel"("userId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "FavoriteChannel_userId_workspaceId_channelId_key" ON "FavoriteChannel"("userId", "workspaceId", "channelId");

-- AddForeignKey
ALTER TABLE "FavoriteChannel" ADD CONSTRAINT "FavoriteChannel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteChannel" ADD CONSTRAINT "FavoriteChannel_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "WorkspaceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
