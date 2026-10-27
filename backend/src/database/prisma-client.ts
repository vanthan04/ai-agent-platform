import type { OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

/** One Prisma client, and so one connection pool, shared by the repositories of this context. Created on first use, so the app and its tests start without a database. */
export class PrismaClientHolder implements OnModuleDestroy {
  private client: PrismaClient | undefined;

  constructor(private readonly databaseUrl: string | undefined) {}

  db(): PrismaClient {
    if (!this.client) {
      if (!this.databaseUrl) throw new Error("DATABASE_URL is not set");
      this.client = new PrismaClient({ adapter: new PrismaPg({ connectionString: this.databaseUrl }) });
    }
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
  }
}

export const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";

export const PRISMA_CLIENT = Symbol("PRISMA_CLIENT");
