import { SecretRef, type SecretStore } from "../../src/vault";
import type { TenantId } from "../../src/shared-kernel";

/** Same contract as the encrypted Postgres store, in memory. `size` lets a test check that nothing is left behind. */
export class InMemorySecretStore implements SecretStore {
  private readonly secrets = new Map<string, { tenantId: string; value: string }>();
  private counter = 0;

  get size(): number {
    return this.secrets.size;
  }

  async put(tenantId: TenantId, plaintext: string): Promise<SecretRef> {
    const ref = SecretRef.parse(`secret-${++this.counter}`);
    this.secrets.set(ref, { tenantId, value: plaintext });
    return ref;
  }

  async get(tenantId: TenantId, ref: SecretRef): Promise<string | undefined> {
    const stored = this.secrets.get(ref);
    return stored && stored.tenantId === tenantId ? stored.value : undefined;
  }

  async delete(tenantId: TenantId, ref: SecretRef): Promise<void> {
    if (this.secrets.get(ref)?.tenantId === tenantId) this.secrets.delete(ref);
  }
}
