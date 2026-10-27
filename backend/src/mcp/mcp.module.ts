import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { PRISMA_CLIENT, type PrismaClientHolder } from "../database";
import { SafeHttpClient } from "../network";
import { ProjectsModule, ProjectsService } from "../projects";
import { VaultModule } from "../vault";
import { McpConnectionsService } from "./application/mcp-connections.service";
import { CLOCK, MCP_CONNECTION_REPOSITORY, MCP_SERVER_CLIENT, PROJECT_ACCESS, TEST_RATE_LIMITER } from "./application/ports";
import { HttpMcpServerClient } from "./infrastructure/http-mcp-server-client";
import { InMemoryRateLimiter } from "./infrastructure/in-memory-rate-limiter";
import { PrismaMcpConnectionRepository } from "./infrastructure/prisma-mcp-connection.repository";
import { ProjectsServiceAccess } from "./infrastructure/projects-access";
import { systemClock } from "./infrastructure/system-clock";
import { McpErrorFilter } from "./interface/mcp-error.filter";
import { McpController } from "./interface/mcp.controller";

@Module({
  imports: [ProjectsModule, VaultModule],
  controllers: [McpController],
  providers: [
    McpConnectionsService,
    { provide: CLOCK, useValue: systemClock },
    { provide: MCP_CONNECTION_REPOSITORY, inject: [PRISMA_CLIENT], useFactory: (prisma: PrismaClientHolder) => new PrismaMcpConnectionRepository(prisma) },
    { provide: PROJECT_ACCESS, inject: [ProjectsService], useFactory: (projects: ProjectsService) => new ProjectsServiceAccess(projects) },
    // The strict client: https only, public addresses only, no redirects.
    { provide: MCP_SERVER_CLIENT, useFactory: () => new HttpMcpServerClient(new SafeHttpClient()) },
    { provide: TEST_RATE_LIMITER, useFactory: () => new InMemoryRateLimiter() },
    { provide: APP_FILTER, useClass: McpErrorFilter },
  ],
})
export class McpModule {}
