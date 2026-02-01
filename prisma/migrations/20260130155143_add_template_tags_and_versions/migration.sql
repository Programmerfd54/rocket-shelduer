-- AlterTable
ALTER TABLE "UserTemplate" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "UserTemplateVersion" (
    "id" TEXT NOT NULL,
    "userTemplateId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "title" TEXT,
    "channel" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "intensiveDay" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserTemplateVersion_userTemplateId_idx" ON "UserTemplateVersion"("userTemplateId");

-- AddForeignKey
ALTER TABLE "UserTemplateVersion" ADD CONSTRAINT "UserTemplateVersion_userTemplateId_fkey" FOREIGN KEY ("userTemplateId") REFERENCES "UserTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
