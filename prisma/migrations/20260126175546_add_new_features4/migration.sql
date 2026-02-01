-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityType" ADD VALUE 'WORKSPACE_ARCHIVED';
ALTER TYPE "ActivityType" ADD VALUE 'WORKSPACE_UNARCHIVED';

-- AlterTable
ALTER TABLE "ScheduledMessage" ADD COLUMN     "messageId_RC" TEXT;

-- AlterTable
ALTER TABLE "WorkspaceConnection" ADD COLUMN     "archiveDeleteAt" TIMESTAMP(3),
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "startDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ScheduledMessage_workspaceId_status_idx" ON "ScheduledMessage"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "ScheduledMessage_messageId_RC_idx" ON "ScheduledMessage"("messageId_RC");

-- CreateIndex
CREATE INDEX "WorkspaceConnection_isArchived_archiveDeleteAt_idx" ON "WorkspaceConnection"("isArchived", "archiveDeleteAt");
