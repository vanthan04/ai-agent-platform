import type { AuthUser } from "../domain/auth-user";

/** The part of a request an authenticator may look at. */
export interface AuthenticationRequest {
  headers: Record<string, string | string[] | undefined>;
}

/** The seam for real authentication: a session, token or OAuth implementation replaces `DevAuthenticator` without touching any route. */
export interface Authenticator {
  authenticate(request: AuthenticationRequest): AuthUser | undefined;
}

export const AUTHENTICATOR = Symbol("AUTHENTICATOR");
