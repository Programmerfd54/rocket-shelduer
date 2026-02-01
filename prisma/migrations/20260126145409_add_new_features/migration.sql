-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('USER_LOGIN', 'USER_LOGOUT', 'USER_REGISTER', 'WORKSPACE_CREATED', 'WORKSPACE_UPDATED', 'WORKSPACE_DELETED', 'WORKSPACE_CONNECTED', 'MESSAGE_CREATED', 'MESSAGE_UPDATED', 'MESSAGE_DELETED', 'MESSAGE_SENT', 'MESSAGE_FAILED', 'SETTINGS_UPDATED', 'PASSWORD_CHANGED', 'ADMIN_ACTION');

-- AlterTable
ALTER TABLE "ScheduledMessage" ADD COLUMN     "isRecurring" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recurringConfig" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "theme" TEXT DEFAULT 'system';

-- AlterTable
ALTER TABLE "WorkspaceConnection" ADD COLUMN     "color" TEXT DEFAULT '#ef4444';

-- CreateTable
CREATE TABLE "WorkspaceGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#ef4444',
    "icon" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceInGroup" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceInGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "ActivityType" NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "details" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceGroup_userId_name_key" ON "WorkspaceGroup"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceInGroup_groupId_workspaceId_key" ON "WorkspaceInGroup"("groupId", "workspaceId");

-- CreateIndex
CREATE INDEX "ActivityLog_userId_createdAt_idx" ON "ActivityLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_action_createdAt_idx" ON "ActivityLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduledMessage_userId_status_idx" ON "ScheduledMessage"("userId", "status");

-- AddForeignKey
ALTER TABLE "WorkspaceGroup" ADD CONSTRAINT "WorkspaceGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInGroup" ADD CONSTRAINT "WorkspaceInGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "WorkspaceGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInGroup" ADD CONSTRAINT "WorkspaceInGroup_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "WorkspaceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
