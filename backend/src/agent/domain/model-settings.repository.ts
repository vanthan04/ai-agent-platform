import type { ProjectId, TenantId } from "../../shared-kernel";
import type { ModelSettings } from "./model-settings";

/** Storage port. Every lookup is scoped by tenant and project (D2, D7). */
export interface ModelSettingsRepository {
  /** Creates the project's record or replaces it. */
  save(settings: ModelSettings): Promise<void>;
  find(tenantId: TenantId, projectId: ProjectId): Promise<ModelSettings | undefined>;
  delete(tenantId: TenantId, projectId: ProjectId): Promise<void>;
}
