-- CreateTable
CREATE TABLE "ProjectPolicyVersion" (
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "policy" JSONB NOT NULL,
    "changedBy" TEXT NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectPolicyVersion_pkey" PRIMARY KEY ("projectId","version")
);

-- AddForeignKey
ALTER TABLE "ProjectPolicyVersion" ADD CONSTRAINT "ProjectPolicyVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
