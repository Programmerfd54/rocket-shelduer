-- CreateTable
CREATE TABLE "WorkspaceAdminAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceAdminAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkspaceAdminAssignment_userId_idx" ON "WorkspaceAdminAssignment"("userId");

-- CreateIndex
CREATE INDEX "WorkspaceAdminAssignment_workspaceId_idx" ON "WorkspaceAdminAssignment"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceAdminAssignment_userId_workspaceId_key" ON "WorkspaceAdminAssignment"("userId", "workspaceId");

-- AddForeignKey
ALTER TABLE "WorkspaceAdminAssignment" ADD CONSTRAINT "WorkspaceAdminAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceAdminAssignment" ADD CONSTRAINT "WorkspaceAdminAssignment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "WorkspaceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceAdminAssignment" ADD CONSTRAINT "WorkspaceAdminAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
