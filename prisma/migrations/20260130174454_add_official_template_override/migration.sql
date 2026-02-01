-- CreateTable
CREATE TABLE "OfficialTemplateOverride" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "title" TEXT,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficialTemplateOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfficialTemplateOverride_templateId_idx" ON "OfficialTemplateOverride"("templateId");

-- CreateIndex
CREATE INDEX "OfficialTemplateOverride_scope_idx" ON "OfficialTemplateOverride"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "OfficialTemplateOverride_templateId_scope_key" ON "OfficialTemplateOverride"("templateId", "scope");

-- AddForeignKey
ALTER TABLE "OfficialTemplateOverride" ADD CONSTRAINT "OfficialTemplateOverride_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
