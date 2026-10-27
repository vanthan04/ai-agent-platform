import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { APP_CONFIG, type AppConfig } from "../config/config";
import { TenantId, UserId } from "../shared-kernel";
import { AUTHENTICATOR } from "./application/authenticator";
import { DevAuthenticator } from "./infrastructure/dev-authenticator";
import { AuthGuard } from "./interface/auth.guard";

@Module({
  providers: [
    {
      provide: AUTHENTICATOR,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new DevAuthenticator({ userId: UserId.parse(config.auth.userId), tenantId: TenantId.parse(config.auth.tenantId) }),
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AUTHENTICATOR],
})
export class IdentityModule {}
