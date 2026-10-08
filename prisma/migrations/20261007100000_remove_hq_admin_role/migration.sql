-- Удаление роли HQ_ADMIN и отказ от «городов» в приложении.
--
-- 1) Role: HQ_ADMIN → LEAD_SUP (User.role, InviteToken.role), затем пересоздание enum без HQ_ADMIN.
-- 2) Городской контент (справка, переопределения шаблонов, настройки города) копируется в глобальные
--    строки (cityId IS NULL), если глобального аналога ещё нет. Городские строки НЕ удаляются (legacy).
-- 3) InviteToken: поля доступа волонтёра (для приглашений MEMBER с датой окончания / интенсивом).
-- 4) FK WorkspaceConnection.cityId: ON DELETE CASCADE → ON DELETE SET NULL (удаление строки City
--    больше не удаляет пространства).
-- Таблицы City / CityMember / CityOsnovyLink / CityWorkspaceOffer / CitySystemSetting и колонки cityId
-- сохраняются ради данных и больше не используются приложением.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Role: HQ_ADMIN → LEAD_SUP
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE "User" SET "role" = 'LEAD_SUP' WHERE "role"::text = 'HQ_ADMIN';
UPDATE "InviteToken" SET "role" = 'LEAD_SUP' WHERE "role"::text = 'HQ_ADMIN';
-- Главная учётная запись «admin» (scripts/create-superuser.ts) должна иметь верхнюю роль.
UPDATE "User" SET "role" = 'LEAD_SUP' WHERE "email" = 'admin' OR "username" = 'admin';

CREATE TYPE "Role_new" AS ENUM ('LEAD_SUP', 'SUP', 'ADM', 'MEMBER');

ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new" USING (
  CASE "role"::text
    WHEN 'LEAD_SUP' THEN 'LEAD_SUP'::"Role_new"
    WHEN 'HQ_ADMIN' THEN 'LEAD_SUP'::"Role_new"
    WHEN 'SUP' THEN 'SUP'::"Role_new"
    WHEN 'ADM' THEN 'ADM'::"Role_new"
    ELSE 'MEMBER'::"Role_new"
  END
);
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'MEMBER'::"Role_new";

ALTER TABLE "InviteToken" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "InviteToken" ALTER COLUMN "role" TYPE "Role_new" USING (
  CASE "role"::text
    WHEN 'LEAD_SUP' THEN 'LEAD_SUP'::"Role_new"
    WHEN 'HQ_ADMIN' THEN 'LEAD_SUP'::"Role_new"
    WHEN 'SUP' THEN 'SUP'::"Role_new"
    WHEN 'ADM' THEN 'ADM'::"Role_new"
    ELSE 'MEMBER'::"Role_new"
  END
);
ALTER TABLE "InviteToken" ALTER COLUMN "role" SET DEFAULT 'MEMBER'::"Role_new";

DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Городской контент → глобальные копии (без дублей)
-- ─────────────────────────────────────────────────────────────────────────────
-- Нормализация заголовков для сравнения (не зависит от LC_CTYPE БД: кириллица приводится явно).
CREATE OR REPLACE FUNCTION "_mig_norm_title"(t TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $f$
  SELECT lower(translate(btrim(coalesce(t, '')),
    'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',
    'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'))
$f$;

DO $$
DECLARE
  c RECORD;
  i RECORD;
  f RECORD;
  target_catalog TEXT;
  next_order INT;
  new_id TEXT;
BEGIN
  -- 2.1 HelpMainContent: если глобального непустого контента нет — берём самый свежий городской.
  IF NOT EXISTS (
    SELECT 1 FROM "HelpMainContent" WHERE "cityId" IS NULL AND btrim("content") <> ''
  ) THEN
    SELECT "content", "updatedAt" INTO c
    FROM "HelpMainContent"
    WHERE "cityId" IS NOT NULL AND btrim("content") <> ''
    ORDER BY "updatedAt" DESC
    LIMIT 1;
    IF FOUND THEN
      IF EXISTS (SELECT 1 FROM "HelpMainContent" WHERE "cityId" IS NULL) THEN
        UPDATE "HelpMainContent"
        SET "content" = c."content", "updatedAt" = c."updatedAt"
        WHERE "id" = (
          SELECT "id" FROM "HelpMainContent" WHERE "cityId" IS NULL ORDER BY "updatedAt" DESC LIMIT 1
        );
      ELSE
        INSERT INTO "HelpMainContent" ("id", "cityId", "content", "updatedAt")
        VALUES ('mig_' || md5(random()::text || clock_timestamp()::text), NULL, c."content", c."updatedAt");
      END IF;
    END IF;
  END IF;

  -- 2.2 HelpMainSection: копируем городские разделы, которых нет глобально (по заголовку + содержимому).
  SELECT COALESCE(MAX("order"), -1) + 1 INTO next_order FROM "HelpMainSection" WHERE "cityId" IS NULL;
  FOR c IN
    SELECT * FROM "HelpMainSection" WHERE "cityId" IS NOT NULL ORDER BY "cityId", "order", "updatedAt"
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM "HelpMainSection" g
      WHERE g."cityId" IS NULL
        AND "_mig_norm_title"(g."title") = "_mig_norm_title"(c."title")
        AND g."content" = c."content"
    ) THEN
      INSERT INTO "HelpMainSection" ("id", "cityId", "title", "order", "content", "updatedAt")
      VALUES ('mig_' || md5(random()::text || clock_timestamp()::text || c."id"), NULL, c."title", next_order, c."content", c."updatedAt");
      next_order := next_order + 1;
    END IF;
  END LOOP;

  -- 2.3 HelpCatalog (+ инструкции и FAQ): городской каталог сливается с глобальным каталогом
  --     с тем же названием (добавляются недостающие инструкции/FAQ), иначе создаётся глобальная копия.
  SELECT COALESCE(MAX("order"), -1) + 1 INTO next_order FROM "HelpCatalog" WHERE "cityId" IS NULL;
  FOR c IN
    SELECT * FROM "HelpCatalog" WHERE "cityId" IS NOT NULL ORDER BY "cityId", "order", "createdAt"
  LOOP
    SELECT g."id" INTO target_catalog
    FROM "HelpCatalog" g
    WHERE g."cityId" IS NULL AND "_mig_norm_title"(g."title") = "_mig_norm_title"(c."title")
    ORDER BY g."createdAt"
    LIMIT 1;

    IF target_catalog IS NULL THEN
      target_catalog := 'mig_' || md5(random()::text || clock_timestamp()::text || c."id");
      INSERT INTO "HelpCatalog" ("id", "cityId", "title", "order", "roles", "createdAt", "updatedAt")
      VALUES (target_catalog, NULL, c."title", next_order, c."roles", c."createdAt", c."updatedAt");
      next_order := next_order + 1;
    END IF;

    FOR i IN SELECT * FROM "HelpInstruction" WHERE "catalogId" = c."id" ORDER BY "order", "createdAt" LOOP
      IF NOT EXISTS (
        SELECT 1 FROM "HelpInstruction" x
        WHERE x."catalogId" = target_catalog AND "_mig_norm_title"(x."title") = "_mig_norm_title"(i."title")
      ) THEN
        new_id := 'mig_' || md5(random()::text || clock_timestamp()::text || i."id");
        INSERT INTO "HelpInstruction" ("id", "catalogId", "title", "content", "order", "roles", "createdAt", "updatedAt")
        VALUES (
          new_id, target_catalog, i."title", i."content",
          (SELECT COALESCE(MAX("order"), -1) + 1 FROM "HelpInstruction" WHERE "catalogId" = target_catalog),
          i."roles", i."createdAt", i."updatedAt"
        );
      END IF;
    END LOOP;

    FOR f IN SELECT * FROM "HelpFAQ" WHERE "catalogId" = c."id" ORDER BY "order", "createdAt" LOOP
      IF NOT EXISTS (
        SELECT 1 FROM "HelpFAQ" x
        WHERE x."catalogId" = target_catalog AND "_mig_norm_title"(x."question") = "_mig_norm_title"(f."question")
      ) THEN
        new_id := 'mig_' || md5(random()::text || clock_timestamp()::text || f."id");
        INSERT INTO "HelpFAQ" ("id", "catalogId", "question", "answer", "order", "roles", "createdAt", "updatedAt")
        VALUES (
          new_id, target_catalog, f."question", f."answer",
          (SELECT COALESCE(MAX("order"), -1) + 1 FROM "HelpFAQ" WHERE "catalogId" = target_catalog),
          f."roles", f."createdAt", f."updatedAt"
        );
      END IF;
    END LOOP;
  END LOOP;
END $$;

DROP FUNCTION "_mig_norm_title"(TEXT);

-- 2.4 OfficialTemplateOverride: для (templateId, scope) без глобального переопределения
--     копируем самое свежее городское.
--     Миграция 20260507140000 пыталась убрать старый уникальный индекс (templateId, scope) через
--     DROP CONSTRAINT, но это индекс, а не constraint, — он остался в БД (рассинхрон со schema.prisma,
--     где только @@unique([templateId, scope, cityId])). Убираем его, иначе копия ниже может упасть.
DROP INDEX IF EXISTS "OfficialTemplateOverride_templateId_scope_key";

INSERT INTO "OfficialTemplateOverride" ("id", "templateId", "scope", "cityId", "body", "title", "channel", "time", "updatedById", "updatedAt")
SELECT
  'mig_' || md5(random()::text || clock_timestamp()::text || o."id"),
  o."templateId", o."scope", NULL, o."body", o."title", o."channel", o."time", o."updatedById", o."updatedAt"
FROM (
  SELECT DISTINCT ON ("templateId", "scope") *
  FROM "OfficialTemplateOverride"
  WHERE "cityId" IS NOT NULL
  ORDER BY "templateId", "scope", "updatedAt" DESC
) o
WHERE NOT EXISTS (
  SELECT 1 FROM "OfficialTemplateOverride" g
  WHERE g."cityId" IS NULL AND g."templateId" = o."templateId" AND g."scope" = o."scope"
);

-- 2.5 CitySystemSetting → SystemSetting: только ключи, которых нет глобально (самое свежее значение).
INSERT INTO "SystemSetting" ("id", "key", "value", "updatedAt")
SELECT
  'mig_' || md5(random()::text || clock_timestamp()::text || s."id"),
  s."key", s."value", s."updatedAt"
FROM (
  SELECT DISTINCT ON ("key") *
  FROM "CitySystemSetting"
  ORDER BY "key", "updatedAt" DESC
) s
WHERE NOT EXISTS (SELECT 1 FROM "SystemSetting" g WHERE g."key" = s."key");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. InviteToken: доступ волонтёра
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "InviteToken" ADD COLUMN IF NOT EXISTS "volunteerExpiresAt" TIMESTAMP(3);
ALTER TABLE "InviteToken" ADD COLUMN IF NOT EXISTS "volunteerIntensive" TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. WorkspaceConnection.cityId: удаление City больше не каскадирует на пространства
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "WorkspaceConnection" DROP CONSTRAINT IF EXISTS "WorkspaceConnection_cityId_fkey";
ALTER TABLE "WorkspaceConnection" ADD CONSTRAINT "WorkspaceConnection_cityId_fkey"
  FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;
