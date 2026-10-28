import { ModelSettings, type ModelSettingsProps, type ModelSettingsRepository } from "../../src/agent";
import type { ProjectId, TenantId } from "../../src/shared-kernel";

/** Same contract as the Postgres repository, kept in memory. */
export class InMemoryModelSettingsRepository implements ModelSettingsRepository {
  private readonly stored = new Map<string, ModelSettingsProps>();

  async save(settings: ModelSettings): Promise<void> {
    const props = settings.toProps();
    this.stored.set(props.projectId, props);
  }

  async find(tenantId: TenantId, projectId: ProjectId): Promise<ModelSettings | undefined> {
    const props = this.stored.get(projectId);
    return props && props.tenantId === tenantId ? ModelSettings.restore(props) : undefined;
  }

  async delete(tenantId: TenantId, projectId: ProjectId): Promise<void> {
    if (this.stored.get(projectId)?.tenantId === tenantId) this.stored.delete(projectId);
  }
}
