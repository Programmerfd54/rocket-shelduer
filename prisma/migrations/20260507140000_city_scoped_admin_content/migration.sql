-- Per-city admin settings and scoped help / template overrides

CREATE TABLE "CitySystemSetting" (
    "id" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CitySystemSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CitySystemSetting_cityId_key_key" ON "CitySystemSetting"("cityId", "key");
CREATE INDEX "CitySystemSetting_cityId_idx" ON "CitySystemSetting"("cityId");
ALTER TABLE "CitySystemSetting" ADD CONSTRAINT "CitySystemSetting_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HelpMainContent" ADD COLUMN "cityId" TEXT;
ALTER TABLE "HelpMainContent" ADD CONSTRAINT "HelpMainContent_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "HelpMainContent_cityId_idx" ON "HelpMainContent"("cityId");

ALTER TABLE "HelpMainSection" ADD COLUMN "cityId" TEXT;
ALTER TABLE "HelpMainSection" ADD CONSTRAINT "HelpMainSection_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "HelpMainSection_cityId_idx" ON "HelpMainSection"("cityId");

ALTER TABLE "HelpCatalog" ADD COLUMN "cityId" TEXT;
ALTER TABLE "HelpCatalog" ADD CONSTRAINT "HelpCatalog_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "HelpCatalog_cityId_idx" ON "HelpCatalog"("cityId");

ALTER TABLE "OfficialTemplateOverride" DROP CONSTRAINT IF EXISTS "OfficialTemplateOverride_templateId_scope_key";
ALTER TABLE "OfficialTemplateOverride" ADD COLUMN "cityId" TEXT;
ALTER TABLE "OfficialTemplateOverride" ADD CONSTRAINT "OfficialTemplateOverride_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "OfficialTemplateOverride_cityId_idx" ON "OfficialTemplateOverride"("cityId");
CREATE UNIQUE INDEX "OfficialTemplateOverride_templateId_scope_cityId_key" ON "OfficialTemplateOverride"("templateId", "scope", "cityId");
