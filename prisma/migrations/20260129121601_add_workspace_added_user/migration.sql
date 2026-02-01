/*
  Warnings:

  - You are about to drop the `FavoriteChannel` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "FavoriteChannel" DROP CONSTRAINT "FavoriteChannel_userId_fkey";

-- DropForeignKey
ALTER TABLE "FavoriteChannel" DROP CONSTRAINT "FavoriteChannel_workspaceId_fkey";

-- DropTable
DROP TABLE "FavoriteChannel";

-- CreateTable
CREATE TABLE "WorkspaceAddedUser" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "rcUserId" TEXT,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ADDED',
    "errorMessage" TEXT,

    CONSTRAINT "WorkspaceAddedUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkspaceAddedUser_workspaceId_idx" ON "WorkspaceAddedUser"("workspaceId");

-- CreateIndex
CREATE INDEX "WorkspaceAddedUser_workspaceId_username_idx" ON "WorkspaceAddedUser"("workspaceId", "username");

-- AddForeignKey
ALTER TABLE "WorkspaceAddedUser" ADD CONSTRAINT "WorkspaceAddedUser_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "WorkspaceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
