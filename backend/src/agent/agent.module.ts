import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { PRISMA_CLIENT, type PrismaClientHolder } from "../database";
import { ProjectsModule, ProjectsService } from "../projects";
import { VaultModule } from "../vault";
import { ModelSettingsService } from "./application/model-settings.service";
import { CLOCK, MODEL_SETTINGS_REPOSITORY, PROJECT_ACCESS } from "./application/ports";
import { PrismaModelSettingsRepository } from "./infrastructure/prisma-model-settings.repository";
import { ProjectsServiceAccess } from "./infrastructure/projects-access";
import { systemClock } from "./infrastructure/system-clock";
import { AgentErrorFilter } from "./interface/agent-error.filter";
import { AgentController } from "./interface/agent.controller";

@Module({
  imports: [ProjectsModule, VaultModule],
  controllers: [AgentController],
  providers: [
    ModelSettingsService,
    { provide: CLOCK, useValue: systemClock },
    { provide: MODEL_SETTINGS_REPOSITORY, inject: [PRISMA_CLIENT], useFactory: (prisma: PrismaClientHolder) => new PrismaModelSettingsRepository(prisma) },
    { provide: PROJECT_ACCESS, inject: [ProjectsService], useFactory: (projects: ProjectsService) => new ProjectsServiceAccess(projects) },
    { provide: APP_FILTER, useClass: AgentErrorFilter },
  ],
})
export class AgentModule {}
