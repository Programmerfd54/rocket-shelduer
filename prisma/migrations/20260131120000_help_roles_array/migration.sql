-- Add roles array to HelpCatalog (no existing role column)
ALTER TABLE "HelpCatalog" ADD COLUMN "roles" TEXT[] DEFAULT '{}';

-- Add roles to HelpInstruction, copy from role, then drop role
ALTER TABLE "HelpInstruction" ADD COLUMN "roles" TEXT[] DEFAULT '{}';
UPDATE "HelpInstruction" SET "roles" = ARRAY["role"] WHERE "role" IS NOT NULL AND "role" != '';
ALTER TABLE "HelpInstruction" DROP COLUMN "role";

-- Add roles to HelpFAQ, copy from role, then drop role
ALTER TABLE "HelpFAQ" ADD COLUMN "roles" TEXT[] DEFAULT '{}';
UPDATE "HelpFAQ" SET "roles" = ARRAY["role"] WHERE "role" IS NOT NULL AND "role" != '';
ALTER TABLE "HelpFAQ" DROP COLUMN "role";
