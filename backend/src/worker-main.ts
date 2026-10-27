import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { loadConfig } from "./config/config";
import { WorkerModule } from "./worker";

async function main(): Promise<void> {
  loadConfig(process.env); // fail at start on a bad configuration, as the API does
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks(); // Ctrl+C or a stop signal lets the current pass finish
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "failed to start");
  process.exit(1);
});
