-- CreateEnum
CREATE TYPE "CityRole" AS ENUM ('CITY_ADMIN', 'MEMBER');

-- CreateTable
CREATE TABLE "City" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "City_name_key" ON "City"("name");
CREATE UNIQUE INDEX "City_slug_key" ON "City"("slug");
CREATE INDEX "City_name_idx" ON "City"("name");

-- CreateTable
CREATE TABLE "CityMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "role" "CityRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CityMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CityMember_userId_cityId_key" ON "CityMember"("userId", "cityId");
CREATE INDEX "CityMember_cityId_idx" ON "CityMember"("cityId");
CREATE INDEX "CityMember_userId_idx" ON "CityMember"("userId");

-- CreateTable
CREATE TABLE "CityOsnovyLink" (
    "id" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedById" TEXT NOT NULL,

    CONSTRAINT "CityOsnovyLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CityOsnovyLink_cityId_workspaceId_key" ON "CityOsnovyLink"("cityId", "workspaceId");
CREATE INDEX "CityOsnovyLink_cityId_idx" ON "CityOsnovyLink"("cityId");
CREATE INDEX "CityOsnovyLink_workspaceId_idx" ON "CityOsnovyLink"("workspaceId");

-- CreateTable
CREATE TABLE "WorkspaceSettings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ldapEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ldapHost" TEXT,
    "ldapPort" INTEGER,
    "ldapBaseDN" TEXT,
    "ldapBindDN" TEXT,
    "ldapBindPass" TEXT,
    "ldapUserFilter" TEXT,
    "smtpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpUser" TEXT,
    "smtpPass" TEXT,
    "smtpFromName" TEXT,
    "smtpFromAddr" TEXT,
    "inviteEnabled" BOOLEAN NOT NULL DEFAULT true,
    "inviteAutoApprove" BOOLEAN NOT NULL DEFAULT false,
    "inviteDomains" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceSettings_workspaceId_key" ON "WorkspaceSettings"("workspaceId");

-- AlterTable
ALTER TABLE "WorkspaceConnection" ADD COLUMN "cityId" TEXT;

CREATE INDEX "WorkspaceConnection_cityId_idx" ON "WorkspaceConnection"("cityId");

-- Migrate Role enum (USER/VOL→MEMBER, ADM→CITY_ADMIN)
CREATE TYPE "Role_new" AS ENUM ('HQ_ADMIN', 'CITY_ADMIN', 'MEMBER', 'SUPPORT', 'ADMIN');

ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new" USING (
  CASE "role"::text
    WHEN 'USER' THEN 'MEMBER'::"Role_new"
    WHEN 'VOL' THEN 'MEMBER'::"Role_new"
    WHEN 'ADM' THEN 'CITY_ADMIN'::"Role_new"
    WHEN 'SUPPORT' THEN 'SUPPORT'::"Role_new"
    WHEN 'ADMIN' THEN 'ADMIN'::"Role_new"
    WHEN 'HQ_ADMIN' THEN 'HQ_ADMIN'::"Role_new"
    WHEN 'CITY_ADMIN' THEN 'CITY_ADMIN'::"Role_new"
    WHEN 'MEMBER' THEN 'MEMBER'::"Role_new"
    ELSE 'MEMBER'::"Role_new"
  END
);
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'MEMBER'::"Role_new";

ALTER TABLE "InviteToken" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "InviteToken" ALTER COLUMN "role" TYPE "Role_new" USING (
  CASE "role"::text
    WHEN 'USER' THEN 'MEMBER'::"Role_new"
    WHEN 'VOL' THEN 'MEMBER'::"Role_new"
    WHEN 'ADM' THEN 'CITY_ADMIN'::"Role_new"
    WHEN 'SUPPORT' THEN 'SUPPORT'::"Role_new"
    WHEN 'ADMIN' THEN 'ADMIN'::"Role_new"
    WHEN 'HQ_ADMIN' THEN 'HQ_ADMIN'::"Role_new"
    WHEN 'CITY_ADMIN' THEN 'CITY_ADMIN'::"Role_new"
    WHEN 'MEMBER' THEN 'MEMBER'::"Role_new"
    ELSE 'MEMBER'::"Role_new"
  END
);
ALTER TABLE "InviteToken" ALTER COLUMN "role" SET DEFAULT 'MEMBER'::"Role_new";

DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";

-- AddForeignKey
ALTER TABLE "CityMember" ADD CONSTRAINT "CityMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CityMember" ADD CONSTRAINT "CityMember_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CityOsnovyLink" ADD CONSTRAINT "CityOsnovyLink_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CityOsnovyLink" ADD CONSTRAINT "CityOsnovyLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "WorkspaceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CityOsnovyLink" ADD CONSTRAINT "CityOsnovyLink_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceSettings" ADD CONSTRAINT "WorkspaceSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "WorkspaceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceConnection" ADD CONSTRAINT "WorkspaceConnection_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;
