-- При удалении города удаляются привязанные пространства (и каскадно их данные), а не только cityId → NULL
ALTER TABLE "WorkspaceConnection" DROP CONSTRAINT IF EXISTS "WorkspaceConnection_cityId_fkey";
ALTER TABLE "WorkspaceConnection" ADD CONSTRAINT "WorkspaceConnection_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
