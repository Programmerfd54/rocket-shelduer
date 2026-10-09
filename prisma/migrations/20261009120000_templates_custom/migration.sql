-- Редактор официальных шаблонов для Lead_SUP (docs/templates-api.md).
-- Аддитивно: новые таблицы и nullable-колонки; существующие данные не меняются
-- (OfficialTemplateOverride.body становится nullable — прежние строки сохраняют свой текст).
--
-- Часть 1 — то, что описывает prisma/schema.prisma.

-- AlterTable: переопределения встроенных шаблонов — все поля + обратимое удаление
ALTER TABLE "OfficialTemplateOverride" ADD COLUMN     "audience" TEXT,
ADD COLUMN     "dayLabel" TEXT,
ADD COLUMN     "intensiveDay" INTEGER,
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "timeNote" TEXT,
ALTER COLUMN "body" DROP NOT NULL;

-- CreateTable: шаблоны, созданные Lead_SUP
CREATE TABLE "CustomOfficialTemplate" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "intensiveDay" INTEGER NOT NULL,
    "dayLabel" TEXT,
    "time" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'all',
    "timeNote" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomOfficialTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable: словарь каналов
CREATE TABLE "TemplateChannel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomOfficialTemplate_scope_intensiveDay_time_idx" ON "CustomOfficialTemplate"("scope", "intensiveDay", "time");

-- CreateIndex
CREATE INDEX "CustomOfficialTemplate_channel_idx" ON "CustomOfficialTemplate"("channel");

-- CreateIndex (name хранится в нижнем регистре — CHECK ниже, — поэтому это уникальность без учёта регистра)
CREATE UNIQUE INDEX "TemplateChannel_name_key" ON "TemplateChannel"("name");

-- AddForeignKey
ALTER TABLE "CustomOfficialTemplate" ADD CONSTRAINT "CustomOfficialTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomOfficialTemplate" ADD CONSTRAINT "CustomOfficialTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateChannel" ADD CONSTRAINT "TemplateChannel_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Часть 2 — CHECK-ограничения (Prisma их не описывает).

ALTER TABLE "CustomOfficialTemplate"
  ADD CONSTRAINT "CustomOfficialTemplate_scope_check" CHECK ("scope" IN ('SUP', 'ADM')),
  ADD CONSTRAINT "CustomOfficialTemplate_day_check" CHECK ("intensiveDay" BETWEEN 1 AND 366),
  ADD CONSTRAINT "CustomOfficialTemplate_time_check" CHECK ("time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "CustomOfficialTemplate_audience_check" CHECK ("audience" IN ('all', 'mk')),
  ADD CONSTRAINT "CustomOfficialTemplate_title_check" CHECK (char_length("title") BETWEEN 1 AND 200),
  ADD CONSTRAINT "CustomOfficialTemplate_body_check" CHECK (char_length("body") BETWEEN 1 AND 20000),
  ADD CONSTRAINT "CustomOfficialTemplate_channel_check" CHECK (char_length("channel") BETWEEN 1 AND 80);

-- Только новые колонки (старые строки переопределений не проверяются задним числом)
ALTER TABLE "OfficialTemplateOverride"
  ADD CONSTRAINT "OfficialTemplateOverride_day_check" CHECK ("intensiveDay" IS NULL OR "intensiveDay" BETWEEN 1 AND 366),
  ADD CONSTRAINT "OfficialTemplateOverride_audience_check" CHECK ("audience" IS NULL OR "audience" IN ('all', 'mk'));

ALTER TABLE "TemplateChannel"
  ADD CONSTRAINT "TemplateChannel_name_check" CHECK (
    "name" = lower(translate("name", 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'))
    AND char_length("name") BETWEEN 1 AND 80 AND "name" !~ '^#'
  ),
  ADD CONSTRAINT "TemplateChannel_label_check" CHECK ("label" IS NULL OR char_length("label") <= 80);

-- Часть 3 — начальное наполнение словаря (идемпотентно: ON CONFLICT DO NOTHING).
-- Каналы из интерфейса и lib/templates-data + все корректные имена, уже используемые в шаблонах.
-- Нормализация как в lib/templates/channels.ts: без '#', пробелы → '_', нижний регистр;
-- некорректные имена (например «support(Проверки на 5 этаже)») пропускаются.
INSERT INTO "TemplateChannel" ("id", "name", "createdAt")
SELECT 'tch' || substr(md5(n.name || random()::text || clock_timestamp()::text), 1, 22), n.name, CURRENT_TIMESTAMP
FROM (
  -- translate(): lower() в локали C не переводит кириллицу в нижний регистр
  SELECT DISTINCT lower(translate(
    regexp_replace(regexp_replace(btrim(raw), '^#+', ''), '\s+', '_', 'g'),
    'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'
  )) AS name
  FROM (
    SELECT unnest(ARRAY['adm', 'announcements', 'general', 'support', 'services', 'random']) AS raw
    UNION ALL SELECT "channel" FROM "UserTemplate"
    UNION ALL SELECT "channel" FROM "OfficialTemplateOverride" WHERE "channel" IS NOT NULL
    UNION ALL SELECT "channel" FROM "CustomOfficialTemplate"
  ) src
) n
WHERE n.name ~ '^[[:alnum:]а-яё._-]{1,80}$'
ON CONFLICT ("name") DO NOTHING;
