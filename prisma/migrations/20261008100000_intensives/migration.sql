-- Интенсивы, OrgSpace, план анонсов, история (docs/intensives-spec.md, docs/intensives-api.md).
--
-- Миграция только добавляет объекты: ничего не удаляется и не переписывается, существующие строки не меняются.
-- Старые поля (WorkspaceConnection.startDate/endDate, ScheduledMessage.source*TemplateId) сохраняются.
--
-- Часть 1 — сгенерирована `prisma migrate diff` (совпадает с prisma/schema.prisma).
-- Часть 2 — объекты, которые Prisma не описывает в схеме (частичный уникальный индекс, CHECK, EXCLUDE,
--           триггеры истории). Prisma их не видит и не считает расхождением схемы.

-- ─────────────────────────────────────────────────────────────────────────────
-- Часть 1. Таблицы, колонки, индексы, внешние ключи
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "IntensiveStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PlanItemSourceType" AS ENUM ('OFFICIAL', 'USER_TEMPLATE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "IntensiveEventType" AS ENUM ('INTENSIVE_CREATED', 'INTENSIVE_UPDATED', 'INTENSIVE_PUBLISHED', 'INTENSIVE_CANCELLED', 'INTENSIVE_ARCHIVED', 'PLAN_GENERATED', 'PLAN_ITEM_ADDED', 'PLAN_ITEM_UPDATED', 'PLAN_ITEM_SOURCE_UPDATED', 'PLAN_ITEM_SKIPPED', 'PLAN_ITEM_UNSKIPPED', 'PLAN_ITEM_DELETED', 'MESSAGE_SCHEDULED', 'MESSAGE_REPEAT_SCHEDULED', 'MESSAGE_SENT', 'MESSAGE_FAILED', 'MESSAGE_CANCELLED', 'MESSAGE_RETRIED', 'MESSAGE_DELETED', 'MESSAGE_LINKED', 'MESSAGE_DETACHED');

-- AlterTable
ALTER TABLE "ScheduledMessage" ADD COLUMN     "clientRequestId" TEXT,
ADD COLUMN     "intensiveId" TEXT,
ADD COLUMN     "isPlanRepeat" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "planEditedFromSnapshot" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "planItemId" TEXT;

-- AlterTable
ALTER TABLE "WorkspaceConnection" ADD COLUMN     "orgSpaceId" TEXT;

-- CreateTable
CREATE TABLE "OrgSpace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgSpace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Intensive" (
    "id" TEXT NOT NULL,
    "orgSpaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "status" "IntensiveStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Intensive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntensivePlanItem" (
    "id" TEXT NOT NULL,
    "intensiveId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "sourceType" "PlanItemSourceType" NOT NULL,
    "sourceTemplateId" TEXT,
    "sourceScope" TEXT,
    "sourceVersion" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "dayNumber" INTEGER,
    "time" TEXT,
    "audience" TEXT NOT NULL DEFAULT 'ALL',
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "skipReason" TEXT,
    "skippedById" TEXT,
    "skippedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntensivePlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntensiveEvent" (
    "id" TEXT NOT NULL,
    "intensiveId" TEXT NOT NULL,
    "planItemId" TEXT,
    "messageId" TEXT,
    "actorId" TEXT,
    "type" "IntensiveEventType" NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntensiveEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgSpace_name_key" ON "OrgSpace"("name");

-- CreateIndex
CREATE INDEX "Intensive_orgSpaceId_status_idx" ON "Intensive"("orgSpaceId", "status");

-- CreateIndex
CREATE INDEX "Intensive_startDate_endDate_idx" ON "Intensive"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "Intensive_status_idx" ON "Intensive"("status");

-- CreateIndex
CREATE INDEX "IntensivePlanItem_intensiveId_position_idx" ON "IntensivePlanItem"("intensiveId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "IntensivePlanItem_intensiveId_sourceType_sourceTemplateId_key" ON "IntensivePlanItem"("intensiveId", "sourceType", "sourceTemplateId");

-- CreateIndex
CREATE INDEX "IntensiveEvent_intensiveId_createdAt_idx" ON "IntensiveEvent"("intensiveId", "createdAt");

-- CreateIndex
CREATE INDEX "IntensiveEvent_planItemId_idx" ON "IntensiveEvent"("planItemId");

-- CreateIndex
CREATE INDEX "IntensiveEvent_messageId_idx" ON "IntensiveEvent"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledMessage_clientRequestId_key" ON "ScheduledMessage"("clientRequestId");

-- CreateIndex
CREATE INDEX "ScheduledMessage_intensiveId_status_idx" ON "ScheduledMessage"("intensiveId", "status");

-- CreateIndex
CREATE INDEX "ScheduledMessage_planItemId_status_idx" ON "ScheduledMessage"("planItemId", "status");

-- CreateIndex
CREATE INDEX "WorkspaceConnection_orgSpaceId_idx" ON "WorkspaceConnection"("orgSpaceId");

-- AddForeignKey
ALTER TABLE "WorkspaceConnection" ADD CONSTRAINT "WorkspaceConnection_orgSpaceId_fkey" FOREIGN KEY ("orgSpaceId") REFERENCES "OrgSpace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_intensiveId_fkey" FOREIGN KEY ("intensiveId") REFERENCES "Intensive"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_planItemId_fkey" FOREIGN KEY ("planItemId") REFERENCES "IntensivePlanItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgSpace" ADD CONSTRAINT "OrgSpace_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intensive" ADD CONSTRAINT "Intensive_orgSpaceId_fkey" FOREIGN KEY ("orgSpaceId") REFERENCES "OrgSpace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intensive" ADD CONSTRAINT "Intensive_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intensive" ADD CONSTRAINT "Intensive_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntensivePlanItem" ADD CONSTRAINT "IntensivePlanItem_intensiveId_fkey" FOREIGN KEY ("intensiveId") REFERENCES "Intensive"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntensivePlanItem" ADD CONSTRAINT "IntensivePlanItem_skippedById_fkey" FOREIGN KEY ("skippedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntensivePlanItem" ADD CONSTRAINT "IntensivePlanItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntensivePlanItem" ADD CONSTRAINT "IntensivePlanItem_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntensiveEvent" ADD CONSTRAINT "IntensiveEvent_intensiveId_fkey" FOREIGN KEY ("intensiveId") REFERENCES "Intensive"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntensiveEvent" ADD CONSTRAINT "IntensiveEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Часть 2. Ограничения целостности, которых нет в языке схемы Prisma
-- ─────────────────────────────────────────────────────────────────────────────

-- 2.1 Одна АКТИВНАЯ (PENDING/SENT) не-повторная отправка на пункт плана.
-- Конкурентное планирование одного пункта двумя сотрудниками: вторая вставка получает 23505 → API отвечает 409.
-- Повторы (isPlanRepeat = true), FAILED и CANCELLED в уникальности не участвуют.
CREATE UNIQUE INDEX "ScheduledMessage_planItem_active_key"
  ON "ScheduledMessage" ("planItemId")
  WHERE "planItemId" IS NOT NULL AND "isPlanRepeat" = false AND "status" IN ('PENDING', 'SENT');

-- 2.2 CHECK-ограничения
ALTER TABLE "Intensive"
  ADD CONSTRAINT "Intensive_dates_check" CHECK ("endDate" >= "startDate"),
  ADD CONSTRAINT "Intensive_timezone_check" CHECK (char_length("timezone") BETWEEN 1 AND 64);

ALTER TABLE "IntensivePlanItem"
  ADD CONSTRAINT "IntensivePlanItem_time_check" CHECK ("time" IS NULL OR "time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "IntensivePlanItem_day_check" CHECK ("dayNumber" IS NULL OR "dayNumber" BETWEEN 1 AND 366),
  ADD CONSTRAINT "IntensivePlanItem_audience_check" CHECK ("audience" IN ('ADM', 'SUP', 'ALL')),
  ADD CONSTRAINT "IntensivePlanItem_skip_check" CHECK (NOT "skipped" OR "skipReason" IS NOT NULL);

-- Пункт плана без интенсива и повтор без пункта невозможны.
ALTER TABLE "ScheduledMessage"
  ADD CONSTRAINT "ScheduledMessage_plan_link_check" CHECK ("planItemId" IS NULL OR "intensiveId" IS NOT NULL),
  ADD CONSTRAINT "ScheduledMessage_plan_repeat_check" CHECK (NOT "isPlanRepeat" OR "planItemId" IS NOT NULL);

-- 2.3 Пункт плана сообщения принадлежит интенсиву сообщения.
CREATE OR REPLACE FUNCTION "scheduled_message_plan_item_consistency"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "IntensivePlanItem" p
    WHERE p."id" = NEW."planItemId" AND p."intensiveId" = NEW."intensiveId"
  ) THEN
    RAISE EXCEPTION 'ScheduledMessage.planItemId % does not belong to intensive %', NEW."planItemId", NEW."intensiveId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ScheduledMessage_plan_item_consistency"
  BEFORE INSERT OR UPDATE OF "planItemId", "intensiveId" ON "ScheduledMessage"
  FOR EACH ROW WHEN (NEW."planItemId" IS NOT NULL)
  EXECUTE FUNCTION "scheduled_message_plan_item_consistency"();

-- 2.4 Нет пересечений ОПУБЛИКОВАННЫХ интенсивов одного OrgSpace (периоды включительно).
-- Основная защита — транзакция + pg_advisory_xact_lock в API (lib/intensives/overlap.ts).
-- Дополнительно — EXCLUDE-ограничение, если расширение btree_gist можно создать (в PG13+ оно «trusted»:
-- достаточно права CREATE на базу). Если нельзя — миграция не падает, остаётся только advisory lock.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS btree_gist;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'btree_gist is not available (%): overlap protection uses advisory locks only', SQLERRM;
  END;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    ALTER TABLE "Intensive" ADD CONSTRAINT "Intensive_published_no_overlap"
      EXCLUDE USING gist ("orgSpaceId" WITH =, daterange("startDate", "endDate", '[]') WITH &&)
      WHERE ("status" = 'PUBLISHED');
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Часть 3. История интенсива (IntensiveEvent)
-- ─────────────────────────────────────────────────────────────────────────────

-- 3.1 История неизменяема. Разрешено только обнуление actorId (ON DELETE SET NULL при удалении пользователя).
CREATE OR REPLACE FUNCTION "intensive_event_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW."actorId" IS NULL
     AND NEW."id" = OLD."id"
     AND NEW."intensiveId" = OLD."intensiveId"
     AND NEW."planItemId" IS NOT DISTINCT FROM OLD."planItemId"
     AND NEW."messageId" IS NOT DISTINCT FROM OLD."messageId"
     AND NEW."type" = OLD."type"
     AND NEW."details" IS NOT DISTINCT FROM OLD."details"
     AND NEW."createdAt" = OLD."createdAt" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'IntensiveEvent rows are immutable (intensive history)' USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "IntensiveEvent_immutable"
  BEFORE UPDATE OR DELETE ON "IntensiveEvent"
  FOR EACH ROW EXECUTE FUNCTION "intensive_event_immutable"();

-- 3.2 Смена статуса и удаление сообщения, связанного с интенсивом, фиксируются в истории на уровне БД.
-- Так отправщик (scripts/send-scheduled-messages.ts), архивирование пространства, блокировка пользователя,
-- повтор и удаление через существующие роуты пишут историю без изменений их кода.
-- Автор действия берётся из настройки транзакции app.intensive_actor_id (ставит API), иначе NULL.
-- Текст сообщения в историю не копируется.
CREATE OR REPLACE FUNCTION "scheduled_message_intensive_history"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_type "IntensiveEventType";
  v_actor TEXT := NULLIF(current_setting('app.intensive_actor_id', true), '');
BEGIN
  IF v_actor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = v_actor) THEN
    v_actor := NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."intensiveId" IS NULL THEN
      RETURN OLD;
    END IF;
    INSERT INTO "IntensiveEvent" ("id", "intensiveId", "planItemId", "messageId", "actorId", "type", "details", "createdAt")
    VALUES (
      gen_random_uuid()::text, OLD."intensiveId", OLD."planItemId", OLD."id", v_actor, 'MESSAGE_DELETED',
      jsonb_build_object(
        'source', 'db_trigger',
        'status', OLD."status",
        'scheduledFor', OLD."scheduledFor",
        'sentAt', OLD."sentAt",
        'isPlanRepeat', OLD."isPlanRepeat",
        'workspaceId', OLD."workspaceId",
        'channelName', OLD."channelName",
        'authorId', OLD."userId",
        'scheduledById', OLD."scheduledById",
        'rcMessageId', OLD."messageId_RC"
      ),
      CURRENT_TIMESTAMP
    );
    RETURN OLD;
  END IF;

  -- UPDATE: только реальная смена статуса у сообщения, связанного с интенсивом
  IF NEW."intensiveId" IS NULL OR NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    RETURN NEW;
  END IF;

  v_type := CASE
    WHEN NEW."status" = 'SENT' THEN 'MESSAGE_SENT'::"IntensiveEventType"
    WHEN NEW."status" = 'FAILED' THEN 'MESSAGE_FAILED'::"IntensiveEventType"
    WHEN NEW."status" = 'CANCELLED' THEN 'MESSAGE_CANCELLED'::"IntensiveEventType"
    ELSE 'MESSAGE_RETRIED'::"IntensiveEventType"
  END;

  INSERT INTO "IntensiveEvent" ("id", "intensiveId", "planItemId", "messageId", "actorId", "type", "details", "createdAt")
  VALUES (
    gen_random_uuid()::text, NEW."intensiveId", NEW."planItemId", NEW."id", v_actor, v_type,
    jsonb_build_object(
      'source', 'db_trigger',
      'fromStatus', OLD."status",
      'toStatus', NEW."status",
      'scheduledFor', NEW."scheduledFor",
      'sentAt', CASE WHEN NEW."status" = 'SENT' THEN NEW."sentAt" ELSE NULL END,
      'error', left(NEW."error", 500),
      'isPlanRepeat', NEW."isPlanRepeat",
      'workspaceId', NEW."workspaceId",
      'channelName', NEW."channelName",
      'authorId', NEW."userId",
      'scheduledById', NEW."scheduledById",
      'rcMessageId', NEW."messageId_RC"
    ),
    CURRENT_TIMESTAMP
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ScheduledMessage_intensive_history_update"
  AFTER UPDATE OF "status" ON "ScheduledMessage"
  FOR EACH ROW WHEN (NEW."intensiveId" IS NOT NULL AND OLD."status" IS DISTINCT FROM NEW."status")
  EXECUTE FUNCTION "scheduled_message_intensive_history"();

CREATE TRIGGER "ScheduledMessage_intensive_history_delete"
  AFTER DELETE ON "ScheduledMessage"
  FOR EACH ROW WHEN (OLD."intensiveId" IS NOT NULL)
  EXECUTE FUNCTION "scheduled_message_intensive_history"();
