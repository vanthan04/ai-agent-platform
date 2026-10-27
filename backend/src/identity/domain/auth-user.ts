import type { TenantId, UserId } from "../../shared-kernel";

/** Who is calling, as established by the authenticator; never taken from a request body. */
export interface AuthUser {
  userId: UserId;
  tenantId: TenantId;
}
