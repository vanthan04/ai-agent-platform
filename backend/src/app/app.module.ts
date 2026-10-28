import { Module } from "@nestjs/common";
import { AgentModule } from "../agent";
import { ConfigModule } from "../config/config.module";
import { DatabaseModule } from "../database";
import { ExecutionModule } from "../execution";
import { IdentityModule } from "../identity";
import { McpModule } from "../mcp";
import { ProjectsModule } from "../projects";
import { HealthController } from "./health.controller";

@Module({
  imports: [ConfigModule, DatabaseModule, IdentityModule, ProjectsModule, McpModule, ExecutionModule, AgentModule],
  controllers: [HealthController],
})
export class AppModule {}
