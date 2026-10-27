import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { PRISMA_CLIENT, type PrismaClientHolder } from "../database";
import { ProjectsModule, ProjectsService } from "../projects";
import { CLOCK, PROJECT_CATALOG, RUN_REPOSITORY, TASK_REPOSITORY } from "./application/ports";
import { RunsService } from "./application/runs.service";
import { TasksService } from "./application/tasks.service";
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
    { provide: PROJECT_CATALOG, inject: [ProjectsService], useFactory: (projects: ProjectsService) => new ProjectsServiceCatalog(projects) },
    { provide: APP_FILTER, useClass: ExecutionErrorFilter },
  ],
})
export class ExecutionModule {}
