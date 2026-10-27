import { Logger, Module } from "@nestjs/common";
import { ConfigModule } from "../config/config.module";
import { DatabaseModule } from "../database";
import {
  ExecutionModule,
  RESOLUTION_REPOSITORY,
  RUN_QUEUE,
  RUN_REPOSITORY,
  TASK_REPOSITORY,
  type ResolutionRepository,
  type RunQueue,
  type RunRepository,
  type TaskRepository,
} from "../execution";
import { SafeHttpClient } from "../network";
import { REPOSITORY_INSPECTOR, type RepositoryInspector } from "./application/ports";
import { RunProcessor } from "./application/run-processor";
import { GitHttpRepositoryInspector } from "./infrastructure/git-http-repository-inspector";
import { PollingWorker } from "./infrastructure/polling-worker";

const logger = new Logger("Worker");
const log = { info: (message: string) => logger.log(message), error: (message: string) => logger.error(message) };

/** The background process that works on queued runs. It has no HTTP server; `src/worker-main.ts` starts it. */
@Module({
  imports: [ConfigModule, DatabaseModule, ExecutionModule],
  providers: [
    // The strict client: https only, public addresses only, no redirects.
    { provide: REPOSITORY_INSPECTOR, useFactory: () => new GitHttpRepositoryInspector(new SafeHttpClient()) },
    {
      provide: RunProcessor,
      inject: [RUN_QUEUE, RUN_REPOSITORY, TASK_REPOSITORY, RESOLUTION_REPOSITORY, REPOSITORY_INSPECTOR],
      useFactory: (queue: RunQueue, runs: RunRepository, tasks: TaskRepository, resolutions: ResolutionRepository, inspector: RepositoryInspector) =>
        new RunProcessor({ queue, runs, tasks, resolutions, inspector, clock: { now: () => new Date().toISOString() }, log }),
    },
    { provide: PollingWorker, inject: [RunProcessor], useFactory: (processor: RunProcessor) => new PollingWorker(processor, log) },
  ],
})
export class WorkerModule {}
