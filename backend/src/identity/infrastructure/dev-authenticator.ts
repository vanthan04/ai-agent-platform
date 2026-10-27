import type { Authenticator } from "../application/authenticator";
import type { AuthUser } from "../domain/auth-user";

/** Every request is the same fixed user. Local development only; `loadConfig` refuses it in production. */
export class DevAuthenticator implements Authenticator {
  constructor(private readonly user: AuthUser) {}

  authenticate(): AuthUser {
    return this.user;
  }
}
