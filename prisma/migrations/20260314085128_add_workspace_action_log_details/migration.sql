-- AlterTable
ALTER TABLE "WorkspaceActionLog" ADD COLUMN     "details" TEXT;

-- CreateIndex
CREATE INDEX "WorkspaceActionLog_workspaceId_action_idx" ON "WorkspaceActionLog"("workspaceId", "action");
