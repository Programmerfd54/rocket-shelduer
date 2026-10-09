-- Lead_SUP может отключить предложение архивировать пространство (WorkspaceConnection).
-- Аддитивно: новая колонка с DEFAULT false, существующие данные не меняются.
ALTER TABLE "WorkspaceConnection" ADD COLUMN "suppressArchivePrompt" BOOLEAN NOT NULL DEFAULT false;
