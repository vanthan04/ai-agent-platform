-- CreateTable
CREATE TABLE "RunResolution" (
    "runId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "baseCommitSha" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunResolution_pkey" PRIMARY KEY ("runId")
);

-- AddForeignKey
ALTER TABLE "RunResolution" ADD CONSTRAINT "RunResolution_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
