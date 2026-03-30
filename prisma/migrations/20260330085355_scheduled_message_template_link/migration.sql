-- AlterTable
ALTER TABLE "ScheduledMessage" ADD COLUMN     "sourceUserTemplateId" TEXT;

-- AlterTable
ALTER TABLE "UserTemplate" ADD COLUMN     "lastSentAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ScheduledMessage_sourceUserTemplateId_idx" ON "ScheduledMessage"("sourceUserTemplateId");

-- AddForeignKey
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_sourceUserTemplateId_fkey" FOREIGN KEY ("sourceUserTemplateId") REFERENCES "UserTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
