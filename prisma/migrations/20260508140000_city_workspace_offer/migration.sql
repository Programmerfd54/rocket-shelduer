-- CreateTable
CREATE TABLE "CityWorkspaceOffer" (
    "id" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "workspaceName" TEXT NOT NULL,
    "workspaceUrl" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CityWorkspaceOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CityWorkspaceOffer_cityId_idx" ON "CityWorkspaceOffer"("cityId");

-- CreateIndex
CREATE UNIQUE INDEX "CityWorkspaceOffer_cityId_workspaceUrl_key" ON "CityWorkspaceOffer"("cityId", "workspaceUrl");

-- AddForeignKey
ALTER TABLE "CityWorkspaceOffer" ADD CONSTRAINT "CityWorkspaceOffer_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CityWorkspaceOffer" ADD CONSTRAINT "CityWorkspaceOffer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
