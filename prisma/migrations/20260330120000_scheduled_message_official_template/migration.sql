-- AlterTable
ALTER TABLE "ScheduledMessage" ADD COLUMN "sourceOfficialTemplateId" TEXT;

-- CreateIndex
CREATE INDEX "ScheduledMessage_sourceOfficialTemplateId_idx" ON "ScheduledMessage"("sourceOfficialTemplateId");
