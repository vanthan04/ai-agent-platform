import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { PRISMA_CLIENT, type PrismaClientHolder } from "../database";
import { CLOCK, PROJECT_POLICY_REPOSITORY, PROJECT_REPOSITORY } from "./application/ports";
import { ProjectPolicyService } from "./application/project-policy.service";
import { ProjectsService } from "./application/projects.service";
import { PrismaProjectPolicyRepository } from "./infrastructure/prisma-project-policy.repository";
import { PrismaProjectRepository } from "./infrastructure/prisma-project.repository";
import { systemClock } from "./infrastructure/system-clock";
import { ProjectErrorFilter } from "./interface/project-error.filter";
import { ProjectPolicyController } from "./interface/project-policy.controller";
import { ProjectsController } from "./interface/projects.controller";

@Module({
  controllers: [ProjectsController, ProjectPolicyController],
  providers: [
    ProjectsService,
    ProjectPolicyService,
    { provide: CLOCK, useValue: systemClock },
    { provide: PROJECT_REPOSITORY, inject: [PRISMA_CLIENT], useFactory: (prisma: PrismaClientHolder) => new PrismaProjectRepository(prisma) },
    { provide: PROJECT_POLICY_REPOSITORY, inject: [PRISMA_CLIENT], useFactory: (prisma: PrismaClientHolder) => new PrismaProjectPolicyRepository(prisma) },
    { provide: APP_FILTER, useClass: ProjectErrorFilter },
  ],
  // Other contexts ask a project's service who may do what in it; they never read its tables.
  exports: [ProjectsService],
})
export class ProjectsModule {}
