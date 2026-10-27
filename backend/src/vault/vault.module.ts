import { Module } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/config";
import { PRISMA_CLIENT, type PrismaClientHolder } from "../database";
import { SECRET_STORE } from "./application/secret-store";
import { AesGcmCipher } from "./infrastructure/aes-gcm-cipher";
import { PrismaSecretStore } from "./infrastructure/prisma-secret-store";

@Module({
  providers: [
    {
      provide: SECRET_STORE,
      inject: [PRISMA_CLIENT, APP_CONFIG],
      useFactory: (prisma: PrismaClientHolder, config: AppConfig) =>
        new PrismaSecretStore(prisma, config.secretsKey ? new AesGcmCipher(config.secretsKey) : undefined),
    },
  ],
  exports: [SECRET_STORE],
})
export class VaultModule {}
