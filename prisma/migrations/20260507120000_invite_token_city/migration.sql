-- AlterTable
ALTER TABLE "InviteToken" ADD COLUMN     "cityId" TEXT;

-- CreateIndex
CREATE INDEX "InviteToken_cityId_idx" ON "InviteToken"("cityId");

-- AddForeignKey
ALTER TABLE "InviteToken" ADD CONSTRAINT "InviteToken_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;
