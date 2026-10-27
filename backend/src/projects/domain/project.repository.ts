import type { ProjectId, RepositoryMappingId, TenantId, UserId } from "../../shared-kernel";
import type { Project } from "./project";

/** Storage port of the aggregate. Every lookup is scoped by tenant (D2). */
export interface ProjectRepository {
  nextId(): ProjectId;
  nextRepositoryMappingId(): RepositoryMappingId;
  /** Stores the project and its members as one unit. Throws `DuplicateProjectNameError` when the name is taken in the tenant. */
  save(project: Project): Promise<void>;
  findById(tenantId: TenantId, id: string): Promise<Project | undefined>;
  listByMember(tenantId: TenantId, userId: UserId): Promise<Project[]>;
}
