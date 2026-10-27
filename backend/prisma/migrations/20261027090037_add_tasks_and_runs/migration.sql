-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "jiraIssueKey" TEXT,
    "repositoryMappingId" TEXT NOT NULL,
    "repoProvider" "RepositoryProvider" NOT NULL,
    "repoName" TEXT NOT NULL,
    "repoUrl" TEXT NOT NULL,
    "baseBranch" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "outputs" TEXT[],
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "publishes" BOOLEAN NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "blockedReason" TEXT,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunEvent" (
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunEvent_pkey" PRIMARY KEY ("runId","seq")
);

-- CreateIndex
CREATE INDEX "Task_projectId_createdAt_idx" ON "Task"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Run_projectId_status_idx" ON "Run"("projectId", "status");

-- CreateIndex
CREATE INDEX "Run_projectId_createdAt_idx" ON "Run"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Run_projectId_idempotencyKey_key" ON "Run"("projectId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Run_taskId_attempt_key" ON "Run"("taskId", "attempt");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunEvent" ADD CONSTRAINT "RunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A task has at most one run in progress. Prisma cannot express a partial unique index, so it is written here.
-- The terminal states are the ones in `TERMINAL_STATUSES` (src/execution/domain/run.ts); keep the two lists in step.
CREATE UNIQUE INDEX "Run_one_active_per_task" ON "Run"("taskId") WHERE "status" NOT IN ('succeeded', 'rejected', 'failed', 'cancelled', 'blocked');
