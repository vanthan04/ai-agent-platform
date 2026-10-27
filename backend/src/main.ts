import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app/app.module";
import { loadConfig } from "./config/config";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(config.port, config.host);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "failed to start");
  process.exit(1);
});
