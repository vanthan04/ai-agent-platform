import { Global, Module } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/config";
import { PRISMA_CLIENT, PrismaClientHolder } from "./prisma-client";

/** One database client for the whole app, so every context shares a single connection pool. */
@Global()
@Module({
  providers: [{ provide: PRISMA_CLIENT, inject: [APP_CONFIG], useFactory: (config: AppConfig) => new PrismaClientHolder(config.databaseUrl) }],
  exports: [PRISMA_CLIENT],
})
export class DatabaseModule {}
