-- CreateTable
CREATE TABLE "HelpMainSection" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpMainSection_pkey" PRIMARY KEY ("id")
);
