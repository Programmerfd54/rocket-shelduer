-- CreateTable
CREATE TABLE "HelpMainContent" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpMainContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpCatalog" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpInstruction" (
    "id" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpInstruction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpFAQ" (
    "id" TEXT NOT NULL,
    "catalogId" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpFAQ_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "HelpInstruction" ADD CONSTRAINT "HelpInstruction_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "HelpCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpFAQ" ADD CONSTRAINT "HelpFAQ_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "HelpCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
