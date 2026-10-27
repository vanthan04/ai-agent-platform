import { PolicyVersionConflictError, type PolicyVersion, type ProjectPolicyRepository } from "../../src/projects";
import type { ProjectId, TenantId } from "../../src/shared-kernel";

/** Same contract as the Postgres repository, kept in memory. Append only. */
export class InMemoryProjectPolicyRepository implements ProjectPolicyRepository {
  private readonly versions = new Map<string, PolicyVersion[]>();

  private key(tenantId: TenantId, projectId: ProjectId): string {
    return `${tenantId}/${projectId}`;
  }

  async findLatest(tenantId: TenantId, projectId: ProjectId): Promise<PolicyVersion | undefined> {
    return (await this.listVersions(tenantId, projectId))[0];
  }

  async listVersions(tenantId: TenantId, projectId: ProjectId): Promise<PolicyVersion[]> {
    return [...(this.versions.get(this.key(tenantId, projectId)) ?? [])].sort((a, b) => b.version - a.version);
  }

  async append(tenantId: TenantId, projectId: ProjectId, version: PolicyVersion): Promise<void> {
    const key = this.key(tenantId, projectId);
    const existing = this.versions.get(key) ?? [];
    if (existing.some((stored) => stored.version === version.version)) throw new PolicyVersionConflictError();
    this.versions.set(key, [...existing, version]);
  }
}
