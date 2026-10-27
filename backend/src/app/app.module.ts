import { Module } from "@nestjs/common";
import { ConfigModule } from "../config/config.module";
import { DatabaseModule } from "../database";
import { IdentityModule } from "../identity";
import { McpModule } from "../mcp";
import { ProjectsModule } from "../projects";
import { HealthController } from "./health.controller";

@Module({
  imports: [ConfigModule, DatabaseModule, IdentityModule, ProjectsModule, McpModule],
  controllers: [HealthController],
})
export class AppModule {}
