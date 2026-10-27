import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { PRISMA_CLIENT, type PrismaClientHolder } from "../database";
import { ProjectsModule, ProjectsService } from "../projects";
import { CLOCK, PROJECT_CATALOG, RESOLUTION_REPOSITORY, RUN_QUEUE, RUN_REPOSITORY, TASK_REPOSITORY } from "./application/ports";
import { RunsService } from "./application/runs.service";
import { TasksService } from "./application/tasks.service";
import { PrismaResolutionRepository } from "./infrastructure/prisma-resolution.repository";
import { PrismaRunQueue } from "./infrastructure/prisma-run-queue";
import { PrismaRunRepository } from "./infrastructure/prisma-run.repository";
import { PrismaTaskRepository } from "./infrastructure/prisma-task.repository";
import { ProjectsServiceCatalog } from "./infrastructure/projects-catalog";
import { systemClock } from "./infrastructure/system-clock";
import { ExecutionErrorFilter } from "./interface/execution-error.filter";
import { ExecutionController } from "./interface/execution.controller";

@Module({
  imports: [ProjectsModule],
  controllers: [ExecutionController],
  providers: [
    TasksService,
    RunsService,
    { provide: CLOCK, useValue: systemClock },
    { provide: TASK_REPOSITORY, inject: [PRISMA_CLIENT], useFactory: (prisma: PrismaClientHolder) => new PrismaTaskRepository(prisma) },
    { provide: RUN_REPOSITORY, inject: [PRISMA_CLIENT], useFactory: (prisma: PrismaClientHolder) => new PrismaRunRepository(prisma) },
    { provide: RESOLUTION_REPOSITORY, inject: [PRISMA_CLIENT], useFactory: (prisma: PrismaClientHolder) => new PrismaResolutionRepository(prisma) },
    { provide: RUN_QUEUE, inject: [PRISMA_CLIENT], useFactory: (prisma: PrismaClientHolder) => new PrismaRunQueue(prisma) },
    { provide: PROJECT_CATALOG, inject: [ProjectsService], useFactory: (projects: ProjectsService) => new ProjectsServiceCatalog(projects) },
    { provide: APP_FILTER, useClass: ExecutionErrorFilter },
  ],
  // The worker is another context: it takes these ports from here instead of reading the tables itself.
  exports: [TASK_REPOSITORY, RUN_REPOSITORY, RESOLUTION_REPOSITORY, RUN_QUEUE],
})
export class ExecutionModule {}
