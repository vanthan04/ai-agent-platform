-- CreateEnum
CREATE TYPE "RepositoryProvider" AS ENUM ('github', 'codecommit');

-- CreateTable
CREATE TABLE "RepositoryMapping" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "provider" "RepositoryProvider" NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL,
    "allowedBranches" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepositoryMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RepositoryMapping_projectId_idx" ON "RepositoryMapping"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryMapping_projectId_provider_name_key" ON "RepositoryMapping"("projectId", "provider", "name");

-- AddForeignKey
ALTER TABLE "RepositoryMapping" ADD CONSTRAINT "RepositoryMapping_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
