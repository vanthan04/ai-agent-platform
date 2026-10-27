import type { TenantId } from "../../shared-kernel";
import type { SecretRef } from "../domain/secret-ref";

/**
 * The secrets layer. Anything that must stay secret (an MCP token, later a Jira or GitHub token) is put here and
 * referred to by a `SecretRef`. No API ever returns a secret to a browser; only server code that needs to use it calls `get`.
 */
export interface SecretStore {
  /** Throws `SecretStorageNotConfiguredError` when the encryption key is not set. */
  put(tenantId: TenantId, plaintext: string): Promise<SecretRef>;
  /** `undefined` for an unknown reference or one that belongs to another tenant. */
  get(tenantId: TenantId, ref: SecretRef): Promise<string | undefined>;
  /** Deleting an unknown reference is not an error. */
  delete(tenantId: TenantId, ref: SecretRef): Promise<void>;
}

export const SECRET_STORE = Symbol("SECRET_STORE");
